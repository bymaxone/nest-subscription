/**
 * @fileoverview Pins the read of non-renewing purchases (D31): a recorded purchase that grants an
 * entitlement gives it with the end the source reports, a lifetime grant has none, a consumable
 * grants nothing, a refund removes the access, the sandbox filter applies as it does to
 * subscriptions, and a purchase and a subscription of one entitlement give one entitlement.
 * @layer revenuecat
 */
import { Secret, SubscriptionError } from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type NonRenewingPurchaseRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { RevenueCatHttp } from '../revenuecat-http'
import type { RevenueCatFetch } from '../revenuecat.options'
import { fixtureFetch, type FetchCall } from '../revenuecat.fixture'
import { PAGE_LIMIT } from './list-all'
import { readRevenueCatAccount } from './read-account'
import type { RevenueCatReadContext } from './read-context'

const NOW = '2026-11-25T12:00:00.000Z'
const PURCHASED = '2026-11-18T11:06:40.000Z'
const YEAR_PASS_END = '2026-12-18T13:20:00.000Z'

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

function purchase(overrides: Partial<NonRenewingPurchaseRecord> = {}): NonRenewingPurchaseRecord {
  return {
    purchaseReference: 'purchase_PLACEHOLDER_1',
    entitlementNames: ['premium'],
    givesAccess: true,
    origin: 'app_store',
    environment: 'production',
    productReference: 'product_PLACEHOLDER_lifetime',
    purchasedAt: PURCHASED,
    accessUntil: null,
    refundedAt: null,
    ...overrides
  }
}

async function read(
  fixture: string,
  calls?: FetchCall[],
  overrides: Partial<RevenueCatReadContext> = {}
): Promise<SubscriptionSnapshot> {
  return readRevenueCatAccount(contextFor(fixtureFetch(fixture, calls), overrides), {
    accountId: 'customer_PLACEHOLDER_a'
  })
}

const entitlementOf = (snapshot: SubscriptionSnapshot): unknown =>
  snapshot.entitlements.map(({ name, active, until, grantingSubscriptionReferences }) => ({
    name,
    active,
    until,
    grantors: grantingSubscriptionReferences
  }))

describe('readRevenueCatAccount of a one-time purchase', () => {
  it('gives the entitlement of a lifetime purchase, with no end', async () => {
    // Scenario: the purchase is owned and its entitlement is active with no expiry (D31).
    const snapshot = await read('lifetime-purchase')
    expect(snapshot.nonRenewingPurchases).toStrictEqual([purchase()])
    expect(snapshot.subscriptions).toStrictEqual([])
    expect(entitlementOf(snapshot)).toStrictEqual([
      { name: 'premium', active: true, until: null, grantors: ['purchase_PLACEHOLDER_1'] }
    ])
    expect(snapshot.entitlements[0]?.grantingSubscriptionReference).toBe('purchase_PLACEHOLDER_1')
  })

  it('gives the entitlement of a purchase until the instant the source reports', async () => {
    // Scenario: a year pass: the active entitlement has an expiry, which is the purchase's end.
    const snapshot = await read('non-renewing-purchase')
    expect(snapshot.nonRenewingPurchases).toStrictEqual([
      purchase({
        purchaseReference: 'purchase_PLACEHOLDER_1',
        productReference: 'product_PLACEHOLDER_year_pass',
        accessUntil: YEAR_PASS_END
      })
    ])
    expect(entitlementOf(snapshot)).toStrictEqual([
      { name: 'premium', active: true, until: YEAR_PASS_END, grantors: ['purchase_PLACEHOLDER_1'] }
    ])
  })

  it('holds no purchase and no entitlement for a consumable, and does not read the active list', async () => {
    // Scenario: the purchase grants nothing; there is nothing to look up in the active list.
    const calls: FetchCall[] = []
    const snapshot = await read('consumable-purchase', calls)
    expect(snapshot.nonRenewingPurchases).toStrictEqual([])
    expect(snapshot.entitlements).toStrictEqual([])
    expect(calls.map((call) => new URL(call.url).pathname.split('/').at(-1))).toStrictEqual([
      'subscriptions',
      'purchases'
    ])
  })

  it('removes the access a refunded purchase granted and marks it refunded', async () => {
    // Scenario: status refunded and no active entitlement: the entitlement is inactive on the next read.
    const snapshot = await read('refunded-purchase')
    expect(snapshot.nonRenewingPurchases).toStrictEqual([
      purchase({ givesAccess: false, refundedAt: PURCHASED })
    ])
    expect(entitlementOf(snapshot)).toStrictEqual([
      { name: 'premium', active: false, until: null, grantors: [] }
    ])
  })

  it('gives no access and grants no entitlement for a sandbox purchase RevenueCat reports as active', async () => {
    // Scenario: AC06 for purchases: the sandbox purchase is kept for the host to see, with nothing granted.
    const snapshot = await read('sandbox-purchase')
    expect(snapshot.nonRenewingPurchases).toStrictEqual([
      purchase({
        givesAccess: false,
        entitlementNames: [],
        environment: 'sandbox',
        origin: 'other'
      })
    ])
    expect(snapshot.entitlements).toStrictEqual([])
  })

  it('grants the entitlement of a sandbox purchase when sandbox access is enabled', async () => {
    // Scenario: the host turned sandbox access on.
    const snapshot = await read('sandbox-purchase', undefined, { allowSandbox: true })
    expect(snapshot.nonRenewingPurchases?.[0]).toMatchObject({
      givesAccess: true,
      entitlementNames: ['premium']
    })
    expect(snapshot.entitlements[0]).toMatchObject({ name: 'premium', active: true })
  })

  it('reads the active entitlements once a purchase grants something, by the entitlement identifier', async () => {
    // Scenario: the lists asked for, in order, with the cursor field of the active list.
    const calls: FetchCall[] = []
    await read('lifetime-purchase', calls)
    const customer =
      'http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/customers/customer_PLACEHOLDER_a'
    expect(calls.map((call) => call.url)).toStrictEqual([
      `${customer}/subscriptions?limit=${PAGE_LIMIT}`,
      `${customer}/purchases?limit=${PAGE_LIMIT}`,
      `${customer}/active_entitlements?limit=${PAGE_LIMIT}`
    ])
  })
})

describe('readRevenueCatAccount with a subscription and a purchase', () => {
  const subscriptions = fixtureFetch('active-subscription')
  const purchases = fixtureFetch('lifetime-purchase')
  const mixed: RevenueCatFetch = (url, init) =>
    new URL(url).pathname.endsWith('/subscriptions')
      ? subscriptions(url, init)
      : purchases(url, init)

  it('gives one active entitlement with no end and names both grantors, sorted', async () => {
    // Scenario: a subscription and a lifetime purchase grant the same entitlement.
    const snapshot = await readRevenueCatAccount(contextFor(mixed), { accountId: 'c' })
    expect(entitlementOf(snapshot)).toStrictEqual([
      {
        name: 'premium',
        active: true,
        until: null,
        grantors: ['purchase_PLACEHOLDER_1', 'sub_PLACEHOLDER_1']
      }
    ])
    expect(snapshot.entitlements[0]?.grantingSubscriptionReference).toBe('purchase_PLACEHOLDER_1')
    expect(snapshot.subscriptions).toHaveLength(1)
    expect(snapshot.nonRenewingPurchases).toHaveLength(1)
  })
})

describe('readRevenueCatAccount of purchases the API reports unusually', () => {
  const list = (items: unknown[], next: string | null = null): unknown => ({
    object: 'list',
    items,
    next_page: next
  })
  const entitlement = { id: 'entl_1', lookup_key: 'premium' }
  const owned = (extra: Record<string, unknown> = {}): unknown => ({
    id: 'p1',
    status: 'owned',
    environment: 'production',
    store: 'app_store',
    product_id: 'prod',
    purchased_at: 1_795_000_000_000,
    entitlements: list([entitlement]),
    ...extra
  })
  const active = (items: unknown[]): unknown => list(items)

  function served(
    purchases: unknown,
    activeList: unknown,
    extra: Record<string, unknown> = {}
  ): RevenueCatFetch {
    return (url) => {
      const last = new URL(url).pathname.split('/').at(-1) ?? ''
      const body =
        extra[last] ??
        (last === 'purchases' ? purchases : last === 'active_entitlements' ? activeList : list([]))
      return Promise.resolve(new Response(JSON.stringify(body)))
    }
  }

  async function codeOf(read: Promise<unknown>): Promise<string> {
    try {
      await read
    } catch (error) {
      if (error instanceof SubscriptionError) return error.code
      throw error
    }
    return 'resolved'
  }

  it('reads the entitlements of a purchase from its own endpoint when the nested list is absent', async () => {
    // Scenario: no nested list; the per-purchase endpoint is the authority.
    const stub = served(
      list([owned({ entitlements: undefined })]),
      active([{ entitlement_id: 'entl_1', expires_at: null }]),
      { entitlements: list([entitlement]) }
    )
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(snapshot.nonRenewingPurchases?.[0]).toMatchObject({
      givesAccess: true,
      entitlementNames: ['premium']
    })
  })

  it('reads every page of the entitlements of a purchase, following the last entitlement id', async () => {
    // Scenario: the per-purchase list has two pages; the second request carries the last id.
    const cursors: Array<string | null> = []
    const stub: RevenueCatFetch = (url) => {
      const parsed = new URL(url)
      const last = parsed.pathname.split('/').at(-1)
      if (last === 'purchases') {
        return Promise.resolve(
          new Response(JSON.stringify(list([owned({ entitlements: undefined })])))
        )
      }
      if (last === 'entitlements') {
        const after = parsed.searchParams.get('starting_after')
        cursors.push(after)
        return Promise.resolve(
          new Response(
            JSON.stringify(
              after === null
                ? list([{ id: 'entl_0', lookup_key: 'extra' }], 'next')
                : list([entitlement])
            )
          )
        )
      }
      const items =
        last === 'active_entitlements' ? [{ entitlement_id: 'entl_1', expires_at: null }] : []
      return Promise.resolve(new Response(JSON.stringify(list(items))))
    }
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(cursors).toStrictEqual([null, 'entl_0'])
    expect(snapshot.nonRenewingPurchases?.[0]?.entitlementNames).toStrictEqual(['premium'])
  })

  it('gives no access for a purchase whose entitlement is not in the active list', async () => {
    // Scenario: owned, but the source does not list its entitlement as active: the term ended.
    const snapshot = await readRevenueCatAccount(contextFor(served(list([owned()]), active([]))), {
      accountId: 'c'
    })
    expect(snapshot.nonRenewingPurchases?.[0]).toMatchObject({
      givesAccess: false,
      accessUntil: null
    })
    expect(snapshot.entitlements[0]).toMatchObject({ name: 'premium', active: false })
  })

  it.each([
    ['a status the API does not define', { status: 'pending' }],
    ['no status', { status: undefined }]
  ])(
    'gives no access for a purchase with %s even though its entitlement is active',
    async (_label, extra) => {
      // Scenario: only `owned` can give access.
      const stub = served(
        list([owned(extra)]),
        active([{ entitlement_id: 'entl_1', expires_at: null }])
      )
      const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
      expect(snapshot.nonRenewingPurchases?.[0]).toMatchObject({ givesAccess: false })
    }
  )

  it('treats an active entitlement with a malformed end as not active, never as a lifetime grant', async () => {
    // Scenario: fail closed on an expiry that is not a number or null.
    const stub = served(
      list([owned()]),
      active([{ entitlement_id: 'entl_1', expires_at: 'never' }])
    )
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(snapshot.nonRenewingPurchases?.[0]?.givesAccess).toBe(false)
  })

  it('reads the pages of the purchases list and the active list to their end', async () => {
    // Scenario: both lists are longer than a page; the cursors are the last id and the last entitlement id.
    const urls: string[] = []
    const stub: RevenueCatFetch = (url) => {
      urls.push(url)
      const parsed = new URL(url)
      const last = parsed.pathname.split('/').at(-1)
      const after = parsed.searchParams.get('starting_after')
      if (last === 'purchases') {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              after === null
                ? list([owned({ id: 'p1' })], 'next')
                : list([
                    owned({ id: 'p2', entitlements: list([{ id: 'entl_2', lookup_key: 'extra' }]) })
                  ])
            )
          )
        )
      }
      if (last === 'active_entitlements') {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              after === null
                ? list([{ entitlement_id: 'entl_1', expires_at: null }], 'next')
                : list([{ entitlement_id: 'entl_2', expires_at: null }])
            )
          )
        )
      }
      return Promise.resolve(new Response(JSON.stringify(list([]))))
    }
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(
      snapshot.nonRenewingPurchases?.map((p) => [p.purchaseReference, p.givesAccess])
    ).toStrictEqual([
      ['p1', true],
      ['p2', true]
    ])
    expect(
      urls
        .filter((url) => url.includes('starting_after'))
        .map((url) => new URL(url).searchParams.get('starting_after'))
    ).toStrictEqual(['p1', 'entl_1'])
  })

  it.each([
    ['an item that is not an object', list(['x'])],
    ['an item with no id', list([{ status: 'owned' }])]
  ])(
    'rejects with the source-unavailable code for a purchases list with %s',
    async (_label, purchases) => {
      // Scenario: a purchase that cannot be named cannot be trusted.
      expect(
        await codeOf(
          readRevenueCatAccount(contextFor(served(purchases, active([]))), { accountId: 'c' })
        )
      ).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    }
  )

  it('treats a customer that vanishes while the purchases are read as an empty snapshot', async () => {
    // Scenario: the purchases list answers 404.
    const stub: RevenueCatFetch = (url) =>
      Promise.resolve(
        new URL(url).pathname.endsWith('/purchases')
          ? new Response('{}', { status: 404 })
          : new Response(JSON.stringify(list([])))
      )
    const snapshot = await readRevenueCatAccount(contextFor(stub), { accountId: 'c' })
    expect(snapshot.sourceCustomer).toBeNull()
  })
})
