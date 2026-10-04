import type { ChatRequest } from '@portfolio/shared';

const encoder = new TextEncoder();

export interface FittedRequest {
  readonly request: ChatRequest;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

// Earlier assistant answers can be long, so a full history may not fit the byte cap. The oldest turns go
// first. The hash and the body are computed from the same bytes, so fitting must happen before hashing. The
// server normalises whatever history it receives, so dropping one turn at a time is safe.
export function fitRequest(
  request: ChatRequest,
  maxBytes: number,
): FittedRequest {
  let current = request;
  let bytes = encoder.encode(JSON.stringify(current));
  while (bytes.byteLength > maxBytes && current.history.length > 0) {
    current = { ...current, history: current.history.slice(1) };
    bytes = encoder.encode(JSON.stringify(current));
  }
  return { request: current, bytes };
}
