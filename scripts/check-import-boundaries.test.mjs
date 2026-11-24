/**
 * @fileoverview Proves the import boundaries of the layout table are enforced by the lint
 * configuration: a file in each directory that imports what its directory may not is reported,
 * and a file that imports only what it may is not.
 * @layer scripts
 */
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: rootDir })

/**
 * The import-restriction reports on `code` linted in the place of the existing file `path`: the
 * type-aware configuration only applies to files the TypeScript project holds.
 */
async function reported(path, code) {
  const [result] = await eslint.lintText(code, { filePath: join(rootDir, path) })
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports')
}

const FORBIDDEN = [
  [
    'src/core/index.ts',
    "import { a } from '@bymax-one/nest-subscription/revenuecat'\nexport { a }\n"
  ],
  ['src/core/index.ts', "import { a } from '@bymax-one/nest-subscription/finance'\nexport { a }\n"],
  ['src/core/index.ts', "import { a } from '../revenuecat/index'\nexport { a }\n"],
  ['src/core/index.ts', "import { a } from '../finance'\nexport { a }\n"],
  ['src/core/index.ts', "import { a } from '@bymax-one/nest-subscription/testing'\nexport { a }\n"],
  ['src/core/index.ts', "import { a } from '../internal'\nexport { a }\n"],
  [
    'src/core/index.spec.ts',
    "import { a } from '@bymax-one/nest-subscription/finance'\nexport { a }\n"
  ],
  [
    'src/internal/index.ts',
    "import { a } from '@bymax-one/nest-subscription/revenuecat'\nexport { a }\n"
  ],
  ['src/internal/index.ts', "import { a } from '../core'\nexport { a }\n"],
  [
    'src/revenuecat/index.ts',
    "import { a } from '@bymax-one/nest-subscription/finance'\nexport { a }\n"
  ],
  ['src/revenuecat/index.ts', "import { a } from '@bymax-one/nest-subscription'\nexport { a }\n"],
  [
    'src/finance/index.ts',
    "import { a } from '@bymax-one/nest-subscription/revenuecat'\nexport { a }\n"
  ],
  ['src/finance/index.ts', "import { a } from '../core'\nexport { a }\n"],
  ['src/testing/index.ts', "import { a } from '../core'\nexport { a }\n"],
  [
    'src/shared/index.ts',
    "import { a } from '@bymax-one/nest-subscription/internal'\nexport { a }\n"
  ],
  ['src/shared/index.ts', "import { a } from 'node:fs'\nexport { a }\n"]
]

const ALLOWED = [
  [
    'src/core/index.ts',
    "import { a } from '@bymax-one/nest-subscription/internal'\nexport { a }\n"
  ],
  ['src/core/index.ts', "import { a } from '@bymax-one/nest-subscription/shared'\nexport { a }\n"],
  [
    'src/core/index.spec.ts',
    "import { a } from '@bymax-one/nest-subscription/testing'\nexport { a }\n"
  ],
  [
    'src/revenuecat/index.ts',
    "import { a } from '@bymax-one/nest-subscription/internal'\nexport { a }\n"
  ],
  [
    'src/finance/index.ts',
    "import { a } from '@bymax-one/nest-subscription/shared'\nexport { a }\n"
  ],
  [
    'src/testing/index.ts',
    "import { a } from '@bymax-one/nest-subscription/revenuecat'\nexport { a }\n"
  ],
  ['src/shared/index.ts', "import { a } from './values'\nexport { a }\n"]
]

for (const [path, code] of FORBIDDEN) {
  test(`${path} is refused: ${code.split('\n')[0]}`, async () => {
    assert.ok((await reported(path, code)).length > 0, 'the import was not reported')
  })
}

for (const [path, code] of ALLOWED) {
  test(`${path} is accepted: ${code.split('\n')[0]}`, async () => {
    assert.deepEqual(await reported(path, code), [])
  })
}
