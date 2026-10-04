import { describe, expect, test } from 'vitest';
import { createSseDecoder, encodeSseEvent } from './sse.js';

describe('SSE framing (ADR-049)', () => {
  test('encodes one single-line data frame', () => {
    const frame = encodeSseEvent({ type: 'delta', text: 'a\nb' });
    expect(frame).toBe('data: {"type":"delta","text":"a\\nb"}\n\n');
    expect(frame.slice(0, -2)).not.toContain('\n');
  });

  test('decodes what the encoder produces', () => {
    const decoder = createSseDecoder();
    const event = { type: 'done', coverage: 'none', cited: [] };
    expect(decoder.push(encodeSseEvent(event))).toEqual([
      JSON.stringify(event),
    ]);
  });

  test('reassembles a frame split across chunks', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: {"a"')).toEqual([]);
    expect(decoder.push(':1}\n')).toEqual([]);
    expect(decoder.push('\n')).toEqual(['{"a":1}']);
  });

  test('returns several frames from one chunk and keeps a partial tail', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: 1\n\ndata: 2\n\ndata: 3')).toEqual(['1', '2']);
    expect(decoder.push('\n\n')).toEqual(['3']);
  });

  test('accepts CRLF and lone CR, even when a pair is split across chunks', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: 1\r\n\r\n')).toEqual(['1']);
    // A trailing CR may begin a CRLF pair, so the frame it ends completes with the next chunk.
    expect(decoder.push('data: 2\r\r')).toEqual([]);
    expect(decoder.push('data: 3\r')).toEqual(['2']);
    expect(decoder.push('\n\r')).toEqual([]);
    expect(decoder.push('\n')).toEqual(['3']);
  });

  test('ignores comments, unknown fields, and frames without data', () => {
    const decoder = createSseDecoder();
    expect(
      decoder.push(
        ': keep-alive\n\nevent: x\nid: 7\nretry: 5\n\ndata: ok\nevent: y\n\n',
      ),
    ).toEqual(['ok']);
  });

  test('joins multiple data lines and strips one leading space', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data:a\ndata:  b\n\n')).toEqual(['a\n b']);
  });

  test('throws when an unfinished frame exceeds the cap', () => {
    const decoder = createSseDecoder(16);
    expect(() => decoder.push('data: ' + 'x'.repeat(40))).toThrow(RangeError);
  });
});
