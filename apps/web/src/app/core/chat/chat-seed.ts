import { InjectionToken } from '@angular/core';
import type { ChatSeed } from './chat-state';

// Provided only by the scenario harness (dev and e2e builds); production leaves it unset.
export const CHAT_SEED = new InjectionToken<ChatSeed>('CHAT_SEED');
