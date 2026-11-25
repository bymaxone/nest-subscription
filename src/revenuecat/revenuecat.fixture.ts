/**
 * @fileoverview Test support for the adapter's specs: the recorded fixtures under
 * `test/fixtures/revenuecat/`, and a `fetch` stand-in that serves one fixture at the version 2
 * paths the adapter reads. Test-only: it is not exported from the entry point.
 * @layer revenuecat
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { JsonRecord } from './read/parse-customer'
import type { RevenueCatFetch } from './revenuecat.options'

const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'revenuecat')

/** The parsed content of a fixture file, without its extension in `name`. */
export function loadFixture(name: string): JsonRecord {
  const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))
  // `Object` wraps a primitive and turns `null` into an empty object, so every fixture reads as one.
  const record: JsonRecord = Object(parsed)
  return record
}

/** One request the stand-in served. */
export interface FetchCall {
  /** The full address that was requested. */
  readonly url: string
  /** The options the request was made with. */
  readonly init: RequestInit
}

/** The fixture field that holds each list the adapter reads, by the path segment that names it. */
const RESOURCES: ReadonlyMap<string, string> = new Map([
  ['subscriptions', 'subscriptions'],
  ['purchases', 'purchases'],
  ['active_entitlements', 'activeEntitlements']
])

/** The last segment of a path, which names the list asked for. */
function lastSegment(url: string): string {
  const { pathname } = new URL(url)
  return pathname.slice(pathname.lastIndexOf('/') + 1)
}

/**
 * A `fetch` that serves the fixture `name` at the customer list paths, and 404 elsewhere. Every
 * request is appended to `calls`. A fixture with a `status` serves that status and its error body
 * for every list, as RevenueCat does for a customer it has no record of.
 */
export function fixtureFetch(name: string, calls: FetchCall[] = []): RevenueCatFetch {
  const fixture = loadFixture(name)
  return (url, init) => {
    calls.push({ url, init })
    const field = RESOURCES.get(lastSegment(url))
    const status: unknown = Reflect.get(fixture, 'status')
    const hasStatus = typeof status === 'number'
    const body: unknown =
      field === undefined ? undefined : Reflect.get(fixture, hasStatus ? 'error' : field)
    if (body === undefined) return Promise.resolve(new Response('{}', { status: 404 }))
    return Promise.resolve(new Response(JSON.stringify(body), { status: hasStatus ? status : 200 }))
  }
}
