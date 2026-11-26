/**
 * @fileoverview The sweep over the whole end-to-end run. Every test file of the suite uses
 * recognisable `sentinel-` values for its secrets and identifiers; this module, loaded into each
 * test file, records everything that could carry one out of the library (every line the library
 * logged through the framework's logger, every captured logger line and observer payload, every
 * HTTP response of a framework application, and the message of every error the library's own code
 * built) and, when the file ends, searches it for every sentinel the suite declares. A leak fails
 * the file. The counts are written for the global teardown, which fails the run on any leak and
 * reports how much was checked.
 * @layer e2e
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { ServerResponse } from 'node:http'
import { join, relative, sep } from 'node:path'

import { Logger, type LoggerService } from '@nestjs/common'
import type { Capture } from '../../../src/testing/capture'

import {
  E2E_DIR,
  SRC_DIR,
  SWEEP_DIR_VARIABLE,
  declaredSentinels,
  emptyRecording,
  findLeaks,
  type FileResult,
  type Recording
} from './sweep-core'

/** The recording of the test file that is running. */
const recording: Recording = emptyRecording()

/** Adds the lines and the observer payloads of a capture to what the sweep searches at the end. */
export function watch(capture: Capture): void {
  watched.push(capture)
}

const watched: Capture[] = []

/** What the running test file has recorded so far, for the sweep's own spec. */
export function recorded(): Readonly<Recording> {
  return recording
}

/** The text of a chunk a response wrote. */
function textOf(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk
  return chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : ''
}

/** Records what framework applications send, and returns what puts the original methods back. */
function recordResponses(into: string[]): () => void {
  const { write, end } = ServerResponse.prototype
  const keep = (response: ServerResponse, chunk: unknown): void => {
    // Only a response of a framework application: a local stand-in for a provider speaks for the
    // provider, and what it says is not the library's output.
    if (response.hasHeader('x-powered-by')) into.push(textOf(chunk))
  }
  ServerResponse.prototype.write = function (this: ServerResponse, ...args: unknown[]): boolean {
    keep(this, args[0])
    return Reflect.apply(write, this, args) as boolean
  }
  ServerResponse.prototype.end = function (
    this: ServerResponse,
    ...args: unknown[]
  ): ServerResponse {
    keep(this, args[0])
    if (this.hasHeader('x-powered-by')) into.push(JSON.stringify(this.getHeaders()))
    return Reflect.apply(end, this, args) as ServerResponse
  }
  return () => {
    ServerResponse.prototype.write = write
    ServerResponse.prototype.end = end
  }
}

/**
 * Whether the code that built an error is the repository's own source: the first frame outside the
 * framework's and the dependencies' packages and outside this sweep, in a file that is not a spec.
 * An error a test builds to feed the library, or one the library's caller builds, is not the
 * library's output.
 */
function builtBySource(stack: string | undefined): boolean {
  const frames = (stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at '))
  const own = frames.find(
    (frame) =>
      !frame.includes(`${sep}node_modules${sep}`) &&
      !frame.includes('node:internal') &&
      !frame.includes(__filename)
  )
  return own !== undefined && own.includes(SRC_DIR) && !own.includes('.spec.')
}

/** Records the message of every error the library's own code builds; returns the restore. */
function recordErrors(into: string[]): () => void {
  const original = globalThis.Error
  globalThis.Error = new Proxy(original, {
    construct(target, args: unknown[], newTarget): object {
      const made = Reflect.construct(target, args, newTarget) as Error
      if (builtBySource(made.stack)) into.push(made.message)
      return made
    }
  })
  return () => {
    globalThis.Error = original
  }
}

/** Whether a value is a logger the framework's static `Logger` can be given back. */
function isLogger(value: unknown): value is LoggerService {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'log') === 'function'
  )
}

/** A logger for the framework's static `Logger` that records every message. */
function recordLogger(into: string[]): () => void {
  const previous: unknown = Reflect.get(Logger, 'staticInstanceRef')
  const write = (message: unknown, ...rest: unknown[]): void => {
    into.push([message, ...rest].map((part) => (typeof part === 'string' ? part : '')).join(' '))
  }
  Logger.overrideLogger({
    log: write,
    error: write,
    warn: write,
    debug: write,
    verbose: write,
    fatal: write
  })
  return () => {
    if (isLogger(previous)) Logger.overrideLogger(previous)
    else Logger.overrideLogger(false)
  }
}

/** Finishes a test file: searches what it recorded and writes the counts. */
function finish(file: string): FileResult {
  const sentinels = declaredSentinels()
  const all: Recording = {
    lines: [...recording.lines, ...watched.flatMap((capture) => [...capture.lines])],
    payloads: [...recording.payloads, ...watched.flatMap((capture) => [...capture.payloads])],
    bodies: recording.bodies,
    errors: recording.errors
  }
  const result: FileResult = {
    file: relative(join(E2E_DIR, '..', '..'), file),
    lines: all.lines.length,
    payloads: all.payloads.length,
    bodies: all.bodies.length,
    errors: all.errors.length,
    sentinels: sentinels.length,
    leaks: findLeaks(all, sentinels)
  }
  const directory = process.env[SWEEP_DIR_VARIABLE]
  if (directory !== undefined) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, `${result.file.split(sep).join('_')}.json`),
      JSON.stringify(result)
    )
  }
  return result
}

// The error constructor is replaced while this file loads, before the spec imports the library: a
// class that extends `Error` binds the constructor it finds when it is defined.
const restore: (() => void)[] = [recordErrors(recording.errors)]

beforeAll(() => {
  restore.push(recordLogger(recording.lines), recordResponses(recording.bodies))
})

afterAll(() => {
  for (const undo of restore.reverse()) undo()
  const result = finish(expect.getState().testPath ?? 'unknown')
  if (result.leaks.length > 0) {
    const where = result.leaks
      .map((leak) => `${leak.place} ${String(leak.index)} (sentinel ${String(leak.sentinel)})`)
      .join('; ')
    throw new Error(`The sentinel sweep found a leak in ${result.file}: ${where}.`)
  }
})
