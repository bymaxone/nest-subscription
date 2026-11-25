/**
 * @fileoverview A local stand-in for the RevenueCat REST API, version 2: a plain HTTP server on a
 * loopback address that serves the recorded fixtures at the paths the adapter reads, answers 404
 * with RevenueCat's error body for a customer it has not been told about, and can be scripted per
 * customer, made to fail or to refuse the key. It is the only HTTP the end-to-end suite uses, and
 * the adapter reaches it through its `baseUrl` option.
 * @layer e2e
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'

const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'revenuecat')

/** The lists of one customer, as the API returns them. */
export interface StandInCustomer {
  /** The body of the subscriptions list. */
  readonly subscriptions: unknown
  /** The body of the purchases list. */
  readonly purchases: unknown
  /** The body of the active-entitlements list. */
  readonly activeEntitlements: unknown
}

/** The error body RevenueCat sends for a customer it has no record of (recorded 2026-11-25). */
const RESOURCE_MISSING = {
  doc_url: 'https://errors.rev.cat/resource-missing',
  message: 'Could not find customer ID associated with this project',
  object: 'error',
  retryable: false,
  type: 'resource_missing'
}

/** A request the stand-in received. */
export interface StandInRequest {
  /** The method. */
  readonly method: string
  /** The path and query, as sent. */
  readonly url: string
  /** The `Authorization` header, as sent. */
  readonly authorization: string | undefined
}

/** A running stand-in. */
export interface StandIn {
  /** The base address to give the adapter's `baseUrl` option. */
  readonly baseUrl: string
  /** Every request received, in order. */
  readonly requests: StandInRequest[]
  /** Serves the customer from the recorded fixture `name`, whatever the fixture's own identifier. */
  serveFixture(customerId: string, name: string): void
  /** Serves the customer from the given lists. */
  serve(customerId: string, lists: Partial<StandInCustomer>): void
  /** Forgets a customer, so it answers 404 again. */
  forget(customerId: string): void
  /** Answers every request with this status, or goes back to normal with `null`. */
  failWith(status: number | null): void
  /** Stops the server and closes its connections. */
  close(): Promise<void>
}

/** The lists a fixture file holds, with the empty list for a list it does not have. */
export function fixtureLists(name: string): StandInCustomer {
  const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))
  const fixture: Record<string, unknown> = Object(parsed)
  const empty = { object: 'list', items: [], next_page: null, url: '' }
  return {
    subscriptions: fixture['subscriptions'] ?? empty,
    purchases: fixture['purchases'] ?? empty,
    activeEntitlements: fixture['activeEntitlements'] ?? empty
  }
}

/** The lists of the customer path `/v2/projects/{p}/customers/{id}/{list}`, or `undefined`. */
function parsePath(url: string): { customer: string; list: string } | undefined {
  const match = /^\/v2\/projects\/[^/]+\/customers\/([^/]+)\/([a-z_]+)$/.exec(
    url.split('?')[0] ?? ''
  )
  return match === null
    ? undefined
    : { customer: decodeURIComponent(match[1] ?? ''), list: match[2] ?? '' }
}

/** The list of a customer a path names, or `undefined` for a path that names none. */
function listFor(held: StandInCustomer, list: string): unknown {
  switch (list) {
    case 'subscriptions':
      return held.subscriptions
    case 'purchases':
      return held.purchases
    case 'active_entitlements':
      return held.activeEntitlements
    default:
      return undefined
  }
}

/**
 * Starts the stand-in on a free loopback port.
 *
 * @param expectedKey The API key it accepts; any other credential is answered 401.
 */
export async function startStandIn(expectedKey: string): Promise<StandIn> {
  const customers = new Map<string, StandInCustomer>()
  const requests: StandInRequest[] = []
  let failing: number | null = null
  const server: Server = createServer((request, response) => {
    const url = request.url ?? ''
    requests.push({
      method: request.method ?? '',
      url,
      authorization: request.headers.authorization
    })
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (failing !== null) return send(failing, { type: 'server_error' })
    if (request.headers.authorization !== `Bearer ${expectedKey}`) {
      return send(401, { type: 'authentication_error' })
    }
    const target = parsePath(url)
    const held = target === undefined ? undefined : customers.get(target.customer)
    const body = held === undefined || target === undefined ? undefined : listFor(held, target.list)
    return body === undefined ? send(404, RESOURCE_MISSING) : send(200, body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the stand-in has no port')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v2`,
    requests,
    serveFixture: (customerId, name) => void customers.set(customerId, fixtureLists(name)),
    serve: (customerId, lists) => {
      const empty = { object: 'list', items: [], next_page: null, url: '' }
      customers.set(customerId, {
        subscriptions: lists.subscriptions ?? empty,
        purchases: lists.purchases ?? empty,
        activeEntitlements: lists.activeEntitlements ?? empty
      })
    },
    forget: (customerId) => void customers.delete(customerId),
    failWith: (status) => {
      failing = status
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
  }
}
