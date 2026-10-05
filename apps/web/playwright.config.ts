import { defineConfig, devices } from '@playwright/test';

const mockUrl = 'http://127.0.0.1:4200';
const prodUrl = 'http://127.0.0.1:4300';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    // The mocked development build: scenario harness, no network.
    {
      name: 'desktop',
      testIgnore: '**/prod/**',
      use: { ...devices['Desktop Chrome'], baseURL: mockUrl },
    },
    {
      name: 'mobile',
      testIgnore: '**/prod/**',
      use: { ...devices['Pixel 7'], baseURL: mockUrl },
    },
    // The production bundle under the real security headers; /api/chat is stubbed with page.route.
    {
      name: 'prod',
      testMatch: '**/prod/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: prodUrl },
    },
    // The citations spec again on a phone: the source viewer must be usable at mobile width (P5-06).
    {
      name: 'prod-mobile',
      testMatch: '**/prod/citations.spec.ts',
      use: { ...devices['Pixel 7'], baseURL: prodUrl },
    },
  ],
  webServer: [
    {
      command:
        'npm run start -w @portfolio/web -- --host 127.0.0.1 --port 4200',
      url: mockUrl,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      // A fresh production build every run, so the test never sees a stale or development bundle.
      command: 'npm run build && node e2e/support/serve-dist.ts 4300',
      cwd: '.',
      url: prodUrl,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
