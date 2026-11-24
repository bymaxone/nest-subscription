/**
 * @fileoverview The sweep every end-to-end secret test shares: sentinel values and the function
 * that applies every path able to expose a value to an object and returns what each printed.
 * @layer e2e
 */
import { inspect } from 'node:util'

export const WEBHOOK_SENTINEL = 'sentinel-webhook-secret-c0ffee01'
export const ROTATED_SENTINEL = 'sentinel-rotated-secret-bada5501'

/** Applies every path that could expose a value to `subject` and returns what each one printed. */
export function outputsOf(subject: object): readonly string[] {
  const keys: string[] = []
  for (const key in subject) keys.push(key)
  return [
    safely(() => JSON.stringify(subject)),
    safely(() => JSON.stringify({ ...subject })),
    safely(() => inspect(subject)),
    safely(() => inspect(subject, { showHidden: true })),
    safely(() => inspect(subject, { showHidden: true, depth: null })),
    safely(() => inspect(subject, { showHidden: true, depth: null, getters: true })),
    safely(() => JSON.stringify(Object.entries(subject))),
    safely(() => JSON.stringify(Object.getOwnPropertyNames(subject))),
    safely(() => JSON.stringify(Object.getOwnPropertySymbols(subject).map(String))),
    safely(() => JSON.stringify(Object.assign({}, subject))),
    safely(() => String(structuredClone({ ...subject }))),
    keys.join(),
    safely(() => `${String(subject)}`)
  ]
}

function safely(print: () => string | undefined): string {
  try {
    return print() ?? ''
  } catch (error) {
    // A value that cannot be printed (a function in a structured clone) exposes nothing.
    return error instanceof Error ? error.constructor.name : ''
  }
}

/** Fails when any output holds a sentinel. */
export function expectNoSentinel(outputs: readonly string[]): void {
  expect(outputs.length).toBeGreaterThan(0)
  for (const output of outputs) {
    expect(output).not.toContain(WEBHOOK_SENTINEL)
    expect(output).not.toContain(ROTATED_SENTINEL)
  }
}
