import type {
  GuestCheckPort,
  GuestCheckResult,
} from '../../core/ports/guest-check-port';
import { delay, type MockConfig } from './mock-config';

export class MockGuestCheck implements GuestCheckPort {
  constructor(private readonly config: MockConfig) {}

  // The mock pass never runs out: the facade's own `verified` flag decides when the check shows.
  isReady(): boolean {
    return true;
  }

  async verify(signal?: AbortSignal): Promise<GuestCheckResult> {
    await delay(this.config.checkMs, signal);
    return this.config.checks.shift() ?? 'passed';
  }

  invalidate(): void {
    // Nothing to forget.
  }
}
