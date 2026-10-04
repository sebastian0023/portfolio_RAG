import { z } from 'zod';
import {
  CHAT_ERROR_CODES,
  MAX_EXCERPT_CHARS,
  MAX_QUESTION_LENGTH,
  type ChatStreamEvent,
} from './chat-stream.js';

// Trust-boundary validation for events arriving in the browser (ADR-044). Kept apart from the
// contract types so a bundle that only needs the types does not pull in zod.

const quotaSchema = z.strictObject({
  left: z.number().int().min(0),
  limit: z.number().int().min(1),
  principal: z.enum(['guest', 'user']),
});

const sourceSchema = z
  .strictObject({
    n: z.number().int().min(1),
    chunkId: z.string().min(1),
    sourceId: z.string().min(1),
    sourceUrl: z.url({ protocol: /^https$/ }).optional(),
    title: z.string().min(1),
    section: z.string(),
    path: z.string().min(1),
    updated: z.string(),
    excerpt: z.string().max(MAX_EXCERPT_CHARS),
    highlights: z.array(
      z.strictObject({
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      }),
    ),
  })
  .refine(
    (s) =>
      s.highlights.every((h) => h.start < h.end && h.end <= s.excerpt.length),
    {
      message: 'highlight ranges must lie inside the excerpt',
    },
  );

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('accepted'), quota: quotaSchema }),
  z.strictObject({
    type: z.literal('sources'),
    sources: z.array(sourceSchema).max(5),
  }),
  z.strictObject({ type: z.literal('delta'), text: z.string() }),
  z.strictObject({
    type: z.literal('done'),
    coverage: z.enum(['answered', 'none']),
    cited: z.array(z.number().int().min(1)),
  }),
  z.strictObject({
    type: z.literal('error'),
    error: z.strictObject({
      code: z.enum(CHAT_ERROR_CODES),
      retryAfterSeconds: z.number().int().min(1).optional(),
    }),
  }),
]);

export const chatRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  history: z.array(
    z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string() }),
  ),
});

// Compile-time proof that the schema and the exported type agree.
type Inferred = z.infer<typeof chatStreamEventSchema>;
const _assertAssignable = (event: Inferred): ChatStreamEvent => event;
void _assertAssignable;
