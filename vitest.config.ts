import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/web/vitest.config.ts',
      'apps/api/vitest.config.ts',
      'packages/shared/vitest.config.ts',
      'tests/vitest.config.ts',
    ],
  },
});
