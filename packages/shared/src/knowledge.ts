// Vocabulary shared by ingestion, retrieval, and the browser contract (ADR-053, ADR-054).

export const SOURCE_KINDS = [
  'experience',
  'project',
  'skill',
  'education',
  'faq',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

// The browser rejects a `sources` event with more entries than this (chat-stream-schema.ts).
export const MAX_SOURCES = 5;

// Hosts a source file or citation may link to. Empty until the owner approves the list with the corpus (P5-01),
// so no link is accepted before then.
export const ALLOWED_SOURCE_HOSTS: readonly string[] = [];

// https only, no credentials, no explicit port, and an exact (case-insensitive) match on an allowed host.
export function isAllowedSourceUrl(
  value: string,
  hosts: readonly string[] = ALLOWED_SOURCE_HOSTS,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    hosts.some((host) => host.toLowerCase() === url.hostname)
  );
}
