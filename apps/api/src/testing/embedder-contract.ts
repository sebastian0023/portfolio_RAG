// Contract suite every Embedder must pass (ADR-045). The harness builds an embedder whose backend follows a
// scenario, so the same assertions run against the fake and the Titan adapter.
import type { EmbedErrorCode, Embedder } from '@portfolio/shared';
import { EMBEDDING_CONFIG } from '@portfolio/shared';
import { describe, expect, test } from 'vitest';

export const RAW_EMBED_DETAIL = 'RAW-EMBED-DETAIL-51ce';

export type EmbedScenario =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'error';
      readonly code: Exclude<EmbedErrorCode, 'cancelled' | 'invalid_request'>;
    };

export interface BuiltEmbedder {
  readonly embedder: Embedder;
  calls(): number;
}

export interface EmbedderHarness {
  build(scenario: EmbedScenario): BuiltEmbedder;
}

export function runEmbedderContract(
  name: string,
  harness: EmbedderHarness,
): void {
  describe(`Embedder contract: ${name}`, () => {
    test('returns a finite, non-zero vector of the configured dimension', async () => {
      const built = harness.build({ kind: 'ok' });
      const result = await built.embedder.embed('What did Alex study?');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.vector).toHaveLength(EMBEDDING_CONFIG.dimensions);
      expect(result.vector.every(Number.isFinite)).toBe(true);
      expect(result.vector.some((x) => x !== 0)).toBe(true);
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(built.calls()).toBe(1);
    });

    test('reports the configuration that goes into the manifest hash', () => {
      expect(harness.build({ kind: 'ok' }).embedder.config).toEqual(
        EMBEDDING_CONFIG,
      );
    });

    test.each([
      ['empty text', ''],
      ['whitespace only', '   \n '],
      ['text over the length cap', 'word '.repeat(2000)],
    ])('rejects %s without calling the backend', async (_name, text) => {
      const built = harness.build({ kind: 'ok' });
      expect(await built.embedder.embed(text)).toEqual({
        ok: false,
        code: 'invalid_request',
      });
      expect(built.calls()).toBe(0);
    });

    test('an aborted signal makes no backend call', async () => {
      const built = harness.build({ kind: 'ok' });
      expect(
        await built.embedder.embed('hello world', AbortSignal.abort()),
      ).toEqual({
        ok: false,
        code: 'cancelled',
      });
      expect(built.calls()).toBe(0);
    });

    test.each(['throttled', 'unavailable', 'internal'] as const)(
      'maps a %s backend failure and never leaks its detail',
      async (code) => {
        const built = harness.build({ kind: 'error', code });
        const result = await built.embedder.embed('hello world');
        expect(result).toEqual({ ok: false, code });
        expect(JSON.stringify(result)).not.toContain(RAW_EMBED_DETAIL);
      },
    );
  });
}
