import {
  TransactWriteItemsCommand,
  UpdateItemCommand,
  type TransactWriteItemsCommandOutput,
  type UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import type {
  CounterItem,
  CounterStore,
  ReserveAllResult,
  ReserveOneResult,
} from '../../core/admission/counter-store.js';

export interface DynamoClientLike {
  send(command: UpdateItemCommand): Promise<UpdateItemCommandOutput>;
  send(
    command: TransactWriteItemsCommand,
  ): Promise<TransactWriteItemsCommandOutput>;
}

// One conditional increment, shared by the single and the transactional path. `c` is the count. The item is
// created on first use with its TTL, and the condition makes the increment fail at the limit, so concurrent
// writers can never overshoot (ADR-017).
const UPDATE_EXPRESSION =
  'SET expiresAt = if_not_exists(expiresAt, :exp) ADD #c :one';
const CONDITION_EXPRESSION = 'attribute_not_exists(#c) OR #c < :limit';

function updateParts(table: string, item: CounterItem) {
  return {
    TableName: table,
    Key: { pk: { S: item.key } },
    UpdateExpression: UPDATE_EXPRESSION,
    ConditionExpression: CONDITION_EXPRESSION,
    ExpressionAttributeNames: { '#c': 'c' },
    ExpressionAttributeValues: {
      ':one': { N: '1' },
      ':limit': { N: String(item.limit) },
      ':exp': { N: String(item.expiresAt) },
    },
  };
}

const errorName = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';

export class DynamoDbCounterStore implements CounterStore {
  constructor(
    private readonly client: DynamoClientLike,
    private readonly table: string,
  ) {}

  async reserve(item: CounterItem): Promise<ReserveOneResult> {
    try {
      const output = await this.client.send(
        new UpdateItemCommand({
          ...updateParts(this.table, item),
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      const count = Number(output.Attributes?.['c']?.N);
      // An unexpected response is not an admission: fail closed.
      if (!Number.isInteger(count) || count < 1) {
        throw new Error('counter store returned an unexpected response');
      }
      return { ok: true, count };
    } catch (error) {
      if (errorName(error) === 'ConditionalCheckFailedException') {
        return { ok: false };
      }
      throw error;
    }
  }

  async reserveAll(items: readonly CounterItem[]): Promise<ReserveAllResult> {
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          TransactItems: items.map((item) => ({
            Update: updateParts(this.table, item),
          })),
        }),
      );
      return { ok: true };
    } catch (error) {
      if (errorName(error) === 'TransactionCanceledException') {
        const reasons =
          (error as { CancellationReasons?: { Code?: string }[] })
            .CancellationReasons ?? [];
        const exceededIndex = reasons.findIndex(
          (reason) => reason.Code === 'ConditionalCheckFailed',
        );
        // A cancellation for any other reason (conflict, throttling) says nothing about the limit.
        if (exceededIndex >= 0) return { ok: false, exceededIndex };
      }
      throw error;
    }
  }
}
