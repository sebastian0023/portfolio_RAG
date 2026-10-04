import {
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  type ApplicationConfig,
} from '@angular/core';
import { environment } from '../environments/environment';
import { readHarness } from './adapters/mock/harness';
import { createMockConfig } from './adapters/mock/mock-config';
import { MockChatTransport } from './adapters/mock/mock-chat-transport';
import { MockGuestCheck, MockSession } from './adapters/mock/mock-session';
import { buildScenario } from './adapters/mock/scenarios';
import { CHAT_SEED } from './core/chat/chat-seed';
import {
  CHAT_TRANSPORT,
  GUEST_CHECK_PORT,
  SESSION_PORT,
} from './core/ports/tokens';
import { ThemeService } from './core/theme/theme.service';

// The single composition root (ADR-043) and the only place that imports adapters. Phase 2 wires
// the mock backend; Phases 3 and 4 replace these providers with HTTP, Cognito, and Turnstile.
export function createAppConfig(search: string): ApplicationConfig {
  const harness = environment.scenarioHarness ? readHarness(search) : null;
  const scenario = harness?.scenario ? buildScenario(harness.scenario) : null;
  const config = createMockConfig({
    ...(scenario?.config ?? {}),
    ...(harness?.outcomes.length ? { outcomes: [...harness.outcomes] } : {}),
  });
  const session = new MockSession(config, scenario?.session);
  const theme = harness?.theme ?? null;

  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideZonelessChangeDetection(),
      { provide: SESSION_PORT, useValue: session },
      {
        provide: CHAT_TRANSPORT,
        useValue: new MockChatTransport(config, session),
      },
      { provide: GUEST_CHECK_PORT, useValue: new MockGuestCheck(config) },
      ...(scenario ? [{ provide: CHAT_SEED, useValue: scenario.seed }] : []),
      ...(theme
        ? [
            provideAppInitializer(() =>
              inject(ThemeService).set(theme, { persist: false }),
            ),
          ]
        : []),
    ],
  };
}

export const appConfig: ApplicationConfig = createAppConfig(
  typeof location === 'undefined' ? '' : location.search,
);
