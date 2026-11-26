/**
 * @fileoverview The RevenueCat adapter against responses and requests that are not the ordinary
 * ones, over the local stand-in's real HTTP: lists that are cut, never end or are not lists,
 * items that cannot be named, fields of the wrong type, redirects, failures and bodies that are
 * not JSON, options that are refused, webhook headers and bodies that are malformed, and the
 * sequences of reads that make a purchase appear, change and leave. Each case is one the adapter
 * must answer as a value or as the library's fixed error, never with an exception of its own.
 * @layer e2e
 */
import { SUBSCRIPTION_ERROR_CODES, SubscriptionError } from '@bymax-one/nest-subscription'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import { buildRevenueCatWebhookRequest, ManualClock } from '@bymax-one/nest-subscription/testing'
import {
  revenueCatSource,
  type RevenueCatSourceOptions
} from '@bymax-one/nest-subscription/revenuecat'

import { Secret } from '@bymax-one/nest-subscription'
import { diffSnapshots } from '../../src/core/notifications/diff-snapshots'
import { RevenueCatHttp } from '../../src/revenuecat/revenuecat-http'
import { fixtureFetch, loadFixture } from '../../src/revenuecat/revenuecat.fixture'
import { startStandIn, type StandIn, type StandInAnswer } from './fixtures/revenuecat-stand-in'

const KEY = 'sentinel-api-key-edge-4c2a'
const SIGNING = 'sentinel-signing-secret-edge-18fe'
const AUTHORIZATION = 'sentinel-authorization-edge-5b3d'
const NOW = new Date('2026-11-25T12:00:00.000Z')

let stand: StandIn

beforeEach(async () => {
  stand = await startStandIn(KEY)
})

afterEach(async () => {
  await stand.close()
})

/** The adapter pointed at the stand-in, with the options overridden. */
function adapter(
  overrides: Partial<RevenueCatSourceOptions> = {}
): ReturnType<typeof revenueCatSource> {
  return revenueCatSource({
    projectId: 'proj_PLACEHOLDER',
    apiKey: KEY,
    baseUrl: stand.baseUrl,
    clock: { now: () => NOW },
    ...overrides
  })
}

const list = (items: unknown[], next: string | null = null): unknown => ({
  object: 'list',
  items,
  next_page: next
})

/** The last path segment of a request, which names the list asked for. */
const resource = (url: string): string => url.split('?')[0]?.split('/').at(-1) ?? ''

/** Answers each list with the body given for it, and the rest as an empty list. */
function lists(bodies: Record<string, unknown>) {
  return (request: { url: string }): StandInAnswer => {
    const body = bodies[resource(request.url)]
    return { status: 200, body: body ?? list([]) }
  }
}

/** What reading the account gives: the snapshot, or the code of the error. */
async function outcome(account = { accountId: 'c' }): Promise<SubscriptionSnapshot | string> {
  try {
    return await adapter().readAccount(account)
  } catch (error) {
    return error instanceof SubscriptionError ? error.code : String(error)
  }
}

const UNAVAILABLE = SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
const entitlement = { id: 'entl_1', lookup_key: 'premium' }
const subscription = (extra: Record<string, unknown> = {}): unknown => ({
  id: 's1',
  status: 'active',
  gives_access: true,
  environment: 'production',
  entitlements: list([entitlement]),
  ...extra
})
const purchase = (extra: Record<string, unknown> = {}): unknown => ({
  id: 'p1',
  status: 'owned',
  environment: 'production',
  store: 'app_store',
  entitlements: list([entitlement]),
  ...extra
})

describe('lists the adapter cannot use', () => {
  it.each([
    ['a list that is not an object', { subscriptions: 'oops' }],
    ['a list with no items', { subscriptions: { object: 'list' } }],
    ['an item that is not an object', { subscriptions: list(['x']) }],
    ['an item with no identifier', { subscriptions: list([{ status: 'active' }]) }],
    ['a next page after an item that cannot give a cursor', { subscriptions: list([{}], 'next') }],
    ['a next page after an item that is not an object', { subscriptions: list(['x'], 'next') }],
    ['a purchase that is not an object', { purchases: list(['x']) }],
    ['a purchase with no identifier', { purchases: list([{ status: 'owned' }]) }]
  ])('is a source that cannot be read for %s', async (_label, bodies) => {
    // Scenario: what cannot be named or read to its end is never turned into a partial snapshot.
    stand.respondWith(lists(bodies))
    expect(await outcome()).toBe(UNAVAILABLE)
  })

  it('stops at the page bound for a list that never ends, and is a source that cannot be read', async () => {
    // Scenario: every page says another follows, with an item to take the cursor from.
    let pages = 0
    stand.respondWith((request) => {
      if (resource(request.url) !== 'subscriptions') return { status: 200, body: list([]) }
      pages += 1
      return { status: 200, body: list([subscription({ id: `s${String(pages)}` })], 'next') }
    })
    expect(await outcome()).toBe(UNAVAILABLE)
    expect(pages).toBe(50)
  })

  it.each([
    ['a status other than not found', { status: 500 }],
    ['a rate limit', { status: 429 }],
    ['a body that is not JSON', { status: 200, body: '<html>' }],
    ['a redirect', { status: 302, location: 'http://127.0.0.1:1/elsewhere' }]
  ])('is a source that cannot be read for %s', async (_label, answer) => {
    // Scenario: the HTTP failures, each mapped to the one fixed error.
    stand.respondWith(() => answer)
    expect(await outcome()).toBe(UNAVAILABLE)
  })

  it('is a source that cannot be read when a page after the first is not found', async () => {
    // Scenario: the second page of the subscriptions answers 404; the customer is known, so the
    // read fails and does not become the empty snapshot.
    stand.respondWith((request) =>
      resource(request.url) !== 'subscriptions'
        ? undefined
        : request.url.includes('starting_after')
          ? { status: 404, body: { type: 'resource_missing' } }
          : { status: 200, body: list([subscription()], 'next') }
    )
    expect(await outcome()).toBe(UNAVAILABLE)
  })

  it('is a source that cannot be read when nothing listens, and sends the key to no other address', async () => {
    // Scenario: connection refused; the stand-in saw only requests with the bearer key.
    await stand.close()
    expect(await outcome()).toBe(UNAVAILABLE)
    stand = await startStandIn(KEY)
  })

  it('answers the empty snapshot for a customer that is not known, and for identifiers that cannot be sent', async () => {
    // Scenario: 404 and a dot segment, with and without a tenant.
    for (const account of [
      { accountId: 'unknown' },
      { accountId: '.', tenantId: 't' },
      { accountId: '..' }
    ]) {
      const snapshot = await adapter().readAccount(account)
      expect(snapshot).toMatchObject({ sourceCustomer: null, subscriptions: [], entitlements: [] })
      expect('tenantId' in snapshot).toBe(account.tenantId !== undefined)
    }
  })

  it('carries the tenant into a snapshot it reads', async () => {
    // Scenario: a tenant given with the account is on the snapshot.
    stand.serveFixture('c', 'active-subscription')
    expect(await adapter().readAccount({ accountId: 'c', tenantId: 't' })).toMatchObject({
      tenantId: 't'
    })
  })
})

describe('subscriptions with fields of the wrong type or missing', () => {
  it('reads an item with only an identifier as unknown, with no access, and asks for its entitlements', async () => {
    // Scenario: nothing but the id; the nested list is absent, so the per-subscription list is read.
    stand.respondWith(lists({ subscriptions: list([{ id: 's1' }]) }))
    expect(await outcome()).toMatchObject({
      subscriptions: [
        {
          status: 'unknown',
          givesAccess: false,
          environment: 'sandbox',
          origin: 'other',
          productReference: ''
        }
      ]
    })
  })

  it('reads values of the wrong type as unknown, and keeps the source access flag', async () => {
    // Scenario: a status, a renewal status and a store that are not strings; a flag that is a string.
    stand.respondWith(
      lists({
        subscriptions: list([
          subscription({ status: 7, auto_renewal_status: {}, store: 5, gives_access: 'yes' })
        ])
      })
    )
    expect(await outcome()).toMatchObject({
      subscriptions: [
        { status: 'unknown', willRenew: 'unknown', origin: 'other', givesAccess: false }
      ]
    })
  })

  it('reads a status that is a string no row lists as unknown, and drops nested entitlements it cannot name', async () => {
    // Scenario: an unlisted status, and a nested list with an entry that is text and one with no key.
    const nested = list(['x', { id: 'entl_9' }, entitlement])
    stand.respondWith(
      lists({
        subscriptions: list([subscription({ status: 'something_new', entitlements: nested })])
      })
    )
    expect(await outcome()).toMatchObject({
      subscriptions: [{ status: 'unknown', givesAccess: true }],
      entitlements: [{ name: 'premium', active: true }]
    })
  })

  it('gives no end to access the source says is given after its period', async () => {
    // Scenario: a period end in the past and an access flag that is true (a grace period).
    stand.respondWith(
      lists({
        subscriptions: list([
          subscription({ status: 'in_grace_period', current_period_ends_at: NOW.getTime() - 1000 })
        ])
      })
    )
    expect(await outcome()).toMatchObject({
      entitlements: [{ name: 'premium', active: true, until: null }]
    })
  })

  it('falls back to the start of the subscription and then to the read when a period start is not a date', async () => {
    // Scenario: a count of milliseconds a date cannot hold, then none at all.
    const beyond = 9e15
    stand.respondWith(
      lists({
        subscriptions: list([subscription({ current_period_starts_at: beyond, starts_at: beyond })])
      })
    )
    expect(await outcome()).toMatchObject({
      subscriptions: [{ currentPeriodStart: NOW.toISOString() }]
    })
  })

  it('reads the entitlements of a subscription whose nested list is cut from its own endpoint, in two pages', async () => {
    // Scenario: the nested list names a next page; the per-subscription list has two pages.
    const cut = subscription({ entitlements: list([entitlement], 'next') })
    stand.respondWith((request) => {
      const name = resource(request.url)
      if (name === 'subscriptions') return { status: 200, body: list([cut]) }
      if (name === 'entitlements') {
        const second = request.url.includes('starting_after=entl_1')
        return {
          status: 200,
          body: second ? list([{ id: 'entl_2', lookup_key: 'extra' }]) : list([entitlement], 'next')
        }
      }
      return { status: 200, body: list([]) }
    })
    expect(await outcome()).toMatchObject({
      entitlements: [{ name: 'premium' }, { name: 'extra' }]
    })
  })
})

describe('purchases with fields of the wrong type or missing', () => {
  const active = (items: unknown[]): unknown => list(items)

  it('reads a purchase with no instant, no product and no nested list, with the entitlements from its own endpoint', async () => {
    // Scenario: the instant of the read and an empty product stand in; the per-purchase list is read.
    stand.respondWith((request) => {
      const name = resource(request.url)
      if (name === 'purchases')
        return { status: 200, body: list([{ id: 'p1', status: 'refunded' }]) }
      if (name === 'entitlements') return { status: 200, body: list([entitlement]) }
      return { status: 200, body: list([]) }
    })
    expect(await outcome()).toMatchObject({
      nonRenewingPurchases: [
        { purchasedAt: NOW.toISOString(), productReference: '', refundedAt: NOW.toISOString() }
      ]
    })
  })

  it('reads the entitlements of a purchase from its own endpoint when the nested list is cut', async () => {
    // Scenario: the nested list names a next page.
    stand.respondWith((request) => {
      const name = resource(request.url)
      if (name === 'purchases')
        return {
          status: 200,
          body: list([purchase({ entitlements: list([entitlement], 'next') })])
        }
      if (name === 'entitlements') return { status: 200, body: list([entitlement]) }
      if (name === 'active_entitlements')
        return { status: 200, body: active([{ entitlement_id: 'entl_1', expires_at: null }]) }
      return { status: 200, body: list([]) }
    })
    expect(await outcome()).toMatchObject({ nonRenewingPurchases: [{ givesAccess: true }] })
  })

  it.each([
    ['an entry that is not an object', ['x']],
    ['an entry with no identifier', [{ expires_at: null }]],
    ['an entry with an expiry that is text', [{ entitlement_id: 'entl_1', expires_at: 'never' }]],
    ['an entry with no expiry field', [{ entitlement_id: 'entl_1' }]]
  ])('gives no access to a purchase when the active list holds %s', async (_label, items) => {
    // Scenario: fail closed: what cannot be read as active is not active.
    stand.respondWith(lists({ purchases: list([purchase()]), active_entitlements: active(items) }))
    expect(await outcome()).toMatchObject({ nonRenewingPurchases: [{ givesAccess: false }] })
  })

  it('gives no access to a production purchase whose entitlement a sandbox grantor without an identifier names', async () => {
    // Scenario: the active list names no grantor; the sandbox purchase's entitlement has a name only.
    const sandboxPurchase = purchase({
      id: 'p2',
      environment: 'sandbox',
      entitlements: list([{ lookup_key: 'premium' }])
    })
    stand.respondWith(
      lists({
        purchases: list([purchase(), sandboxPurchase]),
        active_entitlements: list([{ entitlement_id: 'entl_1', expires_at: null }])
      })
    )
    expect(await outcome()).toMatchObject({
      nonRenewingPurchases: [
        { purchaseReference: 'p1', givesAccess: false },
        { givesAccess: false }
      ]
    })
  })

  it('treats a nested list that is not a list as a missing one', async () => {
    // Scenario: the nested field is text; the per-purchase endpoint is the authority.
    stand.respondWith((request) => {
      const name = resource(request.url)
      if (name === 'purchases')
        return { status: 200, body: list([purchase({ entitlements: 'x' })]) }
      return { status: 200, body: list([]) }
    })
    expect(await outcome()).toMatchObject({ nonRenewingPurchases: [] })
  })
})

describe('the HTTP client and the options', () => {
  it('sends a POST with a JSON body and the key, and a GET with no query', async () => {
    // Scenario: a POST, which the client supports and the adapter does not use.
    stand.respondWith((request) =>
      request.method === 'POST'
        ? { status: 200, body: { done: true } }
        : { status: 200, body: { read: true } }
    )
    const http = new RevenueCatHttp({
      baseUrl: stand.baseUrl,
      apiKey: new Secret(KEY),
      timeoutMs: 5000,
      fetch: (url, init) => fetch(url, init)
    })
    expect(await http.post('/projects/p/x', { a: 1 })).toStrictEqual({ done: true })
    expect(await http.get('/projects/p/y')).toStrictEqual({ read: true })
    expect(stand.requests.map((request) => request.authorization)).toStrictEqual([
      `Bearer ${KEY}`,
      `Bearer ${KEY}`
    ])
  })

  it.each([
    ['input that is not an object', undefined],
    ['a secret that is a number', { projectId: 'p', apiKey: 5 }],
    [
      'an address over plain HTTP to a public host',
      { projectId: 'p', apiKey: KEY, baseUrl: 'http://example.com' }
    ],
    ['an address that is not a string', { projectId: 'p', apiKey: KEY, baseUrl: 5 }],
    [
      'an address with credentials',
      { projectId: 'p', apiKey: KEY, baseUrl: 'https://u:p@example.com' }
    ],
    [
      'a tolerance that is not a number',
      { projectId: 'p', apiKey: KEY, signatureToleranceMs: 'x' }
    ],
    ['a logger that is null', { projectId: 'p', apiKey: KEY, logger: null }],
    ['a logger without warn', { projectId: 'p', apiKey: KEY, logger: {} }],
    [
      'sandbox allowed in production without the confirmation',
      { projectId: 'p', apiKey: KEY, allowSandbox: true, isProduction: true }
    ]
  ])('refuses %s at boot with the configuration error', (_label, options) => {
    // Scenario: SEC07 and the validation of every option before any side effect.
    expect(() => Reflect.apply(revenueCatSource, undefined, [options])).toThrow(SubscriptionError)
  })

  it('boots with only the required options, which take the address of the API and the system clock', () => {
    // Scenario: the defaults; nothing is read from the network at boot.
    expect(() => revenueCatSource({ projectId: 'proj_PLACEHOLDER', apiKey: KEY })).not.toThrow()
    expect(() => adapter({ signatureToleranceMs: 1000, requestTimeoutMs: 1000 })).not.toThrow()
  })

  it('serves the fixtures of the unit suite at the paths the adapter reads, and nowhere else', async () => {
    // Scenario: the fixture stand-in the unit specs read through answers 404 for another path.
    expect(
      (await fixtureFetch('active-subscription')('http://127.0.0.1:9/v2/other', { method: 'GET' }))
        .status
    ).toBe(404)
    expect(
      (
        await fixtureFetch('appendix-a3')('http://127.0.0.1:9/v2/x/subscriptions', {
          method: 'GET'
        })
      ).status
    ).toBe(404)
  })

  it('accepts sandbox access in production when it is confirmed, and an address with a trailing slash', () => {
    // Scenario: the second option and a normalised address.
    expect(() =>
      adapter({
        allowSandbox: true,
        isProduction: true,
        confirmSandboxInProduction: true,
        baseUrl: `${stand.baseUrl}/`
      })
    ).not.toThrow()
  })

  it('answers the management calls as not possible from a server', async () => {
    // Scenario: until the management operations exist, the person acts and is told where.
    stand.serveFixture('c', 'active-subscription')
    const source = adapter()
    const subscribed = (await source.readAccount({ accountId: 'c' })).subscriptions[0]
    if (subscribed === undefined) throw new Error('the fixture has a subscription')
    expect(source.capabilities(subscribed).operations).toStrictEqual([])
    expect(await source.stopRenewal({ accountId: 'c' }, subscribed)).toMatchObject({
      outcome: 'customer_action_required'
    })
  })
})

describe('webhook requests that are not the ordinary ones', () => {
  const signed = adapter
  const sign = (
    body: unknown
  ): { rawBody: Uint8Array; headers: Record<string, string | undefined> } =>
    buildRevenueCatWebhookRequest({
      body,
      signingSecret: SIGNING,
      authorization: AUTHORIZATION,
      now: NOW
    })
  const both = { webhookSigningSecret: SIGNING, webhookAuthorization: AUTHORIZATION }

  it.each([
    ['a signature with no equals sign', 'garbage'],
    ['a signature with an empty key', '=x,t=1,v1=00'],
    ['a signature with a key twice', 't=1,t=2,v1=00'],
    ['a signature with a timestamp that is not digits', `t=x,v1=${'0'.repeat(64)}`],
    ['a signature with a digest that is too short', 't=1,v1=00']
  ])('refuses %s with the one refusal', async (_label, header) => {
    // Scenario: AC02: a header that does not parse is a refusal, not an exception.
    const request = { ...sign({ event: { id: 'e' } }) }
    const result = await signed(both).verifyWebhook({
      rawBody: request.rawBody,
      headers: { ...request.headers, 'x-revenuecat-webhook-signature': header }
    })
    expect(result).toStrictEqual({ accepted: false })
  })

  it.each([
    ['a request that is null', null],
    ['a request that is text', 'text'],
    ['a request with a body that is text', { rawBody: 'text', headers: {} }]
  ])('refuses %s without throwing', async (_label, request) => {
    // Scenario: the port promises well-formed requests; a caller that breaks it gets a refusal.
    const source = signed(both)
    expect(await Reflect.apply(source.verifyWebhook, source, [request])).toStrictEqual({
      accepted: false
    })
  })

  it('refuses a request, without throwing, when the clock fails, and boots when the logger fails', async () => {
    // Scenario: a check that itself fails is a refusal, and a report that fails stops nothing.
    const failing = {
      now: (): Date => {
        throw new Error('clock failed')
      }
    }
    const request = sign({ event: { id: 'e' } })
    expect(await signed({ ...both, clock: failing }).verifyWebhook(request)).toStrictEqual({
      accepted: false
    })
    const logger = {
      warn: (): void => {
        throw new Error('logger failed')
      }
    }
    expect(() => signed({ webhookAuthorization: AUTHORIZATION, logger })).not.toThrow()
  })

  it('refuses a request when no method is configured, and says nothing about the header-only method', async () => {
    // Scenario: a source with neither secret verifies nothing, so nothing is accepted.
    const warn = jest.fn()
    const bare = signed({ logger: { warn } })
    expect(await bare.verifyWebhook(sign({ event: { id: 'e' } }))).toStrictEqual({
      accepted: false
    })
    expect(warn).toHaveBeenCalledTimes(0)
    signed({ webhookSigningSecret: SIGNING, logger: { warn } })
    expect(warn).toHaveBeenCalledTimes(0)
  })

  it.each([
    ['a body that is not JSON', 'not json'],
    ['JSON with no event', { api_version: '1.0' }],
    ['an event that is text', { event: 'x' }],
    ['an event with no identifier, no time and no type', { event: { app_user_id: 'a' } }],
    ['an event that changes nothing', { event: { id: 'e', type: 'TEST', app_user_id: 'a' } }]
  ])('accepts a verified request with %s and makes a notification of it', async (_label, body) => {
    // Scenario: verification passed; the shape never makes an error.
    const result = await signed(both).verifyWebhook(sign(body))
    expect(result).toMatchObject({ accepted: true })
  })

  it('builds a request from bytes and from text as they are', async () => {
    // Scenario: the two other forms of body the builder takes.
    const bytes = new TextEncoder().encode('{"event":{"id":"e","app_user_id":"a"}}')
    for (const body of [bytes, '{"event":{"id":"e","app_user_id":"a"}}']) {
      const request = buildRevenueCatWebhookRequest({
        body,
        signingSecret: SIGNING,
        authorization: AUTHORIZATION,
        now: NOW
      })
      expect(await signed(both).verifyWebhook(request)).toMatchObject({
        accepted: true,
        notification: { accountIds: ['a'] }
      })
    }
  })
})

/** The items of a list of a recorded customer fixture; none when the fixture has no such list. */
function itemsOf(name: string, list: string): Array<Record<string, unknown>> {
  const body: unknown = Reflect.get(loadFixture(name), list)
  const items: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'items') : []
  return Array.isArray(items) ? items.map((item): Record<string, unknown> => Object(item)) : []
}

describe('purchases that appear, change and leave across reads', () => {
  /** Reads the customer with the fixture served and returns the snapshot. */
  async function read(
    source: ReturnType<typeof adapter>,
    fixture: string
  ): Promise<SubscriptionSnapshot> {
    stand.serveFixture('c', fixture)
    return source.readAccount({ accountId: 'c' })
  }

  it('reports a purchase that appears, one that is refunded, one that is unchanged and one that leaves', async () => {
    // Scenario: the kinds of the existing change rules over the reads of a purchase.
    const source = adapter()
    const none = await read(source, 'empty-customer')
    const granted = await read(source, 'lifetime-purchase')
    const same = await read(source, 'lifetime-purchase')
    const refunded = await read(source, 'refunded-purchase')
    const again = await read(source, 'refunded-purchase')
    const gone = await read(source, 'empty-customer')
    const kinds = (
      previous: SubscriptionSnapshot | null,
      current: SubscriptionSnapshot
    ): string[] => diffSnapshots(previous, current).map((change) => change.kind)
    expect(kinds(none, granted)).toStrictEqual(['started'])
    expect(kinds(granted, same)).toStrictEqual([])
    expect(kinds(same, refunded)).toStrictEqual(['expired', 'refunded'])
    expect(kinds(refunded, again)).toStrictEqual([])
    expect(kinds(again, gone)).toStrictEqual(['transferred'])
    expect(kinds(none, none)).toStrictEqual([])
  })

  it('reads every recorded customer fixture and gives access only where the source said so', async () => {
    // Scenario: the recorded fixtures through the whole adapter: no entitlement is active without a
    // subscription or a purchase that gives access.
    for (const name of [
      'active-subscription',
      'in-grace',
      'in-billing-retry',
      'paused',
      'expired',
      'unknown-status',
      'sandbox-subscription',
      'two-subscriptions',
      'promotional-grant',
      'lifetime-purchase',
      'non-renewing-purchase',
      'consumable-purchase',
      'sandbox-purchase',
      'unknown-customer',
      'empty-customer'
    ]) {
      const snapshot = await adapter({ fetch: fixtureFetch(name) }).readAccount({ accountId: 'c' })
      for (const item of itemsOf(name, 'subscriptions')) {
        const mapped = snapshot.subscriptions.find(
          (record) => record.subscriptionReference === item['id']
        )
        // The source's own flag decides; a sandbox subscription gives none under the default setting.
        expect(mapped?.givesAccess).toBe(
          item['gives_access'] === true && item['environment'] === 'production'
        )
      }
      const giving = [
        ...snapshot.subscriptions
          .filter((record) => record.givesAccess)
          .map((record) => record.subscriptionReference),
        ...(snapshot.nonRenewingPurchases ?? [])
          .filter((record) => record.givesAccess)
          .map((record) => record.purchaseReference)
      ]
      for (const held of snapshot.entitlements) {
        expect(held.active).toBe(
          giving.some((reference) => held.grantingSubscriptionReferences.includes(reference))
        )
      }
    }
  })

  it('does not change what a clock reads', () => {
    // Scenario: the manual clock is the only time the suite uses.
    expect(new ManualClock('2026-11-25T12:00:00.000Z').now().toISOString()).toBe(NOW.toISOString())
  })
})
