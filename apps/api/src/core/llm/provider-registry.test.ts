import { describe, expect, test } from 'vitest';
import { VALIDATED_LLM_CONFIGS } from '../config/runtime-config.js';
import { fakeProvider } from '../../testing/fake-llm-provider.js';
import { ProviderRegistry } from './provider-registry.js';

const haiku = VALIDATED_LLM_CONFIGS[0];
const gemma = VALIDATED_LLM_CONFIGS[2];

describe('provider registry (ADR-037)', () => {
  test('resolves a registered provider and caches one instance per model', () => {
    let built = 0;
    const registry = new ProviderRegistry().register('bedrock-runtime', () => {
      built += 1;
      return fakeProvider({ kind: 'text', chunks: [] }).provider;
    });
    const first = registry.resolve(haiku);
    expect(first).not.toBeNull();
    expect(registry.resolve(haiku)).toBe(first);
    expect(built).toBe(1);
    registry.resolve(VALIDATED_LLM_CONFIGS[1]);
    expect(built).toBe(2);
  });

  test('passes the validated model id to the factory', () => {
    const seen: string[] = [];
    new ProviderRegistry()
      .register('bedrock-runtime', (model) => {
        seen.push(model);
        return fakeProvider({ kind: 'text', chunks: [] }).provider;
      })
      .resolve(haiku);
    expect(seen).toEqual([haiku.model]);
  });

  test('a validated pair without an adapter resolves to null (mantle until P6-03)', () => {
    const registry = new ProviderRegistry().register(
      'bedrock-runtime',
      () => fakeProvider({ kind: 'text', chunks: [] }).provider,
    );
    expect(registry.resolve(gemma)).toBeNull();
  });

  test('refuses to register a provider twice', () => {
    const registry = new ProviderRegistry().register(
      'bedrock-runtime',
      () => fakeProvider({ kind: 'text', chunks: [] }).provider,
    );
    expect(() =>
      registry.register(
        'bedrock-runtime',
        () => fakeProvider({ kind: 'text', chunks: [] }).provider,
      ),
    ).toThrow();
  });
});
