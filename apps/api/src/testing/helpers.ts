// Test support only: never imported by production code (lint-enforced, excluded from the build).
import { readFileSync } from 'node:fs';
import {
  CachedConfig,
  type ConfigSource,
} from '../core/config/cached-config.js';
import type { LogEvent, Logger } from '../core/ports/logger.js';
import type {
  AdmissionContext,
  AdmissionStage,
} from '../core/chat/admission.js';
import { scriptedProvider } from './fake-llm-provider.js';

interface Manifest {
  parameters: Record<string, { default: unknown }>;
}

const manifest = JSON.parse(
  readFileSync(
    new URL('../../../../infra/modules/ssm/parameters.json', import.meta.url),
    'utf8',
  ),
) as Manifest;

const defaults = (name: string): unknown => manifest.parameters[name]?.default;

// Raw SSM string values as the config source would return them, with chat switched on.
export function rawConfig(
  overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
  return {
    chat_enabled: 'true',
    active_index: 'none',
    llm_config: JSON.stringify(defaults('llm_config')),
    limits: JSON.stringify(defaults('limits')),
    ...overrides,
  } as Record<string, string>;
}

export function configFrom(
  raw: Record<string, string> | (() => Promise<never>),
): CachedConfig {
  const source: ConfigSource = {
    load: typeof raw === 'function' ? raw : () => Promise.resolve(raw),
  };
  return new CachedConfig(source);
}

export function memoryLogger(): Logger & { readonly events: LogEvent[] } {
  const events: LogEvent[] = [];
  return {
    events,
    log: (event) => {
      events.push(event);
    },
  };
}

export function bodyStream(
  text: string | Uint8Array,
): ReadableStream<Uint8Array> {
  const bytes =
    typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function context(
  overrides: Partial<AdmissionContext> & { json?: unknown } = {},
): AdmissionContext {
  const { json, ...rest } = overrides;
  return {
    contentType: 'application/json',
    headers: new Headers(),
    body: bodyStream(JSON.stringify(json ?? { question: 'hi', history: [] })),
    signal: new AbortController().signal,
    ...rest,
  };
}

// Stands in for the provider and daily-cap stages that later PRs add, so handler-level tests can reach the
// service.
export const wiringStage: AdmissionStage = (ctx) => {
  ctx.provider = scriptedProvider([]);
  ctx.quota = { left: 29, limit: 30 };
  return Promise.resolve(undefined);
};
