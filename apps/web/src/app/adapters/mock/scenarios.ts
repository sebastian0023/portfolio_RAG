import type { SourceCitation } from '@portfolio/shared';
import {
  Q_AWS,
  Q_INTERNSHIPS,
  Q_PROJECT,
  Q_STUDYING,
} from '../../content/suggestions';
import type {
  AssistantMessage,
  AssistantStatus,
  ChatMessage,
  ChatSeed,
} from '../../core/chat/chat-state';
import {
  answerFor,
  citedIn,
  NO_COVERAGE_TEXT,
  sourcesFor,
  tokenize,
} from './fixtures';
import type { MockConfig } from './mock-config';

// One entry per state in the Ask Portfolio design (Frames.dc.html). The harness seeds the facade
// and the mock backend from these so every frame is reachable by URL.

export const SCENARIO_IDS = [
  'live',
  'empty',
  'answered',
  'thinking',
  'streaming',
  'stopped',
  'error',
  'nocover',
  'sources',
  'guestCheck',
  'checkPassed',
  'checkFailed',
  'oneLeft',
  'outGuest',
  'siteLimit',
  'rateLimit',
  'unavailable',
  'network',
  'tooLong',
  'nearLimit',
  'overLimit',
  'how',
  'keyboard',
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export function isScenarioId(value: string | null): value is ScenarioId {
  return value !== null && (SCENARIO_IDS as readonly string[]).includes(value);
}

export interface Scenario {
  readonly seed: ChatSeed;
  readonly config: Partial<MockConfig>;
}

const LONG =
  "Could you give me a detailed overview of [Name]'s experience with AWS, including which services were used in each project, what role [Name] played, how the infrastructure was deployed and monitored, what was learned along the way, and how that experience would translate to a cloud engineering internship on a small product team that ships weekly and owns its infrastructure end to end? I would also like to know about testing practices, code review habits, documentation, and debugging under pressure.";

const NO_COVER_QUESTION = "What is [Name]'s favorite programming language?";

class Builder {
  private id = 0;

  user(text: string, time: string): ChatMessage {
    return { id: ++this.id, role: 'user', text, time };
  }

  bot(
    question: string,
    status: AssistantStatus,
    options: { text?: string; withSources?: boolean } = {},
  ): AssistantMessage {
    const answer = answerFor(question);
    const finished = status === 'done';
    const sources: readonly SourceCitation[] =
      answer && (finished || options.withSources) ? sourcesFor(answer) : [];
    return {
      id: ++this.id,
      role: 'assistant',
      question,
      status,
      text: options.text ?? '',
      sources,
      cited: answer && finished ? citedIn(answer) : [],
      coverage: finished ? (answer ? 'answered' : 'none') : null,
    };
  }

  finished(question: string, time: string): ChatMessage[] {
    const answer = answerFor(question);
    return [
      this.user(question, time),
      this.bot(question, 'done', {
        text: answer ? answer.text : NO_COVERAGE_TEXT,
      }),
    ];
  }

  partial(
    question: string,
    status: AssistantStatus,
    upTo: string,
  ): ChatMessage[] {
    const answer = answerFor(question);
    const words = tokenize(answer?.text ?? '');
    const cut = words.findIndex((w) => w.trim().replace(/[,.]$/, '') === upTo);
    const text = words
      .slice(0, cut < 0 ? Math.floor(words.length / 2) : cut + 1)
      .join('');
    return [
      this.user(question, '10:43 AM'),
      this.bot(question, status, { text, withSources: true }),
    ];
  }
}

// The guest limit mirrors GUEST_LIMIT (ADR-051).
const guest = (left: number) => ({
  left,
  limit: 10,
});

export function buildScenario(id: ScenarioId): Scenario {
  const b = new Builder();
  const answered = (): ChatMessage[] => b.finished(Q_STUDYING, '10:41 AM');
  let seed: ChatSeed = {};

  switch (id) {
    case 'live':
    case 'empty':
      break;
    case 'answered':
      seed = { messages: answered(), quota: guest(2), verified: true };
      break;
    case 'thinking':
      seed = {
        messages: [
          ...answered(),
          b.user(Q_AWS, '10:43 AM'),
          b.bot(Q_AWS, 'thinking'),
        ],
        quota: guest(1),
        verified: true,
      };
      break;
    case 'streaming':
      seed = {
        messages: [...answered(), ...b.partial(Q_AWS, 'streaming', 'learning')],
        quota: guest(1),
        verified: true,
      };
      break;
    case 'stopped':
      seed = {
        messages: [...answered(), ...b.partial(Q_AWS, 'stopped', 'in')],
        quota: guest(1),
        verified: true,
      };
      break;
    case 'error':
      seed = {
        messages: [...answered(), ...b.partial(Q_AWS, 'error', 'learning')],
        quota: guest(1),
        verified: true,
      };
      break;
    case 'nocover':
      seed = {
        messages: [...answered(), ...b.finished(NO_COVER_QUESTION, '10:44 AM')],
        quota: guest(1),
        verified: true,
      };
      break;
    case 'sources': {
      const messages = answered();
      seed = {
        messages,
        quota: guest(2),
        verified: true,
        viewer: { messageId: messages[1]!.id, index: 0 },
      };
      break;
    }
    case 'guestCheck':
      seed = { input: Q_STUDYING, check: 'checking' };
      break;
    case 'checkPassed':
      seed = { input: Q_STUDYING, check: 'passed' };
      break;
    case 'checkFailed':
      seed = { input: Q_STUDYING, check: 'failed' };
      break;
    case 'oneLeft':
      seed = {
        messages: [...answered(), ...b.finished(Q_AWS, '10:43 AM')],
        quota: guest(1),
        verified: true,
      };
      break;
    case 'outGuest':
      seed = {
        messages: [
          ...answered(),
          ...b.finished(Q_AWS, '10:43 AM'),
          ...b.finished(Q_INTERNSHIPS, '10:46 AM'),
        ],
        quota: guest(0),
        verified: true,
      };
      break;
    case 'siteLimit':
      seed = {
        messages: answered(),
        quota: guest(2),
        verified: true,
        siteLimit: true,
      };
      break;
    case 'rateLimit':
      seed = {
        messages: answered(),
        quota: guest(2),
        verified: true,
        inline: { kind: 'rate', seconds: 28 },
        input: Q_PROJECT,
      };
      break;
    case 'unavailable':
      seed = { chatEnabled: false };
      break;
    case 'how':
      seed = { dialog: 'how' };
      break;
    case 'network':
      seed = {
        messages: answered(),
        quota: guest(2),
        verified: true,
        inline: { kind: 'network' },
        input: Q_PROJECT,
      };
      break;
    case 'tooLong':
      seed = { verified: true, inline: { kind: 'too_long' }, input: LONG };
      break;
    case 'nearLimit':
      seed = { verified: true, input: LONG.slice(0, 462) };
      break;
    case 'overLimit':
      seed = { verified: true, input: LONG };
      break;
    case 'keyboard':
      seed = {
        messages: answered(),
        quota: guest(2),
        verified: true,
        input: 'Which AWS services has',
      };
      break;
  }

  const quota = seed.quota;
  const config: Partial<MockConfig> = {
    ...(quota ? { guestLeft: quota.left } : {}),
    ...(seed.chatEnabled === false ? { enabled: false } : {}),
    ...(seed.siteLimit ? { siteLimited: true } : {}),
  };
  return { seed, config };
}
