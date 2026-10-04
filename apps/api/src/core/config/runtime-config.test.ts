import { describe, expect, test } from 'vitest';
import {
  PARAMETER_NAMES,
  parseRuntimeConfig,
  VALIDATED_LLM_CONFIGS,
} from './runtime-config.js';

const validLimits = {
  questionMaxChars: 500,
  requestMaxBytes: 8192,
  historyTurns: 4,
  retrievedChunks: 5,
  chunkMaxTokens: 800,
  promptMaxTokens: 6000,
  outputMaxTokens: 400,
  timeoutSeconds: 30,
  preAuthPerIpPerMinute: 10,
  preAuthGlobalPerMinute: 40,
  guestPerIpPerDay: 10,
  globalPerDay: 50,
};

const valid = {
  chat_enabled: 'false',
  active_index: 'none',
  llm_config: JSON.stringify(VALIDATED_LLM_CONFIGS[0]),
  limits: JSON.stringify(validLimits),
};

const withOverride = (overrides: Record<string, string | undefined>) => ({
  ...valid,
  ...overrides,
});

const problemsFor = (raw: Record<string, string | undefined>) => {
  const result = parseRuntimeConfig(raw);
  return result.ok ? [] : result.issues;
};

describe('parseRuntimeConfig', () => {
  test('accepts a complete valid configuration', () => {
    const result = parseRuntimeConfig(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.chatEnabled).toBe(false);
      expect(result.config.activeIndex).toBe('none');
      expect(result.config.limits.outputMaxTokens).toBe(400);
    }
  });

  test('reports every parameter as missing for an empty source', () => {
    const issues = problemsFor({});
    expect(issues.map((i) => i.parameter).sort()).toEqual(
      [...PARAMETER_NAMES].sort(),
    );
    expect(issues.every((i) => i.problem === 'missing')).toBe(true);
  });

  test.each(PARAMETER_NAMES)('rejects a missing or empty %s', (name) => {
    for (const value of [undefined, '']) {
      const issues = problemsFor(withOverride({ [name]: value }));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ parameter: name, problem: 'missing' });
    }
  });

  test.each(['TRUE', 'True', '1', '0', 'yes', ' true', 'true ', 'on', 'null'])(
    'chat_enabled rejects %j',
    (value) => {
      expect(
        problemsFor(withOverride({ chat_enabled: value }))[0],
      ).toMatchObject({ parameter: 'chat_enabled', problem: 'invalid' });
    },
  );

  test('chat_enabled accepts only exact true or false', () => {
    const on = parseRuntimeConfig(withOverride({ chat_enabled: 'true' }));
    expect(on.ok && on.config.chatEnabled).toBe(true);
  });

  test.each(['chunks-0123abcd', `chunks-${'a'.repeat(64)}`])(
    'active_index accepts %s',
    (value) => {
      expect(parseRuntimeConfig(withOverride({ active_index: value })).ok).toBe(
        true,
      );
    },
  );

  test.each([
    'prod',
    'chunks-',
    'chunks-XYZ',
    'chunks-0123abc',
    `chunks-${'a'.repeat(65)}`,
    '../chunks-0123abcd',
    'chunks-0123abcd/extra',
    'NONE',
  ])('active_index rejects %j', (value) => {
    expect(problemsFor(withOverride({ active_index: value }))[0]).toMatchObject(
      {
        parameter: 'active_index',
        problem: 'invalid',
      },
    );
  });

  test.each(VALIDATED_LLM_CONFIGS.map((c) => JSON.stringify(c)))(
    'llm_config accepts the validated pair %s',
    (value) => {
      expect(parseRuntimeConfig(withOverride({ llm_config: value })).ok).toBe(
        true,
      );
    },
  );

  test.each([
    ['unknown provider', { provider: 'openai', model: 'gpt' }],
    [
      'known provider with an unvalidated model',
      { provider: 'bedrock-runtime', model: 'anthropic.claude-opus' },
    ],
    [
      'validated model on the wrong provider',
      { provider: 'bedrock-mantle', model: VALIDATED_LLM_CONFIGS[0].model },
    ],
    ['extra key', { ...VALIDATED_LLM_CONFIGS[0], temperature: 1 }],
    ['missing model', { provider: 'bedrock-runtime' }],
  ])('llm_config rejects %s', (_label, value) => {
    expect(
      problemsFor(withOverride({ llm_config: JSON.stringify(value) }))[0],
    ).toMatchObject({ parameter: 'llm_config', problem: 'invalid' });
  });

  test.each(['{', 'not json', '[]', 'null', '"text"', '42'])(
    'llm_config and limits reject non-object JSON %j',
    (value) => {
      const issues = problemsFor(
        withOverride({ llm_config: value, limits: value }),
      );
      expect(issues.map((i) => i.parameter).sort()).toEqual([
        'limits',
        'llm_config',
      ]);
    },
  );

  test.each([
    ['unknown key', { ...validLimits, extra: 1 }],
    ['zero', { ...validLimits, globalPerDay: 0 }],
    ['negative', { ...validLimits, guestPerIpPerDay: -1 }],
    ['a retired per-user limit', { ...validLimits, userPerDay: 10 }],
    ['fraction', { ...validLimits, historyTurns: 1.5 }],
    ['string number', { ...validLimits, outputMaxTokens: '400' }],
    ['over the upper bound', { ...validLimits, outputMaxTokens: 100_000 }],
    ['missing key', { ...validLimits, globalPerDay: undefined }],
  ])('limits rejects %s', (_label, value) => {
    expect(
      problemsFor(withOverride({ limits: JSON.stringify(value) }))[0],
    ).toMatchObject({ parameter: 'limits', problem: 'invalid' });
  });

  test('never echoes an offending value, which could be a secret', () => {
    const secret = 'SECRET-TOKEN-12345';
    const issues = problemsFor({
      chat_enabled: secret,
      active_index: secret,
      llm_config: JSON.stringify({
        provider: 'bedrock-runtime',
        model: secret,
      }),
      limits: JSON.stringify({
        ...validLimits,
        guestPerIpPerDay: secret,
        [secret]: 1,
      }),
    });
    expect(issues.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(issues)).not.toContain('SECRET');
  });

  test('never throws on hostile input', () => {
    const nasty = [
      '\u0000',
      '\ud800',
      '{"__proto__":{"x":1}}',
      'a'.repeat(100_000),
    ];
    for (const value of nasty) {
      expect(() =>
        parseRuntimeConfig({
          chat_enabled: value,
          active_index: value,
          llm_config: value,
          limits: value,
        }),
      ).not.toThrow();
    }
  });
});
