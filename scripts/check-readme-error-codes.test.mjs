/**
 * @fileoverview Tests that the error code table of the README lists exactly the codes of the
 * catalogue `SUBSCRIPTION_ERROR_CODES`, each with the catalogue's own message, so a code added,
 * renamed or reworded in `src/shared/error-codes.ts` without the README fails the lint chain.
 * @layer scripts
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The codes of the catalogue, in order, from the source that defines them. */
function catalogueCodes(source) {
  const block = /SUBSCRIPTION_ERROR_CODES = Object\.freeze\(\{([\s\S]*?)\} as const\)/.exec(source)
  assert.ok(block, 'the catalogue is found in src/shared/error-codes.ts')
  return [...block[1].matchAll(/:\s*'(SUBSCRIPTION_[A-Z_]+)'/g)].map((match) => match[1])
}

/** The message of each code, from the source that defines them. */
function catalogueMessages(source) {
  const block = /SUBSCRIPTION_ERROR_MESSAGES[\s\S]*?Object\.freeze\(\{([\s\S]*?)\}\)/.exec(source)
  assert.ok(block, 'the messages are found in src/shared/error-codes.ts')
  return new Map(
    [...block[1].matchAll(/(SUBSCRIPTION_[A-Z_]+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]])
  )
}

/** The rows of the README's error code table: the code and the meaning column. */
function readmeRows(readme) {
  const section = /## Error Code Catalog([\s\S]*?)\n---/.exec(readme)
  assert.ok(section, 'the README has an Error Code Catalog section')
  return [...section[1].matchAll(/^\|\s*`(SUBSCRIPTION_[A-Z_]+)`\s*\|\s*([^|]*?)\s*\|/gm)].map(
    (match) => ({ code: match[1], meaning: match[2] })
  )
}

describe('the README error code table', () => {
  const source = readFileSync(join(ROOT, 'src', 'shared', 'error-codes.ts'), 'utf8')
  const rows = readmeRows(readFileSync(join(ROOT, 'README.md'), 'utf8'))

  it('lists every code of the catalogue once, and no other', () => {
    // Scenario: the set and the order of the codes in the table are those of the catalogue.
    assert.deepEqual(
      rows.map((row) => row.code),
      catalogueCodes(source)
    )
  })

  it('gives each code the message the catalogue gives it', () => {
    // Scenario: the meaning column is the catalogue's message, word for word.
    const messages = catalogueMessages(source)
    assert.equal(messages.size, rows.length)
    for (const row of rows) assert.equal(row.meaning, messages.get(row.code), row.code)
  })
})
