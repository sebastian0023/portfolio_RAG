// Metadata-only logging port (ADR-028). The event type is closed on purpose: there is no field that could
// carry a question, an answer, a header value, or a raw IP address.
export interface LogEvent {
  readonly requestId: string;
  readonly stage:
    'admission' | 'stream' | 'model' | 'transport' | 'guest_pass' | 'retrieval';
  readonly outcome:
    'rejected' | 'completed' | 'interrupted' | 'client_closed' | 'failed';
  readonly status?: number;
  readonly errorCode?: string;
  readonly latencyMs?: number;
  readonly firstEventMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly stopReason?: string;
  // Retrieval (ADR-054). Counts, scores, and ids only: never the question, a title, or chunk text.
  readonly index?: string;
  readonly matchCount?: number;
  readonly keptCount?: number;
  readonly droppedCount?: number;
  readonly topScore?: number;
  // Safe chunk ids (`<source>#<section>-<k>`), at most five.
  readonly chunkIds?: readonly string[];
  readonly embedTokens?: number;
  readonly citedCount?: number;
  // Markers the model wrote that had no matching source.
  readonly unmatchedCitations?: number;
}

export interface Logger {
  log(event: LogEvent): void;
}
