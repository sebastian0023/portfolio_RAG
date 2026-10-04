import js from '@eslint/js';
import angular from 'angular-eslint';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const WEB_TYPES = ['web', 'web-ui', 'web-features', 'web-adapters', 'web-core'];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.angular/**',
    ],
  },
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
        // Web layers (ADR-002, ADR-043). Listed before the 'web' catch-all so the first match wins.
        { type: 'web-ui', pattern: 'apps/web/src/app/ui/**' },
        { type: 'web-features', pattern: 'apps/web/src/app/features/**' },
        { type: 'web-adapters', pattern: 'apps/web/src/app/adapters/**' },
        { type: 'web-core', pattern: 'apps/web/src/app/core/**' },
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
                    types: {
                      anyOf: [...WEB_TYPES, 'api', 'api-core', 'api-adapter'],
                    },
                  },
                },
              },
            },
            {
              from: { element: { types: { anyOf: WEB_TYPES } } },
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
              disallow: { to: { element: { types: { anyOf: WEB_TYPES } } } },
            },
            // Only the composition root (app.config.ts, in the catch-all 'web') imports adapters.
            {
              from: {
                element: {
                  types: { anyOf: ['web-ui', 'web-features', 'web-core'] },
                },
              },
              disallow: { to: { element: { type: 'web-adapters' } } },
            },
            {
              from: { element: { type: 'web-ui' } },
              disallow: { to: { element: { type: 'web-features' } } },
            },
            {
              from: {
                element: { types: { anyOf: ['web-core', 'web-adapters'] } },
              },
              disallow: {
                to: {
                  element: { types: { anyOf: ['web-ui', 'web-features'] } },
                },
              },
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-036: business logic and shared contracts never touch cloud or provider SDKs, and the web
    // framework stays at the edge of the API. Test support never ships (it is excluded from the build).
    files: ['apps/api/src/core/**/*.ts', 'packages/shared/**/*.ts'],
    ignores: ['**/*.test.ts'],
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
            {
              group: ['hono', 'hono/*'],
              message:
                'Hono is a transport detail; it belongs in apps/api/src/adapters only.',
            },
            {
              group: ['**/testing/**'],
              message: 'Test support must not be imported by production code.',
            },
          ],
        },
      ],
    },
  },
  {
    // Core tests may use test support, but still never an SDK or the web framework.
    files: ['apps/api/src/core/**/*.test.ts', 'packages/shared/**/*.test.ts'],
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
                'hono',
                'hono/*',
              ],
              message:
                'Core tests exercise ports with fakes; SDKs and Hono belong to adapters.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: [
      'apps/api/src/core/**',
      'apps/api/src/testing/**',
      '**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/testing/**'],
              message: 'Test support must not be imported by production code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-standalone': 'error',
      // R-17: model output is untrusted text. Render it through typed segments, never as HTML.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
          message: 'Never assign HTML; render typed segments in templates.',
        },
        {
          selector:
            'CallExpression[callee.property.name=/^bypassSecurityTrust/]',
          message: 'Never bypass Angular sanitization.',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
    },
  },
  {
    // Presentational components take inputs and emit outputs; they never reach for the facade or ports.
    files: ['apps/web/src/app/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/chat-facade*', '**/core/ports/**'],
              message:
                'ui/ components are presentational: pass data in through inputs and out through outputs.',
            },
          ],
        },
      ],
    },
  },
);
