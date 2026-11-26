/**
 * @fileoverview Tests that every row of the acceptance table in `docs/acceptance.md` names a file
 * that exists and a test title that is written in it, so a renamed or removed test fails the lint
 * chain instead of leaving the table pointing at nothing, and that the table covers every
 * criterion the specification lists for this repository.
 * @layer scripts
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TABLE = readFileSync(join(ROOT, 'docs', 'acceptance.md'), 'utf8')

/** Every row of the table: the criterion, the test file and the test title. */
function rows() {
  return [
    ...TABLE.matchAll(/^\|\s*(AC\d\d[^|]*?)\s*\|[^|]*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|$/gm)
  ].map((match) => ({ criterion: match[1], file: match[2], title: match[3] }))
}

describe('the acceptance table', () => {
  it('names a file that exists and a title written in it, for every row', () => {
    // Scenario: each row points at a real test; a title is searched as written in the source.
    const found = rows()
    assert.ok(found.length >= 20, 'the table has its rows')
    for (const row of found) {
      const path = join(ROOT, row.file)
      assert.ok(existsSync(path), `${row.file} exists`)
      assert.ok(readFileSync(path, 'utf8').includes(row.title), `${row.title} is in ${row.file}`)
    }
  })

  it('covers AC01 to AC09 and the Appendix A half of AC10', () => {
    // Scenario: no criterion of this repository is left without a test.
    const covered = new Set(rows().map((row) => row.criterion.replace(/ \(A\)$/, '')))
    for (let number = 1; number <= 10; number += 1) {
      const id = `AC${String(number).padStart(2, '0')}`
      assert.ok(covered.has(id), `${id} has a test`)
    }
  })
})
