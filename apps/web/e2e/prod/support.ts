import { type Page } from '@playwright/test';

// Cloudflare's script and the guest-pass endpoint, stubbed in the browser so the production bundle runs its real
// guest check without the network (ADR-052). The stub script is served from Cloudflare's own origin, so the
// page's Content-Security-Policy is still what decides whether it may load.
export const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js*';

const STUB_TURNSTILE = `
  window.turnstile = {
    options: null,
    render(container, options) { this.options = options; window.__turnstileRenders = (window.__turnstileRenders || 0) + 1; return 'widget'; },
    execute() { window.__turnstileExecutes = (window.__turnstileExecutes || 0) + 1; setTimeout(() => this.options.callback('XXXX.DUMMY.TOKEN.XXXX'), 0); },
    reset() {},
    remove() {},
  };
`;

export const PASS = 'v1.eyJrIjoiZSIsImV4cCI6MX0.c2ln';

export interface GuestPassStub {
  requests: () => { body: string; hash: string | undefined }[];
}

export async function stubGuestCheck(
  page: Page,
  respond: () => { status: number; body: unknown } = () => ({
    status: 200,
    body: { pass: PASS, expiresAt: Math.floor(Date.now() / 1000) + 3600 },
  }),
): Promise<GuestPassStub> {
  const seen: { body: string; hash: string | undefined }[] = [];
  await page.route(TURNSTILE_SCRIPT, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: STUB_TURNSTILE,
    }),
  );
  await page.route('**/api/guest-pass', (route) => {
    const request = route.request();
    seen.push({
      body: request.postData() ?? '',
      hash: request.headers()['x-amz-content-sha256'],
    });
    const { status, body } = respond();
    return route.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(body),
    });
  });
  return { requests: () => seen };
}
