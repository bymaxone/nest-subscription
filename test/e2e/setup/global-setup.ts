/**
 * @fileoverview Global setup of the end-to-end run: creates the directory in which each test file
 * writes what its sentinel sweep checked, and tells the workers where it is.
 * @layer e2e
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VARIABLE = 'SENTINEL_SWEEP_DIR'

/** Creates the directory for the counts of this run. */
export default function globalSetup(): void {
  process.env[VARIABLE] = mkdtempSync(join(tmpdir(), 'sentinel-sweep-'))
}
