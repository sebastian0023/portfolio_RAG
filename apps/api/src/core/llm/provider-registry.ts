import type { LLMProvider } from '@portfolio/shared';
import type { LlmConfig } from '../config/runtime-config.js';

export type ProviderKind = LlmConfig['provider'];
export type ProviderFactory = (model: string) => LLMProvider;

// Strategy + Adapter + Registry (ADR-037). Config has already been validated against VALIDATED_LLM_CONFIGS,
// so a name that reaches here is a known pair. A pair with no registered adapter (the mantle adapter does
// not exist until P6-03) resolves to null, and the caller refuses the request before spending anything.
export class ProviderRegistry {
  private readonly factories = new Map<ProviderKind, ProviderFactory>();
  private readonly instances = new Map<string, LLMProvider>();

  register(kind: ProviderKind, factory: ProviderFactory): this {
    if (this.factories.has(kind)) {
      throw new Error(`provider "${kind}" is already registered`);
    }
    this.factories.set(kind, factory);
    return this;
  }

  resolve(llm: LlmConfig): LLMProvider | null {
    const key = `${llm.provider}:${llm.model}`;
    const cached = this.instances.get(key);
    if (cached) return cached;
    const factory = this.factories.get(llm.provider);
    if (!factory) return null;
    const provider = factory(llm.model);
    this.instances.set(key, provider);
    return provider;
  }
}
