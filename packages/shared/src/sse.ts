// Data-only Server-Sent Events framing shared by the API encoder and the browser decoder (ADR-049).
// A frame is `data: <single-line JSON>\n\n`. No `event:`, `id:`, or `retry:` fields are used and the
// client never reconnects, so neither side needs more than this.

export function encodeSseEvent(event: unknown): string {
  // JSON.stringify never emits a raw newline, so one `data:` line always holds the whole event.
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface SseDecoder {
  // Feeds decoded text and returns the data payload of every frame completed by it.
  push(chunk: string): string[];
}

const DEFAULT_MAX_BUFFER_CHARS = 65_536;

// Incremental decoder. It tolerates frames split across chunks, CRLF and lone CR line endings (including a
// CR/LF pair split across chunks), comment lines, unknown fields, and several frames in one chunk. It
// throws when an incomplete frame grows past the cap, so a hostile stream cannot exhaust memory.
export function createSseDecoder(
  maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
): SseDecoder {
  let buffer = '';

  return {
    push(chunk: string): string[] {
      let text = buffer + chunk;
      // A trailing CR may be the first half of CRLF, so it waits for the next chunk.
      let pendingCr = '';
      if (text.endsWith('\r')) {
        pendingCr = '\r';
        text = text.slice(0, -1);
      }
      const frames = text.replace(/\r\n?/g, '\n').split('\n\n');
      buffer = (frames.pop() ?? '') + pendingCr;
      if (buffer.length > maxBufferChars) {
        throw new RangeError('SSE frame exceeds the buffer cap');
      }

      const payloads: string[] = [];
      for (const frame of frames) {
        const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
          }
        }
        if (data.length > 0) payloads.push(data.join('\n'));
      }
      return payloads;
    },
  };
}
