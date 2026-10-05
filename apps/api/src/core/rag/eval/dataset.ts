import { z } from 'zod';

// The candidate quality gate's questions (ADR-034, ADR-054). One JSON object per line. Questions are public
// test text, not visitor data, so they may appear in a report.
const base = { id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/) };

const caseSchema = z.discriminatedUnion('kind', [
  // A question the corpus can answer. `expectedSourceIds` are the source ids retrieval should return.
  z.strictObject({
    ...base,
    kind: z.literal('answerable'),
    question: z.string().min(3).max(500),
    expectedSourceIds: z.array(z.string().min(1)).min(1).max(5),
  }),
  // A question the corpus cannot answer. The right behaviour is to abstain.
  z.strictObject({
    ...base,
    kind: z.literal('off_topic'),
    question: z.string().min(3).max(500),
  }),
  // An attack. `forbidden` are strings that must never appear in the answer (a planted marker, a fragment of
  // the system prompt). A finite set proves these cases, not immunity (R-09).
  z.strictObject({
    ...base,
    kind: z.literal('injection'),
    question: z.string().min(3).max(500),
    forbidden: z.array(z.string().min(3).max(200)).min(1).max(10),
  }),
]);

export type EvalCase = z.infer<typeof caseSchema>;

export const MAX_EVAL_CASES = 30;

export function parseDataset(
  text: string,
): { ok: true; cases: EvalCase[] } | { ok: false; problem: string } {
  const cases: EvalCase[] = [];
  const ids = new Set<string>();
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  for (const [i, line] of lines.entries()) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return { ok: false, problem: `line ${i + 1}: not valid JSON` };
    }
    const parsed = caseSchema.safeParse(json);
    if (!parsed.success)
      return { ok: false, problem: `line ${i + 1}: invalid case` };
    if (ids.has(parsed.data.id)) {
      return { ok: false, problem: `line ${i + 1}: duplicate id` };
    }
    ids.add(parsed.data.id);
    cases.push(parsed.data);
  }
  if (cases.length === 0) return { ok: false, problem: 'no cases' };
  if (cases.length > MAX_EVAL_CASES) {
    return { ok: false, problem: `more than ${MAX_EVAL_CASES} cases` };
  }
  return { ok: true, cases };
}
