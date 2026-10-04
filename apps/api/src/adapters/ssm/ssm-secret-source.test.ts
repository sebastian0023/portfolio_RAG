import type { GetParametersCommand } from '@aws-sdk/client-ssm';
import { describe, expect, test } from 'vitest';
import { CachedSecrets } from '../../core/guest/secrets.js';
import { SsmSecretSource } from './ssm-secret-source.js';

const PREFIX = '/portfolio-v2/prod';

function client(values: Record<string, string>) {
  const sent: GetParametersCommand[] = [];
  return {
    sent,
    send: (command: GetParametersCommand) => {
      sent.push(command);
      return Promise.resolve({
        Parameters: Object.entries(values).map(([name, Value]) => ({
          Name: `${PREFIX}/${name}`,
          Value,
        })),
        $metadata: {},
      });
    },
  };
}

describe('SsmSecretSource', () => {
  test('asks for exactly the two secrets, with decryption', async () => {
    const ssm = client({});
    await new SsmSecretSource(ssm, PREFIX).load();
    expect(ssm.sent[0]?.input).toEqual({
      Names: [`${PREFIX}/turnstile_secret`, `${PREFIX}/guest_pass_key`],
      WithDecryption: true,
    });
  });

  test('values flow into the secrets cache by short name', async () => {
    const ssm = client({
      turnstile_secret: 'abcdefghij',
      guest_pass_key: 'k'.repeat(40),
    });
    const state = await new CachedSecrets(
      new SsmSecretSource(ssm, PREFIX),
    ).get();
    expect(state.status).toBe('ready');
  });

  test('the Terraform placeholder is not a usable secret', async () => {
    const ssm = client({ turnstile_secret: 'unset', guest_pass_key: 'unset' });
    expect(
      (await new CachedSecrets(new SsmSecretSource(ssm, PREFIX)).get()).status,
    ).toBe('unavailable');
  });

  test('an SSM failure makes the secrets unavailable', async () => {
    const cache = new CachedSecrets(
      new SsmSecretSource(
        { send: () => Promise.reject(new Error('denied')) },
        PREFIX,
      ),
    );
    expect((await cache.get()).status).toBe('unavailable');
  });
});
