import type { GetParametersCommand } from '@aws-sdk/client-ssm';
import { describe, expect, test } from 'vitest';
import { CachedConfig } from '../../core/config/cached-config.js';
import { rawConfig } from '../../testing/helpers.js';
import { SsmConfigSource } from './ssm-config-source.js';

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

describe('SsmConfigSource', () => {
  test('requests the four parameters under the prefix without decryption', async () => {
    const ssm = client(rawConfig());
    await new SsmConfigSource(ssm, PREFIX).load();
    expect(ssm.sent[0]?.input).toEqual({
      Names: [
        `${PREFIX}/chat_enabled`,
        `${PREFIX}/active_index`,
        `${PREFIX}/llm_config`,
        `${PREFIX}/limits`,
      ],
      WithDecryption: false,
    });
  });

  test('returns values keyed by short name so the core validator accepts them', async () => {
    const config = new CachedConfig(
      new SsmConfigSource(client(rawConfig()), PREFIX),
    );
    const state = await config.get();
    expect(state.status).toBe('ready');
  });

  test('missing parameters make the config unavailable', async () => {
    const partial = rawConfig();
    delete partial['limits'];
    const config = new CachedConfig(
      new SsmConfigSource(client(partial), PREFIX),
    );
    expect((await config.get()).status).toBe('unavailable');
  });

  test('a failing SSM call makes the config unavailable', async () => {
    const config = new CachedConfig(
      new SsmConfigSource(
        { send: () => Promise.reject(new Error('down')) },
        PREFIX,
      ),
    );
    expect((await config.get()).status).toBe('unavailable');
  });
});
