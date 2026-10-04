import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a visitor can ask a mocked question, inspect a source, and use the keyboard', async ({
  page,
}) => {
  await page.goto('/?scenario=empty');
  await expect(
    page.getByRole('heading', { name: 'Ask about [Name]' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'What is [Name] studying?' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Checking that you are a person' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open source 1' })).toBeVisible(
    { timeout: 20_000 },
  );
  await expect(page.getByText('9 of 10 questions left today')).toBeVisible();
  await page.getByRole('button', { name: 'Open source 1' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('mark').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.locator('.assistant-message[data-status="done"]'),
  ).toBeVisible();
  await page
    .getByLabel('Your question')
    .fill('Tell me about a project [Name] built');
  await page.getByLabel('Your question').press('Enter');
  await expect(page.getByText('8 of 10 questions left today')).toBeVisible();
});

test('responsive shell, limit state, and accessibility', async ({
  page,
}, testInfo) => {
  await page.goto('/?scenario=outGuest');
  await expect(
    page.getByRole('heading', { name: 'No questions left today' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  const card = page.locator('[data-component="PresentationCard"]');
  await expect(card).toBeVisible();
  const chat = page.locator('[data-component="ChatPanel"]');
  await expect(chat).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    await expect(
      page.getByRole('button', { name: /More about/ }),
    ).toBeVisible();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 412);
  }
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('a streaming answer can be stopped and an error is explained', async ({
  page,
}) => {
  await page.goto('/?scenario=empty&mock=hang');
  await page.getByRole('button', { name: 'What is [Name] studying?' }).click();
  await expect(
    page.locator('.assistant-message[data-status="thinking"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(
    page.locator('.assistant-message[data-status="stopped"]'),
  ).toBeVisible();

  await page.goto('/?scenario=empty&mock=error:unavailable');
  await page.getByRole('button', { name: 'What is [Name] studying?' }).click();
  await expect(
    page
      .getByText('The assistant is unavailable right now.', { exact: false })
      .last(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
});
