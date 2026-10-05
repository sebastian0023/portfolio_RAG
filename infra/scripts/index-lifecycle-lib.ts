// Pure decisions behind infra/scripts/index-lifecycle.ts, kept apart so they can be tested without AWS
// (ADR-019, ADR-053, R-16). Nothing here performs I/O. The one rule that matters most: no code path may select
// the active index, a rollback target, or anything that was live recently for deletion.

export const INDEX_NAME = /^chunks-[0-9a-f]{16}$/;
export const NONE = 'none';

// The active index plus the previous two stay available for rollback.
export const KEEP_PREVIOUS = 2;
// Anything that was live this recently may still be served by a Lambda that cached the old value. It must be
// longer than the config cache (30 s) plus the function timeout (30 s + 5 s margin); tests pin that.
export const PRUNE_GRACE_MS = 10 * 60_000;
// A fresh index may be a candidate someone is still building or evaluating.
export const RECENT_INDEX_MS = 24 * 3_600_000;
export const REPORT_MAX_AGE_MS = 24 * 3_600_000;
const CLOCK_SKEW_MS = 5 * 60_000;

export interface HistoryEntry {
  readonly version: number;
  readonly value: string;
  readonly modifiedAt: number;
}

export interface IndexSummary {
  readonly name: string;
  readonly createdAt: number;
}

// Sorted-key JSON without whitespace. The eval report stores llm_config this way, and promotion compares it with
// the live parameter, so both sides must serialize identically.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function toMillis(value: unknown): number {
  // `aws ssm get-parameter-history` prints epoch seconds or an ISO string depending on the CLI's timestamp format.
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  throw new Error('unreadable timestamp in parameter history');
}

// Fails closed: any entry that is not exactly what the guard expects makes the whole history unusable, so a
// pruning decision is never made from partial information.
export function parseHistory(json: string): HistoryEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('parameter history is not valid JSON');
  }
  const list = (raw as { Parameters?: unknown } | null)?.Parameters;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('parameter history is empty or malformed');
  }
  const entries = list.map((item): HistoryEntry => {
    const p = item as {
      Version?: unknown;
      Value?: unknown;
      LastModifiedDate?: unknown;
    };
    if (!Number.isInteger(p.Version) || typeof p.Value !== 'string') {
      throw new Error('malformed parameter history entry');
    }
    if (p.Value !== NONE && !INDEX_NAME.test(p.Value)) {
      throw new Error(
        'parameter history holds a value that is not an index name',
      );
    }
    return {
      version: p.Version as number,
      value: p.Value,
      modifiedAt: toMillis(p.LastModifiedDate),
    };
  });
  return entries.sort((a, b) => a.version - b.version);
}

export interface Retention {
  readonly active: string;
  // Most recent first. Never contains the active index or `none`.
  readonly previous: readonly string[];
  // Values that stopped being active less than the grace period ago.
  readonly grace: readonly string[];
}

export function retention(
  history: readonly HistoryEntry[],
  now: number,
  keepPrevious: number = KEEP_PREVIOUS,
  graceMs: number = PRUNE_GRACE_MS,
): Retention {
  const last = history.at(-1);
  if (last === undefined) throw new Error('no parameter history');
  const active = last.value;
  const previous: string[] = [];
  const grace = new Set<string>();
  for (let i = history.length - 2; i >= 0; i--) {
    const entry = history[i]!;
    const value = entry.value;
    if (value === NONE || value === active) continue;
    if (!previous.includes(value) && previous.length < keepPrevious)
      previous.push(value);
    // The value held from `entry` until the next change; it stopped being live at the next entry's time.
    const endedAt = history[i + 1]!.modifiedAt;
    if (now - endedAt < graceMs) grace.add(value);
  }
  return { active, previous, grace: [...grace] };
}

export interface PrunePlan {
  readonly delete: readonly string[];
  readonly keep: readonly { readonly name: string; readonly reason: string }[];
}

// Decides what `prune` may delete. An index is deleted only if it is one of ours, is not the active index, is not
// among the retained previous indexes, was not live within the grace window, and is old enough not to be an
// in-flight candidate. Inconsistent input (no history, or an active index that does not exist) is an error.
export function planPrune(
  indexes: readonly IndexSummary[],
  history: readonly HistoryEntry[],
  now: number,
): PrunePlan {
  const r = retention(history, now);
  if (r.active !== NONE && !indexes.some((i) => i.name === r.active)) {
    throw new Error('the active index is not in the bucket; refusing to prune');
  }
  const toDelete: string[] = [];
  const keep: { name: string; reason: string }[] = [];
  for (const index of indexes) {
    let reason: string | undefined;
    if (!INDEX_NAME.test(index.name)) reason = 'not an index this tool manages';
    else if (index.name === r.active) reason = 'active';
    else if (r.previous.includes(index.name)) reason = 'retained for rollback';
    else if (r.grace.includes(index.name)) reason = 'recently live';
    else if (!(now - index.createdAt >= RECENT_INDEX_MS))
      reason = 'created within 24 hours';
    if (reason === undefined) toDelete.push(index.name);
    else keep.push({ name: index.name, reason });
  }
  return { delete: toDelete, keep };
}

export interface ReportExpectations {
  readonly candidate: string;
  readonly manifestSha256: string;
  readonly llmConfig: string;
  readonly now: number;
}

// A report promotes one build of one index with one model configuration, recently. Returns what is wrong.
export function verifyReport(
  report: unknown,
  expected: ReportExpectations,
): string[] {
  const problems: string[] = [];
  if (report === null || typeof report !== 'object')
    return ['the report is not an object'];
  const r = report as Record<string, unknown>;
  if (r['schema'] !== 1) problems.push('unsupported report schema');
  if (r['passed'] !== true) problems.push('the report did not pass');
  if (r['index'] !== expected.candidate)
    problems.push('the report is for a different index');
  if (r['manifestSha256'] !== expected.manifestSha256) {
    problems.push('the report is for a different build of this index');
  }
  if (r['llmConfig'] !== expected.llmConfig) {
    problems.push('the model configuration has changed since the report');
  }
  const created =
    typeof r['createdAt'] === 'string'
      ? Date.parse(r['createdAt'])
      : Number.NaN;
  if (!Number.isFinite(created)) problems.push('the report has no valid time');
  else if (created - expected.now > CLOCK_SKEW_MS)
    problems.push('the report is dated in the future');
  else if (expected.now - created > REPORT_MAX_AGE_MS)
    problems.push('the report is older than 24 hours');
  return problems;
}

export interface CandidateState {
  readonly exists: boolean;
  readonly complete: boolean;
  readonly manifestSha256: string | undefined;
  readonly keyCount: number;
}

export function checkCandidate(
  candidate: string,
  state: CandidateState,
  manifest: { readonly manifestSha256: string; readonly keyCount: number },
  active: string,
): string[] {
  const problems: string[] = [];
  if (!INDEX_NAME.test(candidate))
    return ['the candidate is not a chunks-<16 hex> index name'];
  if (candidate === active)
    problems.push('the candidate is already the active index');
  if (!state.exists) return [...problems, 'the candidate index does not exist'];
  if (!state.complete) problems.push('the candidate is not tagged complete');
  if (state.manifestSha256 !== manifest.manifestSha256) {
    problems.push('the index tags a different manifest than the one on disk');
  }
  if (state.keyCount !== manifest.keyCount) {
    problems.push("the index does not hold exactly the manifest's chunks");
  }
  return problems;
}

// Target of `rollback` when none is given: the most recent previous index. Going back to `none` must be explicit
// because it switches retrieval off.
export function defaultRollbackTarget(
  history: readonly HistoryEntry[],
  now: number,
): string | undefined {
  return retention(history, now).previous[0];
}

// SSM offers no compare-and-swap. The tool reads the version, writes, and requires the answer to be exactly the
// next version; anything else means another writer got in between.
export function wroteExpectedVersion(
  readVersion: number,
  returnedVersion: number,
): boolean {
  return returnedVersion === readVersion + 1;
}
