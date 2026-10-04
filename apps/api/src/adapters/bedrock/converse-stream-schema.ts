import { z } from 'zod';

// Trust-boundary validation of what ConverseStream sends (ADR-044). Every event is an object with exactly one
// member naming its kind. Kinds this adapter does not use are accepted and ignored; a malformed member of a
// kind it does use is an error.
const usage = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

export const converseEventSchema = z.looseObject({
  contentBlockDelta: z
    .looseObject({ delta: z.looseObject({ text: z.string().optional() }) })
    .optional(),
  messageStop: z.looseObject({ stopReason: z.string() }).optional(),
  metadata: z.looseObject({ usage: usage.optional() }).optional(),
  internalServerException: z.unknown().optional(),
  modelStreamErrorException: z.unknown().optional(),
  validationException: z.unknown().optional(),
  throttlingException: z.unknown().optional(),
  serviceUnavailableException: z.unknown().optional(),
});

export type ConverseEvent = z.infer<typeof converseEventSchema>;
