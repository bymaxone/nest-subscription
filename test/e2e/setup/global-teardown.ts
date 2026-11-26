/**
 * @fileoverview Global teardown of the end-to-end run: reads what every test file's sentinel sweep
 * checked, reports the totals and fails the run when any file found a leak. A run of the whole
 * suite must also have checked something of every kind, so a sweep that stopped recording cannot
 * pass by finding nothing.
 * @layer e2e
 */
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { specFileCount, type FileResult } from './sweep-core'

const VARIABLE = 'SENTINEL_SWEEP_DIR'

/** The counts every file wrote. */
function readResults(directory: string): FileResult[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as FileResult)
}

/** The sum of one count over the files. */
function total(results: readonly FileResult[], count: (result: FileResult) => number): number {
  return results.reduce((sum, result) => sum + count(result), 0)
}

/** Reports the totals and fails the run on a leak or, for a whole run, on a sweep that saw nothing. */
export default function globalTeardown(): void {
  const directory = process.env[VARIABLE]
  if (directory === undefined) throw new Error('The sentinel sweep was not set up.')
  const results = readResults(directory)
  rmSync(directory, { recursive: true, force: true })
  const lines = total(results, (result) => result.lines)
  const payloads = total(results, (result) => result.payloads)
  const bodies = total(results, (result) => result.bodies)
  const errors = total(results, (result) => result.errors)
  const sentinels = Math.max(0, ...results.map((result) => result.sentinels))
  const leaks = results.flatMap((result) =>
    result.leaks.map((leak) => `${result.file}: ${leak.place} ${String(leak.index)}`)
  )
  console.log(
    `Sentinel sweep: ${String(sentinels)} sentinels searched in ${String(lines)} log lines, ` +
      `${String(payloads)} observer payloads, ${String(bodies)} response bodies and ` +
      `${String(errors)} error messages across ${String(results.length)} test files.`
  )
  if (leaks.length > 0) throw new Error(`The sentinel sweep found leaks: ${leaks.join('; ')}.`)
  const wholeRun = results.length >= specFileCount()
  if (wholeRun && [lines, payloads, bodies, errors].some((count) => count === 0)) {
    throw new Error('The sentinel sweep checked nothing of at least one kind in a whole run.')
  }
}
