import {
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  type ApplicationConfig,
} from '@angular/core';
import { createProviders } from './wiring/providers';

// The single composition root (ADR-043). Which ports are wired depends on the build: production wires the
// HTTP transport, development wires the mock backend (see wiring/providers).
export function createAppConfig(search: string): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideZonelessChangeDetection(),
      ...createProviders(search),
    ],
  };
}

export const appConfig: ApplicationConfig = createAppConfig(
  typeof location === 'undefined' ? '' : location.search,
);
