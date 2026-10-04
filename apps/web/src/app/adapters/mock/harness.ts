import type { ChatErrorCode } from '@portfolio/shared';
import { CHAT_ERROR_CODES } from '@portfolio/shared';
import type { ThemeChoice } from '../../core/theme/theme.service';
import type { MockOutcome } from './mock-config';
import { isScenarioId, type ScenarioId } from './scenarios';

// Reads ?scenario=<id>&theme=<light|dark|system>&mock=<outcome,outcome,...> in dev and e2e builds.
// Outcomes: ok, network, empty, hang, interrupt:<n>, hang:<n>, error:<code>[:<seconds>].

export interface HarnessRequest {
  readonly scenario: ScenarioId | null;
  readonly theme: ThemeChoice | null;
  readonly outcomes: readonly MockOutcome[];
}

const THEMES: readonly ThemeChoice[] = ['light', 'dark', 'system'];

function isErrorCode(value: string | undefined): value is ChatErrorCode {
  return (CHAT_ERROR_CODES as readonly string[]).includes(value ?? '');
}

export function parseOutcome(token: string): MockOutcome | null {
  const [kind, a, b] = token.split(':');
  if (kind === 'ok' || kind === 'network' || kind === 'empty') return kind;
  if (kind === 'hang' && a === undefined) return 'hang';
  if (kind === 'hang' && Number.isInteger(Number(a)))
    return { hangAfter: Number(a) };
  if (kind === 'interrupt' && Number.isInteger(Number(a)))
    return { interruptAfter: Number(a) };
  if (kind === 'error' && isErrorCode(a)) {
    const seconds = b === undefined ? NaN : Number(b);
    return Number.isInteger(seconds) && seconds > 0
      ? { error: a, retryAfterSeconds: seconds }
      : { error: a };
  }
  return null;
}

export function readHarness(search: string): HarnessRequest {
  const params = new URLSearchParams(search);
  const scenario = params.get('scenario');
  const theme = params.get('theme');
  const outcomes = (params.get('mock') ?? '')
    .split(',')
    .filter(Boolean)
    .flatMap((token) => {
      const outcome = parseOutcome(token);
      return outcome ? [outcome] : [];
    });
  return {
    scenario: isScenarioId(scenario) ? scenario : null,
    theme: THEMES.find((t) => t === theme) ?? null,
    outcomes,
  };
}
