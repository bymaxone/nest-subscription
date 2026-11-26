/**
 * @fileoverview A local stand-in for the RevenueCat REST API, version 2: a plain HTTP server on a
 * loopback address that serves the recorded fixtures at the paths the adapter reads, answers 404
 * with RevenueCat's error body for a customer it has not been told about, and can be scripted per
 * customer, made to fail or to refuse the key. It is the only HTTP the end-to-end suite uses, and
 * the adapter reaches it through its `baseUrl` option.
 * @layer e2e
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
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
  /** The body, as text; empty when none was sent. */
  readonly body: string
}

/** A scripted answer: a status, a body, and the address of a redirect when it has one. */
export interface StandInAnswer {
  /** The status. */
  readonly status: number
  /** The body, sent as JSON unless it is a string, which is sent as it is. */
  readonly body?: unknown
  /** An address to redirect to, sent as `Location`. */
  readonly location?: string
}

/** Decides the answer to one request, or leaves it to the customers the stand-in serves. */
export type StandInHandler = (request: StandInRequest) => StandInAnswer | undefined

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
  /**
   * Answers each request with what the handler returns, ahead of the customers it serves, or goes
   * back to normal with `null`. A handler that returns `undefined` leaves the request to them.
   */
  respondWith(handler: StandInHandler | null): void
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

/** What the stand-in is told while it runs, which its answers depend on. */
interface Script {
  readonly customers: Map<string, StandInCustomer>
  failing: number | null
  handler: StandInHandler | null
}

/** Writes an answer as JSON, or as it is when the body is text. */
function reply(response: ServerResponse, answer: StandInAnswer): void {
  response.writeHead(answer.status, {
    'content-type': 'application/json',
    ...(answer.location === undefined ? {} : { location: answer.location })
  })
  response.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {}))
}

/** The answer to a request: a failure, a scripted answer, a refusal of the key, a list or a 404. */
function answerOf(script: Script, expectedKey: string, received: StandInRequest): StandInAnswer {
  if (script.failing !== null) return { status: script.failing, body: { type: 'server_error' } }
  const scripted = script.handler?.(received)
  if (scripted !== undefined) return scripted
  if (received.authorization !== `Bearer ${expectedKey}`) {
    return { status: 401, body: { type: 'authentication_error' } }
  }
  const target = parsePath(received.url)
  const held = target === undefined ? undefined : script.customers.get(target.customer)
  const body = held === undefined || target === undefined ? undefined : listFor(held, target.list)
  return body === undefined ? { status: 404, body: RESOURCE_MISSING } : { status: 200, body }
}

/**
 * Starts the stand-in on a free loopback port.
 *
 * @param expectedKey The API key it accepts; any other credential is answered 401.
 */
export async function startStandIn(expectedKey: string): Promise<StandIn> {
  const script: Script = { customers: new Map(), failing: null, handler: null }
  const requests: StandInRequest[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => void chunks.push(chunk))
    request.on('end', () => {
      const received: StandInRequest = {
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8')
      }
      requests.push(received)
      reply(response, answerOf(script, expectedKey, received))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the stand-in has no port')
  const empty = { object: 'list', items: [], next_page: null, url: '' }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v2`,
    requests,
    serveFixture: (customerId, name) => void script.customers.set(customerId, fixtureLists(name)),
    serve: (customerId, lists) =>
      void script.customers.set(customerId, {
        subscriptions: lists.subscriptions ?? empty,
        purchases: lists.purchases ?? empty,
        activeEntitlements: lists.activeEntitlements ?? empty
      }),
    forget: (customerId) => void script.customers.delete(customerId),
    failWith: (status) => {
      script.failing = status
    },
    respondWith: (next) => {
      script.handler = next
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
  }
}
