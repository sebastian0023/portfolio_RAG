import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { stubGuestCheck } from './support';

// Citations in the production bundle under the real CSP, with the stream stubbed (P5-06, R-17, ADR-048,
// ADR-054). The model can only write `[n]`; the server builds every source card. These tests prove the browser
// is the last line of defence: hostile text stays text, a marker with no source disappears, and a source link
// is only ever an https URL.

const SSE = { 'content-type': 'text/event-stream; charset=utf-8' };
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const accepted = { type: 'accepted', quota: { left: 9, limit: 10 } };

const HOSTILE_TITLE = 'Databases <img src=x onerror="window.__xss=1">';
const HOSTILE_EXCERPT =
  'Alex studied databases. <script>window.__xss=1</script> Then <img src=x onerror="window.__xss=1"> distributed systems.';

const source = (n: number, extra: Record<string, unknown> = {}) => ({
  n,
  chunkId: `edu-overview#section-${n}`,
  sourceId: 'edu-overview',
  title: HOSTILE_TITLE,
  section: 'Courses',
  path: 'knowledge/education.md',
  updated: '2026-01-15',
  excerpt: HOSTILE_EXCERPT,
  // "Alex studied databases." is the first 23 characters.
  highlights: [{ start: 0, end: 23 }],
  ...extra,
});

async function watch(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const logged: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|refused to/i.test(message.text())) {
      logged.push(message.text());
    }
  });
  return async () => [
    ...logged,
    ...(await page.evaluate(
      () => (window as unknown as { __csp?: string[] }).__csp ?? [],
    )),
  ];
}

async function ask(page: Page, question = 'What did Alex study?') {
  const box = page.getByLabel('Your question');
  await box.fill(question);
  await box.press('Enter');
}

function answer(page: Page, events: unknown[]) {
  return page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      headers: SSE,
      body: events.map(frame).join(''),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await stubGuestCheck(page);
});

test('hostile text in a source stays text, and a marker with no source disappears', async ({
  page,
}) => {
  const violations = await watch(page);
  await answer(page, [
    accepted,
    {
      type: 'sources',
      sources: [
        source(1, { sourceUrl: 'https://example.org/education' }),
        source(2, { chunkId: 'edu-overview#section-2' }),
      ],
    },
    { type: 'delta', text: 'Alex studied databases [1] and systems [2]' },
    { type: 'delta', text: ', and invented a third thing [9].' },
    { type: 'done', coverage: 'answered', cited: [1, 2, 9] },
  ]);
  await page.goto('/');
  await ask(page);

  const message = page.locator('.assistant-message[data-status="done"]');
  await expect(message).toContainText('Alex studied databases');
  // Two real citations, and the fabricated [9] is gone rather than shown as literal text.
  await expect(message.locator('button.citation')).toHaveCount(2);
  await expect(message).not.toContainText('[9]');
  await expect(message.locator('button.citation')).toHaveText(['[1]', '[2]']);

  // Open the first source: the hostile title and excerpt render as text.
  await message.getByRole('button', { name: 'Open source 1' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText(HOSTILE_TITLE);
  await expect(dialog).toContainText('<script>window.__xss=1</script>');
  await expect(dialog.locator('mark')).toHaveCount(1);
  await expect(dialog.locator('mark')).toHaveText('Alex studied databases.');

  // Nothing became markup, nothing ran, and the CSP saw nothing to block.
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('script:not([src])')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
  expect(await violations()).toEqual([]);

  // The link is https, opens in a new tab, and cannot reach back to the opener.
  const link = dialog.getByRole('link', { name: /Open public source/ });
  await expect(link).toHaveAttribute('href', 'https://example.org/education');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  // A source without a URL has no link at all.
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('link')).toHaveCount(0);
});

test('a marker with no sources event at all is shown as plain text, never as a citation', async ({
  page,
}) => {
  await answer(page, [
    accepted,
    { type: 'delta', text: 'Unsupported claim [1].' },
    { type: 'done', coverage: 'none', cited: [] },
  ]);
  await page.goto('/');
  await ask(page);
  const message = page.locator('.assistant-message[data-status="done"]');
  await expect(message).toContainText('Unsupported claim [1].');
  await expect(message.locator('button.citation')).toHaveCount(0);
});

for (const [label, url] of [
  ['a javascript: URL', 'javascript:alert(document.domain)'],
  ['a plain http URL', 'http://example.org/education'],
  ['a data: URL', 'data:text/html,<script>1</script>'],
] as const) {
  test(`${label} in a source is rejected by the browser and never becomes a link`, async ({
    page,
  }) => {
    await answer(page, [
      accepted,
      { type: 'sources', sources: [source(1, { sourceUrl: url })] },
      { type: 'delta', text: 'An answer [1].' },
      { type: 'done', coverage: 'answered', cited: [1] },
    ]);
    await page.goto('/');
    await ask(page);
    // The malformed event fails validation, so the answer ends as an interruption, not a card with a link.
    await expect(
      page.getByText(/answer was interrupted/i).first(),
    ).toBeVisible();
    await expect(
      page.locator('a[href^="javascript"], a[href^="data:"]'),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /Open public source/ }),
    ).toHaveCount(0);
  });
}

test('the source viewer fits the screen, is operable, and hands focus back (desktop and mobile)', async ({
  page,
}) => {
  await answer(page, [
    accepted,
    {
      type: 'sources',
      sources: [source(1, { sourceUrl: 'https://example.org/a' }), source(2)],
    },
    { type: 'delta', text: 'First [1] and second [2].' },
    { type: 'done', coverage: 'answered', cited: [1, 2] },
  ]);
  await page.goto('/');
  await ask(page);
  const chip = page.getByRole('button', { name: 'Open source 1' });
  await chip.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  // No sideways scrolling on the page while the viewer is open.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  // Every control is reachable and big enough to tap.
  for (const name of ['Close source', 'Next']) {
    const button = dialog.getByRole('button', { name });
    await expect(button).toBeVisible();
    const size = await button.boundingBox();
    expect(size && size.height).toBeGreaterThanOrEqual(32);
  }
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('SOURCE 2 OF 2')).toBeVisible();
  await dialog.getByRole('button', { name: 'Previous' }).click();
  await expect(dialog.getByText('SOURCE 1 OF 2')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(chip).toBeFocused();
});
