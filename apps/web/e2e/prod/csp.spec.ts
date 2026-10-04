import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { stubGuestCheck } from './support';

// The production bundle under the exact headers CloudFront will send. A violation here would be a blank or
// broken page in production, so any CSP report fails the test.

const SSE = { 'content-type': 'text/event-stream; charset=utf-8' };
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

test('the app runs under the real CSP with no violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|refused to/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  await stubGuestCheck(page);
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      headers: SSE,
      body:
        frame({
          type: 'accepted',
          quota: { left: 29, limit: 30 },
        }) +
        frame({ type: 'delta', text: 'An answer.' }) +
        frame({ type: 'done', coverage: 'none', cited: [] }),
    }),
  );

  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
  expect(csp).toContain('frame-src https://challenges.cloudflare.com');
  await page.getByLabel('Your question').fill('Does the page work?');
  await page.getByLabel('Your question').press('Enter');
  await expect(
    page.locator('.assistant-message[data-status="done"]'),
  ).toContainText('An answer.');

  const reported = await page.evaluate(
    () => (window as unknown as { __csp?: string[] }).__csp ?? [],
  );
  expect(reported).toEqual([]);
  expect(violations).toEqual([]);
});

test('index.html loads one script by URL and has no inline script', async ({
  page,
}) => {
  const response = await page.goto('/');
  const html = (await response?.text()) ?? '';
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toMatch(/\bsrc="/);
  // Nothing but whitespace may sit between an opening and a closing script tag.
  expect(html).not.toMatch(/<script\b[^>]*>\s*[^<\s]/);
  expect(html).not.toMatch(/\son(load|click|error)=/i);
});

test('the response carries every security header from the shared policy', async ({
  page,
}) => {
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};
  expect(headers['strict-transport-security']).toMatch(/max-age=31536000/);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
});

test('there is no SPA fallback: unknown paths and API paths are 404, not index.html', async ({
  page,
}) => {
  for (const path of ['/nope', '/api/nope']) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('<app-root');
  }
});

test('accessibility still passes in the production bundle', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Ask about [Name]' }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
