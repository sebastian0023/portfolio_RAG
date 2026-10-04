import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// The production bundle with /api/chat stubbed by the browser. These tests prove the real transport: the body
// hash the edge requires, SSE parsing, and the mapping of refusals to the UI (ADR-049).

const SSE = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
};
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const accepted = {
  type: 'accepted',
  quota: { left: 29, limit: 30 },
};
const done = { type: 'done', coverage: 'none', cited: [] };

async function ask(page: Page, question: string): Promise<void> {
  const box = page.getByLabel('Your question');
  await box.fill(question);
  await box.press('Enter');
}

test('streams a real answer and sends the body hash the edge requires', async ({
  page,
}) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      headers: SSE,
      body:
        frame(accepted) +
        frame({ type: 'delta', text: 'Hello ' }) +
        frame({ type: 'delta', text: 'from the API.' }) +
        frame(done),
    }),
  );
  await page.goto('/');
  const [request] = await Promise.all([
    page.waitForRequest('**/api/chat'),
    ask(page, 'What is TypeScript?'),
  ]);

  const body = request.postDataBuffer();
  expect(body).not.toBeNull();
  expect(request.method()).toBe('POST');
  expect(request.headers()['content-type']).toBe('application/json');
  expect(request.headers()['x-amz-content-sha256']).toBe(
    createHash('sha256')
      .update(body ?? Buffer.alloc(0))
      .digest('hex'),
  );
  expect(request.postDataJSON()).toEqual({
    question: 'What is TypeScript?',
    history: [],
  });
  await expect(
    page.locator('.assistant-message[data-status="done"]'),
  ).toContainText('Hello from the API.');
  await expect(page.getByText('29 of 30 questions left today')).toBeVisible();
});

test('a follow-up question carries the earlier turns, still hashed over the exact bytes', async ({
  page,
}) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      headers: SSE,
      body:
        frame(accepted) +
        frame({ type: 'delta', text: 'First answer.' }) +
        frame(done),
    }),
  );
  await page.goto('/');
  await ask(page, 'First question');
  await expect(
    page.locator('.assistant-message[data-status="done"]'),
  ).toHaveCount(1);
  const [second] = await Promise.all([
    page.waitForRequest('**/api/chat'),
    ask(page, 'Second question'),
  ]);
  expect(second.postDataJSON()).toEqual({
    question: 'Second question',
    history: [
      { role: 'user', text: 'First question' },
      { role: 'assistant', text: 'First answer.' },
    ],
  });
  expect(second.headers()['x-amz-content-sha256']).toBe(
    createHash('sha256')
      .update(second.postDataBuffer() ?? Buffer.alloc(0))
      .digest('hex'),
  );
});

test('shows the countdown for a 429 rate_limited refusal', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 429,
      headers: { ...SSE, 'retry-after': '7' },
      body: frame({
        type: 'error',
        error: { code: 'rate_limited', retryAfterSeconds: 7 },
      }),
    }),
  );
  await page.goto('/');
  await ask(page, 'Too fast');
  await expect(
    page.getByText(/too quickly\. Try again in 7 s/).first(),
  ).toBeVisible();
});

test('shows the daily limit state for site_limit', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 429,
      headers: SSE,
      body: frame({ type: 'error', error: { code: 'site_limit' } }),
    }),
  );
  await page.goto('/');
  await ask(page, 'Any room left?');
  await expect(page.getByText('Daily limit reached')).toBeVisible();
});

test('shows unavailable for a 503 refusal', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 503,
      headers: SSE,
      body: frame({ type: 'error', error: { code: 'unavailable' } }),
    }),
  );
  await page.goto('/');
  await ask(page, 'Are you there?');
  await expect(
    page.getByText('The assistant is unavailable right now.').first(),
  ).toBeVisible();
});

test('shows the network alert when the edge answers with a non-SSE 502', async ({
  page,
}) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 502,
      headers: { 'content-type': 'text/html' },
      body: '<html>Bad gateway</html>',
    }),
  );
  await page.goto('/');
  await ask(page, 'Hello?');
  await expect(
    page.getByText("Couldn't send your question. Check your connection."),
  ).toBeVisible();
});

test('marks an answer interrupted when the stream breaks after it began', async ({
  page,
}) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      headers: SSE,
      body: frame(accepted) + frame({ type: 'delta', text: 'Partial' }),
    }),
  );
  await page.goto('/');
  await ask(page, 'Cut me off');
  await expect(
    page.getByText('The answer was interrupted. Try asking again.'),
  ).toBeVisible();
});

test('never reads the development query parameters', async ({ page }) => {
  await page.goto('/?scenario=outGuest&mock=hang');
  await expect(
    page.getByRole('heading', { name: 'Ask about [Name]' }),
  ).toBeVisible();
  await expect(page.getByText('Daily limit reached')).toHaveCount(0);
  await expect(page.getByText('No questions left today')).toHaveCount(0);
  await expect(page.getByLabel('Your question')).toBeEnabled();
});

test('offers no sign-in or account control anywhere', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Ask about [Name]' }),
  ).toBeVisible();
  await expect(
    page.getByText(/sign[- ]?(in|out)|log ?in|account/i),
  ).toHaveCount(0);
});
