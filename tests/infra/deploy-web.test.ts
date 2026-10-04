import { describe, expect, test } from 'vitest';
import {
  assertDistributionId,
  assertOwnedBucket,
  cacheControlFor,
  findConflictCopies,
  hasInlineScript,
  isDeployableBranchList,
  isHashedAsset,
  uploadOrder,
} from '../../infra/scripts/deploy-web-lib.ts';

describe('deploy-web decisions (P3-06)', () => {
  test('recognises content-addressed assets', () => {
    for (const path of [
      'main-YRONI2JU.js',
      'styles-LW3TWPOM.css',
      'media/sora-latin-400-normal-AB12CD34.woff2',
    ]) {
      expect(isHashedAsset(path), path).toBe(true);
    }
    for (const path of [
      'index.html',
      'favicon.ico',
      'version.json',
      'main.js',
    ]) {
      expect(isHashedAsset(path), path).toBe(false);
    }
  });

  test('hashed assets are immutable, the entry points are never cached, the rest is short-lived', () => {
    expect(cacheControlFor('main-YRONI2JU.js')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlFor('index.html')).toBe('no-cache');
    expect(cacheControlFor('version.json')).toBe('no-cache');
    expect(cacheControlFor('favicon.ico')).toBe('public, max-age=3600');
  });

  test('uploads assets before index.html and version.json last', () => {
    const order = uploadOrder([
      'index.html',
      'version.json',
      'favicon.ico',
      'main-YRONI2JU.js',
      'styles-LW3TWPOM.css',
    ]);
    expect(order).toEqual([
      'main-YRONI2JU.js',
      'styles-LW3TWPOM.css',
      'favicon.ico',
      'index.html',
      'version.json',
    ]);
  });

  test('flags iCloud conflict copies and nothing else', () => {
    expect(
      findConflictCopies([
        'index 2.html',
        'styles-LW3TWPOM 2.css',
        'media/font 3.woff2',
      ]),
    ).toHaveLength(3);
    expect(
      findConflictCopies([
        'index.html',
        'main-YRONI2JU.js',
        'media/sora-400-AB12CD34.woff2',
        'favicon.ico',
      ]),
    ).toEqual([]);
  });

  test('detects an inline script but not a script loaded by URL', () => {
    expect(hasInlineScript('<script>alert(1)</script>')).toBe(true);
    expect(hasInlineScript('<script type="module">boot()</script>')).toBe(true);
    expect(
      hasInlineScript('<script src="main-YRONI2JU.js" type="module"></script>'),
    ).toBe(false);
    expect(
      hasInlineScript(
        '<body><script type="module" src="a.js"></script></body>',
      ),
    ).toBe(false);
  });

  test('refuses a bucket outside the portfolio-v2 prefix', () => {
    expect(assertOwnedBucket('portfolio-v2-prod-web-123456789012')).toBe(
      'portfolio-v2-prod-web-123456789012',
    );
    for (const name of [
      'dsmm-portfolio-site',
      'portfolio-gha-tf-state',
      'portfolio-v2',
      undefined,
      42,
    ]) {
      expect(() => assertOwnedBucket(name)).toThrow(/prefix/);
    }
  });

  test('requires a well-formed distribution id', () => {
    expect(assertDistributionId('E2ABCDEF123456')).toBe('E2ABCDEF123456');
    for (const id of ['', 'e2abc', 'E2 ABC', undefined, '*']) {
      expect(() => assertDistributionId(id)).toThrow();
    }
  });

  test('deploys only code that is pushed to dev or a phase branch', () => {
    expect(isDeployableBranchList(['  origin/dev'])).toBe(true);
    expect(
      isDeployableBranchList([
        '  origin/phase/3-edge-api-skeleton',
        '  origin/p3/x',
      ]),
    ).toBe(true);
    expect(isDeployableBranchList(['  origin/p3/web-http'])).toBe(false);
    expect(isDeployableBranchList([''])).toBe(false);
    expect(isDeployableBranchList(['  origin/main'])).toBe(false);
  });
});
