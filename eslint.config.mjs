import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          project: [
            'apps/api/tsconfig.json',
            'apps/web/tsconfig.json',
            'packages/shared/tsconfig.json',
          ],
        },
      },
      'boundaries/elements': [
        { type: 'api-core', pattern: 'apps/api/src/core/**' },
        { type: 'api-adapter', pattern: 'apps/api/src/adapters/**' },
        { type: 'api', pattern: 'apps/api/**' },
        { type: 'web', pattern: 'apps/web/**' },
        { type: 'shared', pattern: 'packages/shared/**' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'api-core' } },
              disallow: { to: { element: { type: 'api-adapter' } } },
            },
            {
              from: { element: { type: 'shared' } },
              disallow: {
                to: {
                  element: {
                    types: { anyOf: ['web', 'api', 'api-core', 'api-adapter'] },
                  },
                },
              },
            },
            {
              from: { element: { type: 'web' } },
              disallow: {
                to: {
                  element: {
                    types: { anyOf: ['api', 'api-core', 'api-adapter'] },
                  },
                },
              },
            },
            {
              from: {
                element: {
                  types: { anyOf: ['api', 'api-core', 'api-adapter'] },
                },
              },
              disallow: { to: { element: { type: 'web' } } },
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-036: business logic and shared contracts never touch cloud or provider SDKs.
    files: ['apps/api/src/core/**/*.ts', 'packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@aws-sdk/*',
                '@smithy/*',
                'aws-jwt-verify',
                '@anthropic-ai/*',
                'openai',
              ],
              message:
                'SDKs belong in apps/api/src/adapters; core and shared depend on ports only.',
            },
          ],
        },
      ],
    },
  },
);
