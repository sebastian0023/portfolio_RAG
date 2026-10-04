// Metadata-only logging port (ADR-028). The event type is closed on purpose: there is no field that could
// carry a question, an answer, a header value, or a raw IP address.
export interface LogEvent {
  readonly requestId: string;
  readonly stage: 'admission' | 'stream' | 'model' | 'transport';
  readonly outcome:
    'rejected' | 'completed' | 'interrupted' | 'client_closed' | 'failed';
  readonly status?: number;
  readonly errorCode?: string;
  readonly latencyMs?: number;
  readonly firstEventMs?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly stopReason?: string;
}

export interface Logger {
  log(event: LogEvent): void;
}
