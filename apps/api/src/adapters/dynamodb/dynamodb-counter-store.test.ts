import type {
  GetItemCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { describe, expect, test } from 'vitest';
import { runCounterStoreContract } from '../../testing/counter-store-contract.js';
import {
  DynamoDbCounterStore,
  type DynamoClientLike,
} from './dynamodb-counter-store.js';

type Update = NonNullable<
  NonNullable<
    TransactWriteItemsCommand['input']['TransactItems']
  >[number]['Update']
>;

// Applies the adapter's own expressions: increment while below ':limit', and refuse otherwise. This checks
// the adapter's use of the API (names, values, result handling), not DynamoDB itself.
class FakeDynamo {
  readonly table = new Map<string, number>();
  readonly commands: unknown[] = [];
  down = false;

  private apply(update: Pick<Update, 'Key' | 'ExpressionAttributeValues'>): {
    ok: boolean;
    count: number;
  } {
    const key = update.Key?.['pk']?.S ?? '';
    const limit = Number(update.ExpressionAttributeValues?.[':limit']?.N);
    const current = this.table.get(key) ?? 0;
    return { ok: current < limit, count: current + 1 };
  }

  send = ((
    command: UpdateItemCommand | TransactWriteItemsCommand | GetItemCommand,
  ) => {
    this.commands.push(command);
    if (this.down) {
      return Promise.reject(
        Object.assign(new Error('unavailable'), { name: 'ServiceUnavailable' }),
      );
    }
    if ('ConsistentRead' in command.input) {
      const key =
        (command.input as GetItemCommand['input']).Key?.['pk']?.S ?? '';
      const count = this.table.get(key);
      return Promise.resolve({
        ...(count === undefined ? {} : { Item: { c: { N: String(count) } } }),
        $metadata: {},
      });
    }
    const input = command.input as UpdateItemCommand['input'] &
      TransactWriteItemsCommand['input'];
    if (input.TransactItems) {
      const verdicts = input.TransactItems.map((t) =>
        this.apply(t.Update as Update),
      );
      if (verdicts.some((v) => !v.ok)) {
        return Promise.reject(
          Object.assign(new Error('cancelled'), {
            name: 'TransactionCanceledException',
            CancellationReasons: verdicts.map((v) => ({
              Code: v.ok ? 'None' : 'ConditionalCheckFailed',
            })),
          }),
        );
      }
      input.TransactItems.forEach((t, i) => {
        this.table.set(t.Update?.Key?.['pk']?.S ?? '', verdicts[i]?.count ?? 0);
      });
      return Promise.resolve({ $metadata: {} });
    }
    const verdict = this.apply(
      input as Pick<Update, 'Key' | 'ExpressionAttributeValues'>,
    );
    if (!verdict.ok) {
      return Promise.reject(
        Object.assign(new Error('refused'), {
          name: 'ConditionalCheckFailedException',
        }),
      );
    }
    this.table.set(input.Key?.['pk']?.S ?? '', verdict.count);
    return Promise.resolve({
      Attributes: { c: { N: String(verdict.count) } },
      $metadata: {},
    });
  }) as DynamoClientLike['send'];
}

runCounterStoreContract('dynamodb adapter', {
  build() {
    const fake = new FakeDynamo();
    return {
      store: new DynamoDbCounterStore(fake, 'counters'),
      read: (key) => fake.table.get(key) ?? 0,
      breakStore: () => {
        fake.down = true;
      },
    };
  },
});

describe('dynamodb counter store specifics', () => {
  test('sends one conditional increment with the TTL set only on creation', async () => {
    const fake = new FakeDynamo();
    await new DynamoDbCounterStore(fake, 'counters').reserve({
      key: 'rate#global#202610041200',
      limit: 40,
      expiresAt: 1_800_000_000,
    });
    const input = (fake.commands[0] as UpdateItemCommand).input;
    expect(input).toMatchObject({
      TableName: 'counters',
      Key: { pk: { S: 'rate#global#202610041200' } },
      UpdateExpression:
        'SET expiresAt = if_not_exists(expiresAt, :exp) ADD #c :one',
      ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
      ReturnValues: 'UPDATED_NEW',
      ExpressionAttributeValues: {
        ':limit': { N: '40' },
        ':exp': { N: '1800000000' },
      },
    });
  });

  test('a transaction cancelled for another reason throws instead of reporting a limit', async () => {
    const store = new DynamoDbCounterStore(
      {
        send: () =>
          Promise.reject(
            Object.assign(new Error('x'), {
              name: 'TransactionCanceledException',
              CancellationReasons: [
                { Code: 'TransactionConflict' },
                { Code: 'None' },
              ],
            }),
          ),
      } as unknown as DynamoClientLike,
      'counters',
    );
    await expect(
      store.reserveAll([
        { key: 'a', limit: 1, expiresAt: 1 },
        { key: 'b', limit: 1, expiresAt: 1 },
      ]),
    ).rejects.toThrow();
  });

  test('an unexpected response is not an admission', async () => {
    const store = new DynamoDbCounterStore(
      {
        send: () => Promise.resolve({ $metadata: {} }),
      } as unknown as DynamoClientLike,
      'counters',
    );
    await expect(
      store.reserve({ key: 'a', limit: 1, expiresAt: 1 }),
    ).rejects.toThrow();
  });

  test('read is a strongly consistent GetItem of just the count', async () => {
    const fake = new FakeDynamo();
    fake.table.set('quota#ip#abc#20261004', 4);
    const store = new DynamoDbCounterStore(fake, 'counters');
    expect(await store.read('quota#ip#abc#20261004')).toBe(4);
    const input = (fake.commands[0] as GetItemCommand).input;
    expect(input).toMatchObject({
      TableName: 'counters',
      Key: { pk: { S: 'quota#ip#abc#20261004' } },
      ConsistentRead: true,
      ProjectionExpression: '#c',
    });
  });

  test('read refuses an item whose count is not a whole number', async () => {
    const store = new DynamoDbCounterStore(
      {
        send: () =>
          Promise.resolve({ Item: { c: { N: 'abc' } }, $metadata: {} }),
      } as unknown as DynamoClientLike,
      'counters',
    );
    await expect(store.read('k')).rejects.toThrow();
  });
});
