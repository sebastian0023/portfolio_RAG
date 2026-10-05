import { z } from 'zod';
import { INDEX_NAME_PATTERN } from '../knowledge/config.js';

// Names of the SSM parameters under the stack prefix. infra/modules/ssm/parameters.json is the
// single source of their defaults; tests/contracts/ssm-parameters.test.ts keeps both in step.
export const PARAMETER_NAMES = [
  'chat_enabled',
  'active_index',
  'llm_config',
  'limits',
] as const;

export type ParameterName = (typeof PARAMETER_NAMES)[number];

// Only provider/model pairs that passed evaluation may run (ADR-021, ADR-022).
// Adding a candidate is a deliberate edit here after Phase 6 evidence.
export const VALIDATED_LLM_CONFIGS = [
  {
    provider: 'bedrock-runtime',
    model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
  {
    provider: 'bedrock-runtime',
    model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
  { provider: 'bedrock-mantle', model: 'google.gemma-4-26b-a4b' },
] as const;

const llmConfigSchema = z
  .strictObject({
    provider: z.enum(['bedrock-runtime', 'bedrock-mantle']),
    model: z.string().min(1).max(200),
  })
  .refine(
    (value) =>
      VALIDATED_LLM_CONFIGS.some(
        (known) =>
          known.provider === value.provider && known.model === value.model,
      ),
    { message: 'provider and model are not a validated pair' },
  );

const positiveInt = (max: number) => z.number().int().min(1).max(max);

const limitsSchema = z.strictObject({
  questionMaxChars: positiveInt(2000),
  requestMaxBytes: positiveInt(65_536),
  historyTurns: positiveInt(20),
  retrievedChunks: positiveInt(20),
  chunkMaxTokens: positiveInt(4000),
  promptMaxTokens: positiveInt(20_000),
  outputMaxTokens: positiveInt(2000),
  timeoutSeconds: positiveInt(300),
  preAuthPerIpPerMinute: positiveInt(1000),
  preAuthGlobalPerMinute: positiveInt(100_000),
  guestPerIpPerDay: positiveInt(1000),
  globalPerDay: positiveInt(100_000),
});

const activeIndexSchema = z.union([
  z.literal('none'),
  z.string().regex(INDEX_NAME_PATTERN),
]);

export type Limits = z.infer<typeof limitsSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;

export interface RuntimeConfig {
  readonly chatEnabled: boolean;
  readonly activeIndex: string;
  readonly llm: LlmConfig;
  readonly limits: Limits;
}

export interface ConfigIssue {
  readonly parameter: ParameterName | '*';
  readonly problem: 'missing' | 'invalid' | 'unreadable';
  // Describes the problem only. Never contains the offending value, which could be a secret.
  readonly detail: string;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: RuntimeConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

type RawParameters = Readonly<Partial<Record<string, string | undefined>>>;

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

// Zod messages can quote parts of the input (for example an unrecognized key name), and the input
// may hold a secret pasted into the wrong parameter. Report the issue code and path only; our own
// static refinement messages are the one exception.
function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.join('.') || '(value)';
      return `${where}: ${issue.code === 'custom' ? issue.message : issue.code}`;
    })
    .join('; ');
}

// Validates raw SSM string values at the trust boundary (ADR-044). Never throws and never falls
// back to a default: any missing or invalid value means the whole config is unusable.
export function parseRuntimeConfig(raw: RawParameters): ConfigResult {
  const issues: ConfigIssue[] = [];
  const fail = (
    parameter: ParameterName,
    problem: 'missing' | 'invalid',
    detail: string,
  ): void => {
    issues.push({ parameter, problem, detail });
  };

  const text = (name: ParameterName): string | undefined => {
    const value = raw[name];
    if (value === undefined || value === '') {
      fail(name, 'missing', 'parameter is absent or empty');
      return undefined;
    }
    return value;
  };

  let chatEnabled: boolean | undefined;
  const chatText = text('chat_enabled');
  if (chatText !== undefined) {
    if (chatText === 'true' || chatText === 'false') {
      chatEnabled = chatText === 'true';
    } else {
      fail('chat_enabled', 'invalid', 'must be exactly "true" or "false"');
    }
  }

  let activeIndex: string | undefined;
  const indexText = text('active_index');
  if (indexText !== undefined) {
    const parsed = activeIndexSchema.safeParse(indexText);
    if (parsed.success) activeIndex = parsed.data;
    else fail('active_index', 'invalid', describe(parsed.error));
  }

  const parseJsonParameter = <T>(
    name: 'llm_config' | 'limits',
    schema: z.ZodType<T>,
  ): T | undefined => {
    const jsonText = text(name);
    if (jsonText === undefined) return undefined;
    const json = parseJson(jsonText);
    if (!json.ok) {
      fail(name, 'invalid', 'not valid JSON');
      return undefined;
    }
    const parsed = schema.safeParse(json.value);
    if (!parsed.success) {
      fail(name, 'invalid', describe(parsed.error));
      return undefined;
    }
    return parsed.data;
  };

  const llm = parseJsonParameter('llm_config', llmConfigSchema);
  const limits = parseJsonParameter('limits', limitsSchema);

  if (
    issues.length > 0 ||
    chatEnabled === undefined ||
    activeIndex === undefined ||
    llm === undefined ||
    limits === undefined
  ) {
    return { ok: false, issues };
  }
  return { ok: true, config: { chatEnabled, activeIndex, llm, limits } };
}
