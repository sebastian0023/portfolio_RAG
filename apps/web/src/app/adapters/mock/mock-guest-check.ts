import type {
  GuestCheckPort,
  GuestCheckResult,
} from '../../core/ports/guest-check-port';
import { delay, type MockConfig } from './mock-config';

export class MockGuestCheck implements GuestCheckPort {
  readonly required = true;

  constructor(private readonly config: MockConfig) {}

  async verify(signal?: AbortSignal): Promise<GuestCheckResult> {
    await delay(this.config.checkMs, signal);
    return this.config.checks.shift() ?? 'passed';
  }
}
