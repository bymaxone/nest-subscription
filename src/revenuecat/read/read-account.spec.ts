/**
 * @fileoverview Pins the read of one customer: every recorded fixture against the snapshot it
 * must yield, field by field, the sandbox filter, the unknown customer, the pagination and the
 * failures, all with `fetch` stubbed.
 * @layer revenuecat
 */
import { Secret, SubscriptionError } from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type EntitlementState,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { RevenueCatHttp } from '../revenuecat-http'
import type { RevenueCatFetch } from '../revenuecat.options'
import { fixtureFetch, loadFixture, type FetchCall } from '../revenuecat.fixture'
import { MAX_PAGES, PAGE_LIMIT } from './list-all'
import { readRevenueCatAccount } from './read-account'
import type { RevenueCatReadContext } from './read-context'

const NOW = '2026-11-25T12:00:00.000Z'
const PERIOD_START = '2026-11-18T11:06:40.000Z'
const PERIOD_END = '2026-12-18T13:20:00.000Z'
const LAPSED_END = '2026-11-17T07:20:00.000Z'
const APPLE_MANAGEMENT = 'https://apps.apple.com/account/subscriptions'

function contextFor(
  fetchStub: RevenueCatFetch,
  overrides: Partial<RevenueCatReadContext> = {}
): RevenueCatReadContext {
  return {
    http: new RevenueCatHttp({
      baseUrl: 'http://127.0.0.1:9/v2',
      apiKey: new Secret('sentinel-api-key-7f3a'),
      timeoutMs: 1_000,
      fetch: fetchStub
    }),
    projectId: 'proj_PLACEHOLDER',
    sourceName: 'revenuecat',
    allowSandbox: false,
    clock: { now: () => new Date(NOW) },
    ...overrides
  }
}

/** The record of a production App Store subscription that renews, with `overrides` applied. */
function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    subscriptionReference: 'sub_PLACEHOLDER_1',
    status: 'active',
    givesAccess: true,
    willRenew: 'yes',
    origin: 'app_store',
    environment: 'production',
    productReference: 'product_PLACEHOLDER_monthly',
    billingInterval: '',
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    accessUntil: PERIOD_END,
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: APPLE_MANAGEMENT,
    ...overrides
  }
}

function entitlement(overrides: Partial<EntitlementState> = {}): EntitlementState {
  return {
    name: 'premium',
    active: true,
    until: PERIOD_END,
    grantingSubscriptionReference: 'sub_PLACEHOLDER_1',
    grantingSubscriptionReferences: ['sub_PLACEHOLDER_1'],
    ...overrides
  }
}

const NOT_GRANTING = {
  active: false,
  grantingSubscriptionReference: null,
  grantingSubscriptionReferences: []
} as const

interface Row {
  readonly fixture: string
  readonly customer: string
  readonly records: readonly SubscriptionRecord[]
  readonly entitlements: readonly EntitlementState[]
}

const ROWS: readonly Row[] = [
  {
    fixture: 'active-subscription',
    customer: 'customer_PLACEHOLDER_active',
    records: [record()],
    entitlements: [entitlement()]
  },
  {
    fixture: 'trialing-subscription',
    customer: 'customer_PLACEHOLDER_trial',
    records: [record({ status: 'trialing' })],
    entitlements: [entitlement()]
  },
  {
    fixture: 'cancelled-active-subscription',
    customer: 'customer_PLACEHOLDER_cancelled',
    records: [record({ willRenew: 'no' })],
    entitlements: [entitlement()]
  },
  {
    fixture: 'scheduled-pause',
    customer: 'customer_PLACEHOLDER_scheduled_pause',
    records: [
      record({
        willRenew: 'pauses',
        origin: 'play_store',
        managementReference: 'https://play.google.com/store/account/subscriptions'
      })
    ],
    entitlements: [entitlement()]
  },
  {
    fixture: 'in-grace',
    customer: 'customer_PLACEHOLDER_grace',
    records: [record({ status: 'in_grace', currentPeriodEnd: LAPSED_END, accessUntil: null })],
    entitlements: [entitlement({ until: null })]
  },
  {
    fixture: 'in-billing-retry',
    customer: 'customer_PLACEHOLDER_retry',
    records: [
      record({
        status: 'on_hold',
        givesAccess: false,
        currentPeriodEnd: LAPSED_END,
        accessUntil: LAPSED_END
      })
    ],
    entitlements: [entitlement({ ...NOT_GRANTING, until: LAPSED_END })]
  },
  {
    fixture: 'paused',
    customer: 'customer_PLACEHOLDER_paused',
    records: [
      record({
        status: 'paused',
        givesAccess: false,
        willRenew: 'no',
        origin: 'play_store',
        currentPeriodEnd: PERIOD_START,
        accessUntil: null
      })
    ],
    entitlements: [entitlement({ ...NOT_GRANTING, until: null })]
  },
  {
    fixture: 'expired',
    customer: 'customer_PLACEHOLDER_expired',
    records: [
      record({
        status: 'expired',
        givesAccess: false,
        willRenew: 'no',
        currentPeriodEnd: '2026-11-06T21:20:00.000Z',
        accessUntil: '2026-11-06T21:20:00.000Z'
      })
    ],
    entitlements: [entitlement({ ...NOT_GRANTING, until: '2026-11-06T21:20:00.000Z' })]
  },
  {
    fixture: 'refunded-subscription',
    customer: 'customer_PLACEHOLDER_refunded',
    records: [
      record({
        status: 'expired',
        givesAccess: false,
        willRenew: 'no',
        accessUntil: '2026-11-19T14:53:20.000Z',
        refundedAt: '2026-11-19T14:53:20.000Z'
      })
    ],
    entitlements: [entitlement({ ...NOT_GRANTING, until: '2026-11-19T14:53:20.000Z' })]
  },
  {
    fixture: 'unknown-status',
    customer: 'customer_PLACEHOLDER_unknown_status',
    records: [record({ status: 'unknown', givesAccess: false, willRenew: 'unknown' })],
    entitlements: [entitlement({ ...NOT_GRANTING })]
  },
  {
    fixture: 'promotional-grant',
    customer: 'customer_PLACEHOLDER_a',
    records: [
      record({
        willRenew: 'no',
        origin: 'promotional',
        productReference: '',
        currentPeriodStart: '2026-11-25T22:39:55.668Z',
        currentPeriodEnd: '2027-01-01T00:00:00.000Z',
        accessUntil: '2027-01-01T00:00:00.000Z',
        managementReference: null
      })
    ],
    entitlements: [entitlement({ until: '2027-01-01T00:00:00.000Z' })]
  }
]

async function snapshotOf(
  fixture: string,
  customer: string,
  calls?: FetchCall[]
): Promise<SubscriptionSnapshot> {
  return readRevenueCatAccount(contextFor(fixtureFetch(fixture, calls)), { accountId: customer })
}

describe('readRevenueCatAccount of a recorded fixture', () => {
  it.each(ROWS)(
    'yields the expected snapshot for $fixture',
    async ({ fixture, customer, records, entitlements }) => {
      // Scenario: one fixture per state; the whole snapshot is compared, field by field.
      expect(await snapshotOf(fixture, customer)).toStrictEqual({
        accountId: customer,
        entitlements,
        subscriptions: records,
        nonRenewingPurchases: [],
        source: 'revenuecat',
        sourceCustomer: { id: customer },
        fetchedAt: NOW,
        sourceUpdatedAt: null
      })
    }
  )

  it('keeps a cancelled subscription active with will renew no, and a scheduled pause with access', async () => {
    // Scenario: a cancellation is not an expiry and a scheduled pause is not a pause (FR14).
    const cancelled = await snapshotOf('cancelled-active-subscription', 'c')
    expect(cancelled.subscriptions[0]).toMatchObject({
      status: 'active',
      willRenew: 'no',
      givesAccess: true
    })
    const scheduled = await snapshotOf('scheduled-pause', 'c')
    expect(scheduled.subscriptions[0]).toMatchObject({
      status: 'active',
      willRenew: 'pauses',
      givesAccess: true
    })
    expect(scheduled.entitlements[0]?.active).toBe(true)
  })

  it('sets refunded-at and removes access for a refund of the current period', async () => {
    // Scenario: the subscription ended before its paid period did, with no access (AC05 reading).
    const refunded = (await snapshotOf('refunded-subscription', 'c')).subscriptions[0]
    expect(refunded?.refundedAt).toBe('2026-11-19T14:53:20.000Z')
    expect(refunded?.givesAccess).toBe(false)
  })

  it('reads two subscriptions of two entitlements into two active entitlements', async () => {
    // Scenario: one customer holds two grants; each entitlement names its own grantor.
    const snapshot = await snapshotOf('two-subscriptions', 'customer_PLACEHOLDER_b')
    expect(snapshot.subscriptions.map((s) => s.subscriptionReference)).toStrictEqual([
      'sub_PLACEHOLDER_1',
      'sub_PLACEHOLDER_2'
    ])
    expect(
      snapshot.entitlements.map((e) => [e.name, e.active, e.grantingSubscriptionReference])
    ).toStrictEqual([
      ['premium', true, 'sub_PLACEHOLDER_1'],
      ['extra', true, 'sub_PLACEHOLDER_2']
    ])
  })

  it('yields a snapshot with the customer and nothing else for a customer with no subscription', async () => {
    // Scenario: RevenueCat knows the customer and lists nothing; the source customer is recorded.
    expect(await snapshotOf('empty-customer', 'customer_PLACEHOLDER_empty')).toStrictEqual({
      accountId: 'customer_PLACEHOLDER_empty',
      entitlements: [],
      subscriptions: [],
      nonRenewingPurchases: [],
      source: 'revenuecat',
      sourceCustomer: { id: 'customer_PLACEHOLDER_empty' },
      fetchedAt: NOW,
      sourceUpdatedAt: null
    })
  })

  it('yields the empty snapshot, not an error, for a customer RevenueCat does not know', async () => {
    // Scenario: the API answers 404; FR04 says no subscription is a value.
    expect(await snapshotOf('unknown-customer', 'customer_PLACEHOLDER_unknown')).toStrictEqual({
      accountId: 'customer_PLACEHOLDER_unknown',
      entitlements: [],
      subscriptions: [],
      source: 'revenuecat',
      sourceCustomer: null,
      fetchedAt: NOW,
      sourceUpdatedAt: null
    })
  })

  it('carries the tenant into the snapshot and into the empty snapshot, and only when given', async () => {
    // Scenario: a multi-tenant host; the tenant key is absent for a single-tenant one.
    const known = await readRevenueCatAccount(contextFor(fixtureFetch('active-subscription')), {
      accountId: 'a',
      tenantId: 't1'
    })
    const unknown = await readRevenueCatAccount(contextFor(fixtureFetch('unknown-customer')), {
      accountId: 'a',
      tenantId: 't1'
    })
    expect([known.tenantId, unknown.tenantId]).toStrictEqual(['t1', 't1'])
    expect('tenantId' in (await snapshotOf('active-subscription', 'a'))).toBe(false)
    expect('tenantId' in (await snapshotOf('unknown-customer', 'a'))).toBe(false)
  })
})

describe('readRevenueCatAccount and the sandbox', () => {
  it('gives no access and grants no entitlement for a sandbox subscription RevenueCat reports as active', async () => {
    // Scenario: AC06 at unit level: the fixture has gives_access true and an active entitlement,
    // as RevenueCat reports sandbox purchases by default; the default configuration removes both.
    const snapshot = await snapshotOf('sandbox-subscription', 'customer_PLACEHOLDER_sandbox')
    expect(loadFixture('sandbox-subscription')).toMatchObject({
      subscriptions: { items: [{ gives_access: true, environment: 'sandbox' }] }
    })
    expect(snapshot.subscriptions).toStrictEqual([
      record({
        environment: 'sandbox',
        givesAccess: false,
        origin: 'other',
        productReference: 'product_PLACEHOLDER_test_monthly',
        managementReference: null
      })
    ])
    expect(snapshot.entitlements).toStrictEqual([])
  })

  it('grants the entitlement of a sandbox subscription when sandbox access is enabled', async () => {
    // Scenario: the host turned sandbox access on; the flag of the source stands.
    const snapshot = await readRevenueCatAccount(
      contextFor(fixtureFetch('sandbox-subscription'), { allowSandbox: true }),
      { accountId: 'c' }
    )
    expect(snapshot.subscriptions[0]?.givesAccess).toBe(true)
    expect(snapshot.entitlements).toStrictEqual([entitlement()])
  })
})

/** A subscriptions list whose only item has a nested entitlement list that is cut short. */
function cutSubscriptions(): unknown {
  return {
    object: 'list',
    items: [
      {
        id: 'sub_PLACEHOLDER_1',
        status: 'active',
        gives_access: true,
        environment: 'production',
        entitlements: {
          object: 'list',
          items: [{ id: 'entl_0', lookup_key: 'premium' }],
          next_page: 'https://elsewhere.invalid/next'
        }
      }
    ],
    next_page: null
  }
}

describe('readRevenueCatAccount requests', () => {
  it('asks for the customer subscriptions with an encoded identifier, a page size and the key', async () => {
    // Scenario: the identifier is free text; nothing in it can change the path.
    const calls: FetchCall[] = []
    await readRevenueCatAccount(contextFor(fixtureFetch('active-subscription', calls)), {
      accountId: '$RCAnonymousID:a/b?c'
    })
    const customer =
      'http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/customers/%24RCAnonymousID%3Aa%2Fb%3Fc'
    expect(calls.map((call) => call.url)).toStrictEqual([
      `${customer}/subscriptions?limit=${PAGE_LIMIT}`,
      `${customer}/purchases?limit=${PAGE_LIMIT}`
    ])
    expect(calls[0]?.init.method).toBe('GET')
  })

  it('reads the purchases but not the active entitlements for a customer with no purchase', async () => {
    // Scenario: the active entitlements are looked up only when some purchase grants something.
    const calls: FetchCall[] = []
    await snapshotOf('two-subscriptions', 'c', calls)
    expect(calls.map((call) => new URL(call.url).pathname.split('/').at(-1))).toStrictEqual([
      'subscriptions',
      'purchases'
    ])
  })

  it('reads the entitlements of a subscription from its own endpoint when the nested list is cut', async () => {
    // Scenario: the nested list has a next page; the per-subscription list is read to its end and
    // replaces it, with the cursor built from the last item.
    const calls: string[] = []
    const cut = cutSubscriptions()
    const stub: RevenueCatFetch = (url) => {
      calls.push(url)
      if (new URL(url).pathname.endsWith('/customers/c/subscriptions')) {
        return Promise.resolve(new Response(JSON.stringify(cut)))
      }
      if (new URL(url).pathname.endsWith('/customers/c/purchases')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], next_page: null })))
      }
      const second = new URL(url).searchParams.get('starting_after') === 'entl_1'
      return Promise.resolve(
        new Response(
          JSON.stringify(
            second
              ? { object: 'list', items: [{ id: 'entl_2', lookup_key: 'extra' }], next_page: null }
              : {
                  object: 'list',
                  items: [{ id: 'entl_1', lookup_key: 'premium' }],
                  next_page: 'https://elsewhere.invalid/p2'
                }
          )
        )
      )
    }
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(snapshot.entitlements.map((e) => e.name)).toStrictEqual(['premium', 'extra'])
    expect(calls).toStrictEqual([
      `http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/customers/c/subscriptions?limit=${PAGE_LIMIT}`,
      `http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/subscriptions/sub_PLACEHOLDER_1/entitlements?limit=${PAGE_LIMIT}`,
      `http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/subscriptions/sub_PLACEHOLDER_1/entitlements?limit=${PAGE_LIMIT}&starting_after=entl_1`,
      `http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/customers/c/purchases?limit=${PAGE_LIMIT}`
    ])
    expect(calls.some((url) => url.includes('elsewhere.invalid'))).toBe(false)
  })

  it('reads every page of a long subscription list, following the last id and never the next-page address', async () => {
    // Scenario: two pages of subscriptions; the second request carries the id of the last item.
    const item = (id: string): unknown => ({
      id,
      status: 'active',
      gives_access: true,
      entitlements: { object: 'list', items: [], next_page: null }
    })
    const calls: string[] = []
    const stub: RevenueCatFetch = (url) => {
      calls.push(url)
      const after = new URL(url).searchParams.get('starting_after')
      return Promise.resolve(
        new Response(
          JSON.stringify(
            after === null
              ? {
                  object: 'list',
                  items: [item('s1'), item('s2')],
                  next_page: 'https://elsewhere.invalid/p2'
                }
              : { object: 'list', items: [item('s3')], next_page: null }
          )
        )
      )
    }
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(snapshot.subscriptions.map((s) => s.subscriptionReference)).toStrictEqual([
      's1',
      's2',
      's3'
    ])
    expect(new URL(calls[1] ?? '').searchParams.get('starting_after')).toBe('s2')
    expect(calls.every((url) => url.startsWith('http://127.0.0.1:9/v2/'))).toBe(true)
  })
})

describe('readRevenueCatAccount with a response that is not what the API documents', () => {
  /** The code of the error a read rejects with. */
  async function codeOf(read: Promise<unknown>): Promise<string> {
    try {
      await read
    } catch (error) {
      if (error instanceof SubscriptionError) return error.code
      throw error
    }
    return 'resolved'
  }

  const json =
    (body: unknown): RevenueCatFetch =>
    () =>
      Promise.resolve(new Response(JSON.stringify(body)))
  const list = (items: unknown[], next: string | null = null): unknown => ({
    object: 'list',
    items,
    next_page: next
  })

  it.each([
    ['a response that is not a list', 'oops'],
    ['a list with no items', { object: 'list' }],
    ['an item that is not an object', list(['x'])],
    ['an item with no id', list([{ status: 'active' }])],
    ['an item with an empty id', list([{ id: '' }])],
    ['a next page after an item that is not an object', list(['x'], 'next')],
    [
      'a next page after an item with no id',
      list([{ id: 's1', entitlements: list([]) }, {}], 'next')
    ]
  ])('rejects with the source-unavailable code for %s', async (_label, body) => {
    // Scenario: a subscription that cannot be named cannot be trusted, and neither can a list that
    // cannot be read to its end; the fail policy decides, not a partial snapshot.
    expect(await codeOf(readRevenueCatAccount(contextFor(json(body)), { accountId: 'c' }))).toBe(
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
  })

  it('stops at once, with one request, when a next page cannot be asked for', async () => {
    // Scenario: the last item has no id to use as the cursor, so the read fails without asking again.
    let requests = 0
    const stub: RevenueCatFetch = () => {
      requests += 1
      return Promise.resolve(
        new Response(JSON.stringify(list([{ id: 's1', entitlements: list([]) }, {}], 'next')))
      )
    }
    expect(await codeOf(readRevenueCatAccount(contextFor(stub), { accountId: 'c' }))).toBe(
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
    expect(requests).toBe(1)
  })

  it('rejects when a list never ends, after the page bound', async () => {
    // Scenario: every page says another follows; the read stops at the bound, and fails.
    let requests = 0
    const stub: RevenueCatFetch = () => {
      requests += 1
      return Promise.resolve(
        new Response(
          JSON.stringify(list([{ id: `s${String(requests)}`, entitlements: list([]) }], 'next'))
        )
      )
    }
    expect(await codeOf(readRevenueCatAccount(contextFor(stub), { accountId: 'c' }))).toBe(
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
    expect(requests).toBe(MAX_PAGES)
  })

  it('yields unknown status, the flag as given and no entitlement for an item with only an id', async () => {
    // Scenario: every field but the id is missing; nothing is invented and nothing grants access.
    const snapshot = await readRevenueCatAccount(contextFor(json(list([{ id: 's1' }]))), {
      accountId: 'c'
    })
    expect(snapshot.subscriptions).toStrictEqual([
      record({
        subscriptionReference: 's1',
        status: 'unknown',
        givesAccess: false,
        willRenew: 'unknown',
        origin: 'other',
        environment: 'sandbox',
        productReference: '',
        currentPeriodStart: NOW,
        currentPeriodEnd: NOW,
        accessUntil: null,
        managementReference: null
      })
    ])
    expect(snapshot.entitlements).toStrictEqual([])
  })

  it('passes the access flag through for a status it does not know', async () => {
    // Scenario: an unlisted status with gives_access true is `unknown` and still gives access.
    const body = list([
      {
        id: 's1',
        status: 'something_new',
        gives_access: true,
        environment: 'production',
        entitlements: list([{ lookup_key: 'premium' }])
      }
    ])
    const snapshot = await readRevenueCatAccount(contextFor(json(body)), { accountId: 'c' })
    expect(snapshot.subscriptions[0]).toMatchObject({ status: 'unknown', givesAccess: true })
    expect(snapshot.entitlements[0]).toMatchObject({ name: 'premium', active: true })
  })

  it('treats a missing or unknown environment as sandbox, so it grants nothing by default', async () => {
    // Scenario: SEC07: only the exact value `production` is production.
    for (const environment of [undefined, '', 'PRODUCTION', 'staging', 7]) {
      const body = list([
        {
          id: 's1',
          status: 'active',
          gives_access: true,
          environment,
          entitlements: list([{ lookup_key: 'premium' }])
        }
      ])
      const snapshot = await readRevenueCatAccount(contextFor(json(body)), { accountId: 'c' })
      expect(snapshot.subscriptions[0]).toMatchObject({
        environment: 'sandbox',
        givesAccess: false
      })
      expect(snapshot.entitlements).toStrictEqual([])
    }
  })

  it('reads the entitlements of a subscription with no nested list from its own endpoint', async () => {
    // Scenario: the nested list is absent; the per-subscription endpoint is the authority.
    const stub: RevenueCatFetch = (url) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('/subscriptions/s1/entitlements')
              ? list([{ id: 'e1', lookup_key: 'premium' }])
              : list([
                  { id: 's1', status: 'active', gives_access: true, environment: 'production' }
                ])
          )
        )
      )
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(snapshot.entitlements.map((e) => e.name)).toStrictEqual(['premium'])
  })

  describe('a 404 after the first request of the read', () => {
    const entitlement = { id: 'entl_1', lookup_key: 'premium' }
    const nested = list([entitlement])

    /** The requests of a complete read, each named, with the body it is answered with. */
    function routes(url: URL): Array<readonly [string, unknown]> {
      const last = url.pathname.split('/').at(-1) ?? ''
      const after = url.searchParams.get('starting_after')
      const owner = url.pathname.includes('/customers/')
      if (owner && last === 'subscriptions' && after === null) {
        return [['subscriptions-first-page', list([{ id: 's1', gives_access: true }], 'next')]]
      }
      if (owner && last === 'subscriptions') {
        return [['subscriptions-second-page', list([{ id: 's2', entitlements: nested }])]]
      }
      if (last === 'entitlements' && url.pathname.includes('/subscriptions/')) {
        return [['subscription-entitlements', nested]]
      }
      if (last === 'entitlements') return [['purchase-entitlements', nested]]
      if (last === 'purchases') return [['purchases', list([{ id: 'p1', status: 'owned' }])]]
      return [['active-entitlements', list([{ entitlement_id: 'entl_1', expires_at: null }])]]
    }

    /** A `fetch` that answers 404 to the one request named and serves the rest. */
    function missingOn(name: string | null): RevenueCatFetch {
      return (url) => {
        const [[request, body] = ['', {}]] = routes(new URL(url))
        return Promise.resolve(
          request === name
            ? new Response('{}', { status: 404 })
            : new Response(JSON.stringify(body))
        )
      }
    }

    it('reads the whole customer when no request is missing', async () => {
      // Scenario: the control for the table below: every request of the read is answered.
      const snapshot = await readRevenueCatAccount(contextFor(missingOn(null)), { accountId: 'c' })
      expect(snapshot.subscriptions.map((record) => record.subscriptionReference)).toStrictEqual([
        's1',
        's2'
      ])
      expect(snapshot.nonRenewingPurchases).toHaveLength(1)
    })

    it('yields the empty snapshot when the first request is the one that is missing', async () => {
      // Scenario: the customer is unknown; only the first page of the subscriptions decides it.
      const snapshot = await readRevenueCatAccount(
        contextFor(missingOn('subscriptions-first-page')),
        {
          accountId: 'c'
        }
      )
      expect(snapshot).toMatchObject({ sourceCustomer: null, subscriptions: [], entitlements: [] })
    })

    it.each([
      'subscriptions-second-page',
      'subscription-entitlements',
      'purchases',
      'purchase-entitlements',
      'active-entitlements'
    ])('rejects with the source-unavailable code when the request %s is missing', async (name) => {
      // Scenario: a resource removed between two requests of one read: the read cannot be
      // completed, so the stored snapshot of a customer the source knows stays as it is.
      expect(
        await codeOf(readRevenueCatAccount(contextFor(missingOn(name)), { accountId: 'c' }))
      ).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    })

    it('rejects with the source-unavailable code for a subscription whose identifier cannot be sent', async () => {
      // Scenario: a dot segment as a subscription identifier is refused after the first request.
      const stub: RevenueCatFetch = () =>
        Promise.resolve(new Response(JSON.stringify(list([{ id: '..' }]))))
      expect(await codeOf(readRevenueCatAccount(contextFor(stub), { accountId: 'c' }))).toBe(
        SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
      )
    })

    it('reads the customer on a retry after a read that failed on a missing request', async () => {
      // Scenario: a 404 then a 200 for the same request: the failure left nothing behind.
      let calls = 0
      const flaky: RevenueCatFetch = (url, init) => {
        calls += 1
        return missingOn(calls <= 4 ? 'purchases' : null)(url, init)
      }
      const context = contextFor(flaky)
      expect(await codeOf(readRevenueCatAccount(context, { accountId: 'c' }))).toBe(
        SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
      )
      expect(
        (await readRevenueCatAccount(context, { accountId: 'c' })).sourceCustomer
      ).toStrictEqual({ id: 'c' })
    })
  })

  it.each(['.', '..'])(
    'yields the empty snapshot for the identifier %j, which cannot be sent',
    async (accountId) => {
      // Scenario: a path step as an identifier is an account RevenueCat cannot have; no request is made.
      const calls: FetchCall[] = []
      const snapshot = await readRevenueCatAccount(
        contextFor(fixtureFetch('active-subscription', calls)),
        { accountId }
      )
      expect(snapshot.sourceCustomer).toBeNull()
      expect(calls).toHaveLength(0)
    }
  )

  it('rejects with the source-unavailable code when RevenueCat cannot be reached, with no identifier in the error', async () => {
    // Scenario: a network failure surfaces as the library's error, whose message holds nothing.
    const stub: RevenueCatFetch = () => Promise.reject(new TypeError('sentinel-account-identifier'))
    const error = await readRevenueCatAccount(contextFor(stub), {
      accountId: 'sentinel-account-identifier'
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SubscriptionError)
    expect(JSON.stringify(error)).not.toContain('sentinel')
    expect(String(error)).not.toContain('sentinel')
  })
})
