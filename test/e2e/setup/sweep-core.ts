/**
 * @fileoverview What the sentinel sweep of the end-to-end run is made of, with no test framework
 * hook: the recording of what could carry a secret or an identifier out of the library, the search
 * of a recording for sentinels, and the list of sentinels the suite declares. The global teardown,
 * which has no test hooks, and the sweep's own spec use it as well as the sweep that is loaded into
 * every test file.
 * @layer e2e
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

import { assertNoSentinel, type Capture } from '../../../src/testing/capture'

/** The directory of the end-to-end specs and their fixtures. */
export const E2E_DIR = join(__dirname, '..')

/** The repository's source directory, whose errors the sweep records. */
export const SRC_DIR = join(__dirname, '..', '..', '..', 'src') + sep

/** The name of the environment variable that holds the directory the files write their counts to. */
export const SWEEP_DIR_VARIABLE = 'SENTINEL_SWEEP_DIR'

/** Identifiers the fixtures use that do not start with the sentinel prefix, searched for too. */
const PLAIN_IDENTIFIERS: readonly string[] = [
  'user_PLACEHOLDER_a',
  'user_PLACEHOLDER_b',
  'customer_a'
]

/** Values a spec plants on purpose to prove its own capture can see something; never searched. */
const PLANTED: readonly string[] = ['sentinel-planted']

/** Where a leak was found. */
export type LeakPlace = 'log line' | 'observer payload' | 'response body' | 'error message'

/** One sentinel found where none may be. It names the place and never repeats the value. */
export interface Leak {
  /** What kind of output held it. */
  readonly place: LeakPlace
  /** The position of the holder among the outputs of its kind. */
  readonly index: number
  /** The position of the sentinel in the list searched. */
  readonly sentinel: number
}

/** Everything one test file produced that the sweep searches. */
export interface Recording {
  /** The lines the library wrote through the framework's logger, and those of watched captures. */
  readonly lines: string[]
  /** The observer payloads of watched captures, kept whole so nested values are walked. */
  readonly payloads: Capture['payloads'][number][]
  /** The bodies and headers of the responses a framework application sent. */
  readonly bodies: string[]
  /** The messages of the errors the library's own code built. */
  readonly errors: string[]
}

/** An empty recording. */
export function emptyRecording(): Recording {
  return { lines: [], payloads: [], bodies: [], errors: [] }
}

/** The first position in `texts` whose entry holds `needle`, or `-1`. */
function indexOfText(texts: readonly string[], needle: string): number {
  return texts.findIndex((text) => text.includes(needle))
}

/** The leaks of one sentinel in the observer payloads, found by the testing subpath's own walk. */
function payloadLeak(
  payloads: Recording['payloads'],
  sentinels: readonly string[],
  position: number
): Leak | undefined {
  const sentinel = sentinels[position] ?? ''
  const capture: Capture = {
    logger: { warn: () => undefined },
    observer: Object.create(null) as Capture['observer'],
    lines: [],
    payloads
  }
  try {
    assertNoSentinel(capture, [sentinel])
  } catch (error) {
    const found = /observer payload (\d+)/.exec(String(error))
    return { place: 'observer payload', index: Number(found?.[1] ?? 0), sentinel: position }
  }
  return undefined
}

/**
 * Searches a recording for every sentinel and returns each place one was found. The result never
 * holds a sentinel's value: a leak is named by its place and its positions.
 *
 * @param recording What the run produced.
 * @param sentinels The values that must appear nowhere; none may be empty.
 */
export function findLeaks(recording: Recording, sentinels: readonly string[]): Leak[] {
  const leaks: Leak[] = []
  sentinels.forEach((sentinel, position) => {
    if (sentinel.length === 0) throw new Error('A sentinel may not be empty.')
    const kinds: [LeakPlace, readonly string[]][] = [
      ['log line', recording.lines],
      ['response body', recording.bodies],
      ['error message', recording.errors]
    ]
    for (const [place, texts] of kinds) {
      const index = indexOfText(texts, sentinel)
      if (index !== -1) leaks.push({ place, index, sentinel: position })
    }
    const inPayload = payloadLeak(recording.payloads, sentinels, position)
    if (inPayload !== undefined) leaks.push(inPayload)
  })
  return leaks
}

/** Every `.ts` file under a directory, outside the sweep's own. */
function sourcesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'setup' ? [] : sourcesUnder(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/**
 * The sentinels the suite declares: every `sentinel-` token in a spec or a fixture, the planted
 * ones left out, and the plain identifiers the fixtures use.
 */
export function declaredSentinels(): string[] {
  const found = new Set<string>(PLAIN_IDENTIFIERS)
  for (const file of sourcesUnder(E2E_DIR)) {
    for (const token of readFileSync(file, 'utf8').match(/sentinel-[a-z0-9][a-z0-9-]*/g) ?? []) {
      found.add(token)
    }
  }
  for (const planted of PLANTED) found.delete(planted)
  return [...found].sort()
}

/** The number of spec files in the suite. */
export function specFileCount(): number {
  return sourcesUnder(E2E_DIR).filter((file) => file.endsWith('.e2e-spec.ts')).length
}

/** The counts of one test file, written for the global teardown. */
export interface FileResult {
  /** The test file, relative to the repository. */
  readonly file: string
  /** How many log lines were checked. */
  readonly lines: number
  /** How many observer payloads were checked. */
  readonly payloads: number
  /** How many response bodies were checked. */
  readonly bodies: number
  /** How many error messages were checked. */
  readonly errors: number
  /** How many sentinels were searched for. */
  readonly sentinels: number
  /** Every leak found. */
  readonly leaks: readonly Leak[]
}
