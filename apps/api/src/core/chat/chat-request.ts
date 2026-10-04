import { z } from 'zod';

// The server never trusts the client's history bounds (ADR-048): the shared browser schema has no array or
// text cap, so a hostile client could send a huge history inside the byte cap. These caps are generous
// ceilings; the service keeps only the last limits.historyTurns turns.
export const MAX_HISTORY_ITEMS = 20;
export const MAX_TURN_CHARS = 4000;

export const serverChatRequestSchema = z.strictObject({
  question: z.string(),
  history: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(MAX_TURN_CHARS),
      }),
    )
    .max(MAX_HISTORY_ITEMS),
});

export type ParsedChatRequest = z.infer<typeof serverChatRequestSchema>;
