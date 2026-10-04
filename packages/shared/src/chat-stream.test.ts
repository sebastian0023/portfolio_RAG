import { describe, expect, test } from 'vitest';
import {
  chatRequestSchema,
  chatStreamEventSchema,
} from './chat-stream-schema.js';

const source = {
  n: 1,
  chunkId: 'education#0',
  sourceId: 'education',
  sourceUrl: 'https://example.com/education',
  title: 'Education',
  section: 'Studies',
  path: 'knowledge/education.md',
  updated: '2026-09-12',
  excerpt: 'Studies Systems Engineering. Expected graduation soon.',
  highlights: [{ start: 0, end: 28 }],
};

describe('chat stream contract (ADR-048)', () => {
  test('accepts every event kind', () => {
    const events = [
      { type: 'accepted', quota: { left: 2, limit: 3 } },
      { type: 'sources', sources: [source] },
      { type: 'delta', text: 'Hello [1]' },
      { type: 'done', coverage: 'answered', cited: [1] },
      { type: 'error', error: { code: 'rate_limited', retryAfterSeconds: 28 } },
    ];
    for (const event of events) {
      expect(
        chatStreamEventSchema.safeParse(event).success,
        JSON.stringify(event),
      ).toBe(true);
    }
  });

  test('rejects unknown error codes, extra fields, and non-https source links', () => {
    expect(
      chatStreamEventSchema.safeParse({
        type: 'error',
        error: { code: 'teapot' },
      }).success,
    ).toBe(false);
    expect(
      chatStreamEventSchema.safeParse({ type: 'delta', text: 'x', extra: 1 })
        .success,
    ).toBe(false);
    expect(
      chatStreamEventSchema.safeParse({
        type: 'sources',
        sources: [{ ...source, sourceUrl: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false);
  });

  test('rejects highlight ranges outside the excerpt and oversized excerpts', () => {
    const bad = { ...source, highlights: [{ start: 10, end: 9999 }] };
    expect(
      chatStreamEventSchema.safeParse({ type: 'sources', sources: [bad] })
        .success,
    ).toBe(false);
    const long = { ...source, excerpt: 'x'.repeat(601), highlights: [] };
    expect(
      chatStreamEventSchema.safeParse({ type: 'sources', sources: [long] })
        .success,
    ).toBe(false);
  });

  test('bounds the question at 500 characters', () => {
    expect(
      chatRequestSchema.safeParse({ question: 'a'.repeat(500), history: [] })
        .success,
    ).toBe(true);
    expect(
      chatRequestSchema.safeParse({ question: 'a'.repeat(501), history: [] })
        .success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({ question: '   ', history: [] }).success,
    ).toBe(false);
  });
});
