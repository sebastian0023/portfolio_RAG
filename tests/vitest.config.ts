import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'architecture', include: ['architecture/**/*.test.ts'] },
});
