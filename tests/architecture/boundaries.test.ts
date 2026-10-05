import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Files copied into the sandbox so the real import resolver can follow relative imports.
const tsconfigs = [
  'tsconfig.base.json',
  'apps/api/tsconfig.json',
  'apps/web/tsconfig.json',
  'packages/shared/tsconfig.json',
];

const BOUNDARY = 'boundaries/dependencies';
const SDK = 'no-restricted-imports';

const targets: Record<string, string> = {
  'apps/api/src/core/ok-core.ts': 'export const core = 1;\n',
  'apps/api/src/adapters/adapter.ts': 'export const adapter = 1;\n',
  'apps/api/src/cli/tool.ts': 'export const tool = 1;\n',
  'apps/api/src/testing/helper.ts': 'export const helper = 1;\n',
  'apps/web/src/web.ts': 'export const web = 1;\n',
  'apps/web/src/app/adapters/mock.ts': 'export const mock = 1;\n',
  'apps/web/src/app/core/ok-core.ts': 'export const webCore = 1;\n',
  'apps/web/src/app/core/chat-facade.ts': 'export const facade = 1;\n',
  'apps/web/src/app/ui/ok-ui.ts': 'export const webUi = 1;\n',
  'packages/shared/src/shared.ts': 'export const shared = 1;\n',
};

// path -> [source, rule that must fire, or null when the import is allowed]
const cases: Record<string, [string, string | null]> = {
  'apps/api/src/core/bad-core-to-adapter.ts': [
    "import { adapter } from '../adapters/adapter.js';\nexport const x = adapter;\n",
    BOUNDARY,
  ],
  'packages/shared/src/bad-shared-to-web.ts': [
    "import { web } from '../../../apps/web/src/web.js';\nexport const x = web;\n",
    BOUNDARY,
  ],
  'packages/shared/src/bad-shared-to-core.ts': [
    "import { core } from '../../../apps/api/src/core/ok-core.js';\nexport const x = core;\n",
    BOUNDARY,
  ],
  'apps/web/src/bad-web-to-api.ts': [
    "import { adapter } from '../../api/src/adapters/adapter.js';\nexport const x = adapter;\n",
    BOUNDARY,
  ],
  'apps/api/src/bad-api-to-web.ts': [
    "import { web } from '../../web/src/web.js';\nexport const x = web;\n",
    BOUNDARY,
  ],
  'apps/api/src/core/bad-core-sdk.ts': [
    "import { SSMClient } from '@aws-sdk/client-ssm';\nexport const x = SSMClient;\n",
    SDK,
  ],
  'packages/shared/src/bad-shared-sdk.ts': [
    "import { JwtVerifier } from 'aws-jwt-verify';\nexport const x = JwtVerifier;\n",
    SDK,
  ],
  'apps/api/src/core/ok-core-to-shared.ts': [
    "import { shared } from '../../../../packages/shared/src/shared.js';\nexport const x = shared;\n",
    null,
  ],
  'apps/web/src/app/ui/bad-ui-to-adapter.ts': [
    "import { mock } from '../adapters/mock.js';\nexport const x = mock;\n",
    BOUNDARY,
  ],
  'apps/web/src/app/core/bad-core-to-adapter.ts': [
    "import { mock } from '../adapters/mock.js';\nexport const x = mock;\n",
    BOUNDARY,
  ],
  'apps/web/src/app/core/bad-core-to-ui.ts': [
    "import { webUi } from '../ui/ok-ui.js';\nexport const x = webUi;\n",
    BOUNDARY,
  ],
  'apps/web/src/app/adapters/bad-adapter-to-ui.ts': [
    "import { webUi } from '../ui/ok-ui.js';\nexport const x = webUi;\n",
    BOUNDARY,
  ],
  'apps/web/src/app/ui/bad-ui-facade.ts': [
    "import { facade } from '../core/chat-facade.js';\nexport const x = facade;\n",
    'no-restricted-imports',
  ],
  'apps/web/src/app/core/bad-inner-html.ts': [
    'export function render(el: HTMLElement, html: string): void {\n  el.innerHTML = html;\n}\n',
    'no-restricted-syntax',
  ],
  'apps/web/src/app/app.config.ts': [
    "import { mock } from './adapters/mock.js';\nexport const x = mock;\n",
    null,
  ],
  'apps/web/src/app/adapters/ok-adapter-to-core.ts': [
    "import { webCore } from '../core/ok-core.js';\nexport const x = webCore;\n",
    null,
  ],
  'apps/web/src/app/ui/ok-ui-to-core-model.ts': [
    "import { webCore } from '../core/ok-core.js';\nexport const x = webCore;\n",
    null,
  ],
  'apps/web/src/ok-web-to-shared.ts': [
    "import { shared } from '../../../packages/shared/src/shared.js';\nexport const x = shared;\n",
    null,
  ],
  'apps/api/src/core/bad-core-to-hono.ts': [
    "import { Hono } from 'hono';\nexport const x = Hono;\n",
    SDK,
  ],
  'apps/api/src/core/bad-core-to-testing.ts': [
    "import { helper } from '../testing/helper.js';\nexport const x = helper;\n",
    SDK,
  ],
  'apps/api/src/adapters/bad-adapter-to-testing.ts': [
    "import { helper } from '../testing/helper.js';\nexport const x = helper;\n",
    SDK,
  ],
  'apps/api/src/core/ok-core-test-uses-testing.test.ts': [
    "import { helper } from '../testing/helper.js';\nexport const x = helper;\n",
    null,
  ],
  'apps/api/src/core/bad-core-test-to-hono.test.ts': [
    "import { Hono } from 'hono';\nexport const x = Hono;\n",
    SDK,
  ],
  // Operator CLIs are their own composition roots (ADR-043): nothing the Lambda ships may import one.
  'apps/api/src/core/bad-core-to-cli.ts': [
    "import { tool } from '../cli/tool.js';\nexport const x = tool;\n",
    BOUNDARY,
  ],
  'apps/api/src/adapters/bad-adapter-to-cli.ts': [
    "import { tool } from '../cli/tool.js';\nexport const x = tool;\n",
    BOUNDARY,
  ],
  'apps/api/src/bad-lambda-to-cli.ts': [
    "import { tool } from './cli/tool.js';\nexport const x = tool;\n",
    BOUNDARY,
  ],
  'packages/shared/src/bad-shared-to-cli.ts': [
    "import { tool } from '../../../apps/api/src/cli/tool.js';\nexport const x = tool;\n",
    BOUNDARY,
  ],
  'apps/api/src/cli/ok-cli.ts': [
    "import { SSMClient } from '@aws-sdk/client-ssm';\nimport { adapter } from '../adapters/adapter.js';\nimport { core } from '../core/ok-core.js';\nexport const x = [SSMClient, adapter, core];\n",
    null,
  ],
  'apps/api/src/cli/bad-cli-to-testing.ts': [
    "import { helper } from '../testing/helper.js';\nexport const x = helper;\n",
    SDK,
  ],
  'apps/api/src/lambda.ts': [
    "import { adapter } from './adapters/adapter.js';\nimport { core } from './core/ok-core.js';\nexport const x = [adapter, core];\n",
    null,
  ],
  'apps/api/src/adapters/ok-adapter.ts': [
    "import { SSMClient } from '@aws-sdk/client-ssm';\nimport { core } from '../core/ok-core.js';\nexport const x = [SSMClient, core];\n",
    null,
  ],
};

describe('architecture boundaries (ADR-036)', () => {
  let sandbox = '';
  const rulesByFile = new Map<string, string[]>();

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'arch-'));
    symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
    for (const file of tsconfigs) {
      mkdirSync(dirname(join(sandbox, file)), { recursive: true });
      cpSync(join(repoRoot, file), join(sandbox, file));
    }
    const sources = {
      ...targets,
      ...Object.fromEntries(
        Object.entries(cases).map(([path, [source]]) => [path, source]),
      ),
    };
    for (const [path, source] of Object.entries(sources)) {
      mkdirSync(dirname(join(sandbox, path)), { recursive: true });
      writeFileSync(join(sandbox, path), source);
    }

    const run = spawnSync(
      process.execPath,
      [
        join(repoRoot, 'node_modules/eslint/bin/eslint.js'),
        '--config',
        join(repoRoot, 'eslint.config.mjs'),
        '--format',
        'json',
        'apps',
        'packages',
      ],
      { cwd: sandbox, encoding: 'utf8' },
    );
    // Exit 1 means lint errors were found (expected); anything else is a harness failure.
    if (run.status !== 0 && run.status !== 1) {
      throw new Error(`eslint did not run: ${run.stderr}`);
    }
    const report = JSON.parse(run.stdout) as {
      filePath: string;
      messages: { ruleId: string | null }[];
    }[];
    for (const entry of report) {
      // The sandbox may be reported under its realpath (/private/var on macOS).
      const key = entry.filePath.replace(/^.*?\/(apps|packages)\//, '$1/');
      rulesByFile.set(
        key,
        entry.messages.map((m) => m.ruleId ?? 'parse-error'),
      );
    }
  }, 120_000);

  afterAll(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  test('every fixture file was linted', () => {
    for (const path of Object.keys(cases)) {
      expect(rulesByFile.has(path), `${path} missing from report`).toBe(true);
    }
  });

  for (const [path, [, expected]] of Object.entries(cases)) {
    if (expected) {
      test(`${path} fails with ${expected}`, () => {
        expect(rulesByFile.get(path)).toContain(expected);
      });
    } else {
      test(`${path} is allowed`, () => {
        expect(rulesByFile.get(path)).toEqual([]);
      });
    }
  }
});
