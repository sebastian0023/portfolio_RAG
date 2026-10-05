// Everything that reaches the model from outside the system prompt is untrusted: the visitor's question, earlier
// turns, and the corpus text (R-09). These helpers keep it from posing as structure.

// Escapes the characters that could close or open a tag, so `</source>` in a chunk is just text.
export function escapeForPrompt(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// `[1]` means "source 1" only when the model writes it. A marker inside untrusted text is rewritten so it can
// neither be copied as a fabricated citation nor confused with the real numbering.
export function neutralizeMarkers(text: string): string {
  return text.replace(/\[(\d+)\]/g, '($1)');
}

export const untrusted = (text: string): string =>
  escapeForPrompt(neutralizeMarkers(text));
