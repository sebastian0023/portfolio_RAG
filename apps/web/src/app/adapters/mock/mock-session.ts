import type { SessionInfo, SessionPort } from '../../core/ports/session-port';
import type {
  GuestCheckPort,
  GuestCheckResult,
} from '../../core/ports/guest-check-port';
import { delay, type MockConfig } from './mock-config';

export class MockSession implements SessionPort {
  readonly signInAvailable = true;
  private info: SessionInfo;

  constructor(
    private readonly config: MockConfig,
    initial: SessionInfo = { status: 'guest' },
  ) {
    this.info = initial;
  }

  read(): SessionInfo {
    return this.info;
  }

  async beginSignIn(): Promise<SessionInfo> {
    await delay(this.config.signInMs);
    this.info = {
      status: 'signed-in',
      displayName: '[name]',
      quota: { left: this.config.userLeft, limit: this.config.userLimit },
    };
    return this.info;
  }

  signOut(): void {
    this.info = { status: 'guest' };
  }
}

export class MockGuestCheck implements GuestCheckPort {
  readonly required = true;

  constructor(private readonly config: MockConfig) {}

  async verify(signal?: AbortSignal): Promise<GuestCheckResult> {
    await delay(this.config.checkMs, signal);
    return this.config.checks.shift() ?? 'passed';
  }
}
