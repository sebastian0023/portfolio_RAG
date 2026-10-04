// Pure decisions behind infra/scripts/deploy-web.ts, kept apart so they can be tested without AWS.

export const NAME_PREFIX = 'portfolio-v2-';

// Build hashes from the Angular builder look like `-YRONI2JU` before the extension.
const HASHED = /[-.][A-Z0-9]{8}\.[a-z0-9]+$/;

// iCloud and Finder leave "file 2.ext" conflict copies. They are never part of a build, so one in the output
// means the working tree is damaged and must not be published.
const CONFLICT_COPY = / \d+(\.[^./ ]+)?$/;

export function findConflictCopies(paths: readonly string[]): string[] {
  return paths.filter((path) => {
    const name = path.split('/').pop() ?? path;
    return CONFLICT_COPY.test(name) || /\s\d+\.[a-z0-9]+$/i.test(name);
  });
}

// A script tag without a src attribute is inline script. The production CSP forbids it, so publishing one
// would ship a blank page.
export function hasInlineScript(html: string): boolean {
  return /<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html);
}

export const isHashedAsset = (path: string): boolean => HASHED.test(path);

export function cacheControlFor(path: string): string {
  if (path === 'index.html' || path === 'version.json') {
    return 'no-cache';
  }
  if (isHashedAsset(path)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

// Hashed assets first, other files next, index.html and version.json last, so a visitor never gets an
// index.html that points at assets that are not there yet.
export function uploadOrder(paths: readonly string[]): string[] {
  const rank = (path: string): number =>
    path === 'index.html'
      ? 3
      : path === 'version.json'
        ? 4
        : isHashedAsset(path)
          ? 1
          : 2;
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// The deploy only ever touches portfolio-v2 resources in the shared account (ADR-047).
export function assertOwnedBucket(name: unknown): string {
  if (typeof name !== 'string' || !name.startsWith(NAME_PREFIX)) {
    throw new Error(
      `refusing to deploy to a bucket outside the ${NAME_PREFIX} prefix`,
    );
  }
  return name;
}

export function assertDistributionId(id: unknown): string {
  if (typeof id !== 'string' || !/^[A-Z0-9]{10,16}$/.test(id)) {
    throw new Error('terraform output distribution_id is missing or malformed');
  }
  return id;
}

// Only code that is pushed and reachable from the integration or phase branches may be deployed.
export function isDeployableBranchList(
  remoteBranches: readonly string[],
): boolean {
  return remoteBranches.some((branch) =>
    /^origin\/(dev|phase\/[\w.-]+)$/.test(branch.trim()),
  );
}

// The production build needs the public Turnstile sitekey (ADR-052). An empty one ships a page whose bot check
// can never pass, so the deploy refuses it. `source` is the text of src/environments/environment.ts.
export function hasTurnstileSiteKey(source: string): boolean {
  return /turnstileSiteKey:\s*'0x[0-9A-Za-z_-]{16,}'/.test(source);
}
