/**
 * @fileoverview Pins the RevenueCat HTTP client with a stubbed `fetch`: the request it builds,
 * the failures it maps to the library's errors, and that nothing a caller or the provider
 * supplied reaches an error.
 * @layer revenuecat
 */
import { Secret, SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { encodeSegment, RevenueCatHttp } from './revenuecat-http'
import type { RevenueCatFetch } from './revenuecat.options'

const KEY = 'sentinel-api-key-7f3a'
const CUSTOMER = 'sentinel-customer/with slash'
const BODY_SENTINEL = 'sentinel-response-body-44ce'

function clientWith(fetchStub: RevenueCatFetch, timeoutMs = 5_000): RevenueCatHttp {
  return new RevenueCatHttp({
    baseUrl: 'http://127.0.0.1:9/v2',
    apiKey: new Secret(KEY),
    timeoutMs,
    fetch: fetchStub
  })
}

/** What a call rejected with. */
async function rejection(call: Promise<unknown>): Promise<SubscriptionError> {
  try {
    await call
  } catch (error) {
    if (error instanceof SubscriptionError) return error
    throw error
  }
  throw new Error('the call did not reject')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('RevenueCatHttp', () => {
  it('sends the bearer key, the accept header and the path under the base address', async () => {
    // Scenario: a read of a path with a query; the call carries the credential and nothing else.
    const stub = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse(200, { ok: true }))
    )
    const parsed = await clientWith(stub).get('/projects/p/customers/c/subscriptions', {
      limit: '100',
      starting_after: 'sub 1'
    })
    expect(parsed).toStrictEqual({ ok: true })
    expect(stub).toHaveBeenCalledTimes(1)
    const [url, init] = stub.mock.calls[0] ?? []
    expect(url).toBe(
      'http://127.0.0.1:9/v2/projects/p/customers/c/subscriptions?limit=100&starting_after=sub+1'
    )
    expect(init?.method).toBe('GET')
    expect(init?.headers).toStrictEqual({
      authorization: `Bearer ${KEY}`,
      accept: 'application/json'
    })
    expect(init?.body).toBeUndefined()
  })

  it('sends a request without a query as the bare path', async () => {
    // Scenario: no query object means no question mark.
    const stub = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse(200, {}))
    )
    await clientWith(stub).get('/projects/p')
    expect(stub.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9/v2/projects/p')
  })

  it('sends a JSON body and its content type on a post', async () => {
    // Scenario: a post carries the body as JSON and declares it.
    const stub = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse(200, { done: 1 }))
    )
    const parsed = await clientWith(stub).post('/projects/p/x', { a: 1 })
    expect(parsed).toStrictEqual({ done: 1 })
    const init = stub.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"a":1}')
    expect(init?.headers).toStrictEqual({
      authorization: `Bearer ${KEY}`,
      accept: 'application/json',
      'content-type': 'application/json'
    })
  })

  it('refuses redirects and bounds each request with the configured time limit', async () => {
    // Scenario: the credential must never follow a redirect to another host, and no request may
    // hang; the signal comes from the runtime's timeout for the configured number of milliseconds.
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    const stub = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse(200, {}))
    )
    await clientWith(stub, 1234).get('/x')
    expect(timeout).toHaveBeenCalledTimes(1)
    expect(timeout).toHaveBeenCalledWith(1234)
    const init = stub.mock.calls[0]?.[1]
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps a 404 to the account-unknown code', async () => {
    // Scenario: RevenueCat has no record of the customer; the read turns this into an empty snapshot.
    const error = await rejection(
      clientWith(() => Promise.resolve(jsonResponse(404, { message: BODY_SENTINEL }))).get('/x')
    )
    expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
  })

  it.each([400, 401, 403, 409, 422, 429, 500, 502, 503, 504])(
    'maps status %s to the source-unavailable code',
    async (status) => {
      // Scenario: any failure that is not "no such customer" means the source could not be read.
      const error = await rejection(
        clientWith(() => Promise.resolve(jsonResponse(status, { message: BODY_SENTINEL }))).get(
          '/x'
        )
      )
      expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    }
  )

  it('maps a network error, a timeout and a redirect to the source-unavailable code', async () => {
    // Scenario: the stub rejects the way fetch does for each; the cause is dropped.
    for (const failure of [
      new TypeError('fetch failed'),
      new DOMException('timed out', 'TimeoutError'),
      new TypeError(`redirect mode is set to error: ${CUSTOMER}`)
    ]) {
      const error = await rejection(clientWith(() => Promise.reject(failure)).get('/x'))
      expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
      expect(error.cause).toBeUndefined()
    }
  })

  it('maps a success whose body is not JSON to the source-unavailable code', async () => {
    // Scenario: an HTML error page behind a gateway answers 200.
    const error = await rejection(
      clientWith(() => Promise.resolve(new Response('<html>'))).get('/x')
    )
    expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
  })

  it('releases the body of a failed response without reading it', async () => {
    // Scenario: the body of an error answer is never parsed or shown, only cancelled.
    const stream = new ReadableStream<Uint8Array>()
    const cancel = jest.spyOn(stream, 'cancel')
    const response = new Response(stream, { status: 500 })
    const json = jest.spyOn(response, 'json')
    await rejection(clientWith(() => Promise.resolve(response)).get('/x'))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(json).toHaveBeenCalledTimes(0)
  })

  it('maps the status even when releasing the body fails', async () => {
    // Scenario: the cancellation of the body of a failed answer rejects; the status still decides.
    const stream = new ReadableStream<Uint8Array>()
    jest.spyOn(stream, 'cancel').mockRejectedValue(new Error('cancel failed'))
    const error = await rejection(
      clientWith(() => Promise.resolve(new Response(stream, { status: 500 }))).get('/x')
    )
    expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
  })

  it('survives a response with no body to release', async () => {
    // Scenario: a 500 with a null body has nothing to cancel.
    const error = await rejection(
      clientWith(() => Promise.resolve(new Response(null, { status: 500 }))).get('/x')
    )
    expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
  })

  it('puts no key, identifier, address or body into an error of any failure', async () => {
    // Scenario: every failure kind, with sentinels in the path, the key and the response body;
    // the message, the serialized form and the cause show none of them.
    const stubs: RevenueCatFetch[] = [
      () => Promise.resolve(jsonResponse(404, { message: BODY_SENTINEL })),
      () => Promise.resolve(jsonResponse(500, { message: BODY_SENTINEL })),
      () => Promise.resolve(new Response(BODY_SENTINEL)),
      () => Promise.reject(new TypeError(`${KEY} ${CUSTOMER} ${BODY_SENTINEL}`))
    ]
    for (const stub of stubs) {
      const error = await rejection(clientWith(stub).get(`/customers/${encodeSegment(CUSTOMER)}`))
      const shown = `${error.message}${JSON.stringify(error)}${String(error.cause)}${error.stack ?? ''}`
      for (const sentinel of [KEY, CUSTOMER, encodeSegment(CUSTOMER), BODY_SENTINEL, '127.0.0.1']) {
        expect(shown).not.toContain(sentinel)
      }
    }
  })

  it('makes exactly one request per call and never retries', async () => {
    // Scenario: a 503 is surfaced at once; the caller decides whether to ask again.
    const stub = jest.fn<Promise<Response>, [string, RequestInit]>(() =>
      Promise.resolve(jsonResponse(503, {}))
    )
    await rejection(clientWith(stub).get('/x'))
    expect(stub).toHaveBeenCalledTimes(1)
  })
})

describe('encodeSegment', () => {
  it.each([
    ['a plain identifier', 'user_1', 'user_1'],
    ['a slash', 'a/b', 'a%2Fb'],
    ['a question mark and a hash', 'a?b#c', 'a%3Fb%23c'],
    ['a dollar sign and a colon', '$RCAnonymousID:x', '%24RCAnonymousID%3Ax'],
    ['a space and a percent sign', 'a b%', 'a%20b%25']
  ])('encodes %s so it cannot add or end a segment', (_label, given, encoded) => {
    // Scenario: App User IDs are free text; the encoded form has no separator in it.
    expect(encodeSegment(given)).toBe(encoded)
  })
})

describe('encodeSegment of a dot segment', () => {
  it.each(['.', '..'])('refuses %j, which a URL would resolve instead of send', (given) => {
    // Scenario: an identifier of dots would be read as a path step, even percent-encoded, so it
    // is an account RevenueCat cannot have: unknown.
    expect(() => encodeSegment(given)).toThrow(
      expect.objectContaining({ code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN })
    )
  })
})
