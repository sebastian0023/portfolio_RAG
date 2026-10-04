import type { QuotaState, SourceCitation } from '@portfolio/shared';
import type { SessionInfo } from '../ports/session-port';

export const GUEST_LIMIT = 3;
export const SIGNED_IN_LIMIT = 10;

export type AssistantStatus =
  'thinking' | 'streaming' | 'done' | 'stopped' | 'error';

export interface UserMessage {
  readonly id: number;
  readonly role: 'user';
  readonly text: string;
  readonly time: string;
}

export interface AssistantMessage {
  readonly id: number;
  readonly role: 'assistant';
  readonly question: string;
  readonly status: AssistantStatus;
  // Raw model text with [n] markers; templates only ever see parsed segments.
  readonly text: string;
  readonly sources: readonly SourceCitation[];
  readonly cited: readonly number[];
  readonly coverage: 'answered' | 'none' | null;
}

export type ChatMessage = UserMessage | AssistantMessage;

export type ChatPhase =
  | 'idle'
  | 'verifying'
  | 'submitting'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'cancelled';

export type CheckState = 'idle' | 'checking' | 'passed' | 'failed';

export type InlineAlert =
  | { readonly kind: 'rate'; readonly seconds: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'too_long' };

export type DialogKind = 'signin' | 'how';

export interface ViewerRef {
  readonly messageId: number;
  readonly index: number;
}

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly text: string;
}

// Initial state for a facade instance. The scenario harness uses it to reach any design frame
// directly; production starts empty.
export interface ChatSeed {
  readonly messages?: readonly ChatMessage[];
  readonly quota?: QuotaState;
  readonly session?: SessionInfo;
  readonly verified?: boolean;
  readonly check?: CheckState;
  readonly input?: string;
  readonly inline?: InlineAlert | null;
  readonly dialog?: DialogKind | null;
  readonly viewer?: ViewerRef | null;
  readonly redirecting?: boolean;
  readonly chatEnabled?: boolean;
  readonly siteLimit?: boolean;
  readonly toasts?: readonly Toast[];
}
