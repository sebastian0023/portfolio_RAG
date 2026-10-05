import type { ChatTurn, LLMTurn } from '@portfolio/shared';

// The browser sends whatever history it has, including turns left over from failed answers, and the client is
// untrusted. The model API needs strictly alternating roles that start with a user turn, and the new question
// is appended as a user turn, so the history must end with an assistant turn.
export function normalizeHistory(
  history: readonly ChatTurn[],
  maxTurns: number,
): LLMTurn[] {
  const merged: LLMTurn[] = [];
  for (const turn of history) {
    const text = turn.text.trim();
    if (text === '') continue;
    const last = merged.at(-1);
    if (last?.role === turn.role) {
      merged[merged.length - 1] = {
        role: last.role,
        text: `${last.text}\n\n${text}`,
      };
    } else {
      merged.push({ role: turn.role, text });
    }
  }
  while (merged.at(-1)?.role === 'user') merged.pop();
  let kept = maxTurns > 0 ? merged.slice(-maxTurns) : [];
  while (kept[0]?.role === 'assistant') kept = kept.slice(1);
  return kept;
}
