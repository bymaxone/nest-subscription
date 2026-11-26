/**
 * @fileoverview Pins how sandbox activity of a customer bears on a production purchase: the
 * active-entitlements list spans both environments and names no grantor, so while sandbox access
 * is not allowed an entitlement that a sandbox subscription or a sandbox purchase also grants is
 * no evidence for a production purchase.
 * @layer revenuecat
 */
import { Secret } from '@bymax-one/nest-subscription/internal'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { RevenueCatHttp } from '../revenuecat-http'
import type { RevenueCatFetch } from '../revenuecat.options'
import { readRevenueCatAccount } from './read-account'
import type { RevenueCatReadContext } from './read-context'

const NOW = '2026-11-25T12:00:00.000Z'
const TERM_END = Date.parse('2026-12-18T13:20:00.000Z')

function contextFor(fetchStub: RevenueCatFetch, allowSandbox: boolean): RevenueCatReadContext {
  return {
    http: new RevenueCatHttp({
      baseUrl: 'http://127.0.0.1:9/v2',
      apiKey: new Secret('sentinel-api-key-7f3a'),
      timeoutMs: 1_000,
      fetch: fetchStub
    }),
    projectId: 'proj_PLACEHOLDER',
    sourceName: 'revenuecat',
    allowSandbox,
    clock: { now: () => new Date(NOW) }
  }
}

const list = (items: unknown[], next: string | null = null): unknown => ({
  object: 'list',
  items,
  next_page: next
})
const premium = { id: 'entl_1', lookup_key: 'premium' }
const extra = { id: 'entl_2', lookup_key: 'extra' }
const nameOnly = { lookup_key: 'premium' }

/** A purchase that is owned in production and grants the entitlements. */
const production = (entitlements: unknown[]): unknown => ({
  id: 'p_prod',
  status: 'owned',
  environment: 'production',
  store: 'app_store',
  entitlements: list(entitlements)
})

/** A purchase in the sandbox, with the status given, that grants the entitlements. */
const sandboxPurchase = (entitlements: unknown[], status = 'owned'): unknown => ({
  id: 'p_sbx',
  status,
  environment: 'sandbox',
  store: 'test_store',
  entitlements: list(entitlements)
})

/** A subscription in the sandbox, with the flag given, that grants the entitlements. */
const sandboxSubscription = (entitlements: unknown[], givesAccess = true): unknown => ({
  id: 's_sbx',
  status: 'active',
  gives_access: givesAccess,
  environment: 'sandbox',
  store: 'test_store',
  entitlements: list(entitlements)
})

/** What the customer's lists hold; the active list spans both environments. */
interface Lists {
  readonly subscriptions?: unknown[]
  readonly purchases?: unknown[]
  readonly purchasesSecondPage?: unknown[]
  readonly active: unknown[]
}

/** A `fetch` that serves the lists; the purchases list has a second page when one is given. */
function served(lists: Lists): RevenueCatFetch {
  return (url) => {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').at(-1)
    const second = parsed.searchParams.get('starting_after') !== null
    const body =
      last === 'subscriptions'
        ? list(lists.subscriptions ?? [])
        : last === 'purchases'
          ? second
            ? list(lists.purchasesSecondPage ?? [])
            : list(lists.purchases ?? [], lists.purchasesSecondPage === undefined ? null : 'next')
          : last === 'active_entitlements'
            ? list(lists.active)
            : list([])
    return Promise.resolve(new Response(JSON.stringify(body)))
  }
}

async function read(lists: Lists, allowSandbox = false): Promise<SubscriptionSnapshot> {
  return readRevenueCatAccount(contextFor(served(lists), allowSandbox), { accountId: 'c' })
}

/** The production purchase of a snapshot. */
const productionOf = (snapshot: SubscriptionSnapshot): unknown =>
  snapshot.nonRenewingPurchases?.find((held) => held.purchaseReference === 'p_prod')

const activeNoEnd = { entitlement_id: 'entl_1', expires_at: null }

describe('a production purchase beside sandbox activity of the same entitlement', () => {
  it.each([
    ['a sandbox purchase', { purchases: [production([premium]), sandboxPurchase([premium])] }],
    [
      'a refunded sandbox purchase',
      { purchases: [production([premium]), sandboxPurchase([premium], 'refunded')] }
    ],
    [
      'a sandbox subscription',
      { subscriptions: [sandboxSubscription([premium])], purchases: [production([premium])] }
    ],
    [
      'a sandbox subscription that gives no access',
      { subscriptions: [sandboxSubscription([premium], false)], purchases: [production([premium])] }
    ],
    [
      'a sandbox purchase whose entitlement has no identifier',
      { purchases: [production([premium]), sandboxPurchase([nameOnly])] }
    ],
    [
      'a sandbox subscription whose entitlement has no identifier',
      { subscriptions: [sandboxSubscription([nameOnly])], purchases: [production([premium])] }
    ],
    [
      'a sandbox purchase on a later page of the purchases list',
      { purchases: [production([premium])], purchasesSecondPage: [sandboxPurchase([premium])] }
    ]
  ])(
    'gives the production purchase no access and no end, with %s and sandbox access off',
    async (_label, lists) => {
      // Scenario: an owned production purchase whose entitlement the active list shows as active
      // with no end; the sandbox grant of the same entitlement is no evidence for it.
      const snapshot = await read({ ...lists, active: [activeNoEnd] })
      expect(productionOf(snapshot)).toMatchObject({ givesAccess: false, accessUntil: null })
      expect(snapshot.entitlements.some((held) => held.active)).toBe(false)
    }
  )

  it('keeps the entitlement of an expired owned production purchase inactive when a sandbox purchase grants it', async () => {
    // Scenario: the term of the production purchase ended, so only the sandbox grant is listed active.
    const snapshot = await read({
      purchases: [production([premium]), sandboxPurchase([premium])],
      active: [{ entitlement_id: 'entl_1', expires_at: TERM_END + 86_400_000 }]
    })
    expect(snapshot.entitlements).toMatchObject([{ name: 'premium', active: false }])
  })

  it('gives the production purchase access again when sandbox access is allowed', async () => {
    // Scenario: the same lists with the option on: nothing is contested, as before.
    const snapshot = await read(
      { purchases: [production([premium]), sandboxPurchase([premium])], active: [activeNoEnd] },
      true
    )
    expect(productionOf(snapshot)).toMatchObject({ givesAccess: true, accessUntil: null })
    expect(snapshot.entitlements).toMatchObject([{ name: 'premium', active: true }])
  })

  it('gives the production purchase access again when a sandbox subscription grants it and sandbox access is allowed', async () => {
    // Scenario: the subscription variant with the option on.
    const snapshot = await read(
      {
        subscriptions: [sandboxSubscription([premium])],
        purchases: [production([premium])],
        active: [activeNoEnd]
      },
      true
    )
    expect(productionOf(snapshot)).toMatchObject({ givesAccess: true })
  })

  it('keeps access through the entitlement no sandbox grantor shares, with its end', async () => {
    // Scenario: one purchase grants two entitlements; a sandbox purchase grants only the first.
    const snapshot = await read({
      purchases: [production([premium, extra]), sandboxPurchase([premium])],
      active: [activeNoEnd, { entitlement_id: 'entl_2', expires_at: TERM_END }]
    })
    expect(productionOf(snapshot)).toMatchObject({
      givesAccess: true,
      entitlementNames: ['extra'],
      accessUntil: new Date(TERM_END).toISOString()
    })
    expect(snapshot.entitlements.map(({ name, active }) => [name, active])).toStrictEqual([
      ['extra', true]
    ])
  })

  it('leaves a production purchase as it was when no sandbox grantor exists', async () => {
    // Scenario: the control: only production grants, so nothing is contested.
    const snapshot = await read({ purchases: [production([premium])], active: [activeNoEnd] })
    expect(productionOf(snapshot)).toMatchObject({ givesAccess: true, accessUntil: null })
  })

  it('leaves a production purchase as it was when the sandbox grants a different entitlement', async () => {
    // Scenario: a sandbox purchase of another entitlement contests nothing of this one.
    const snapshot = await read({
      purchases: [production([premium]), sandboxPurchase([extra])],
      active: [activeNoEnd]
    })
    expect(productionOf(snapshot)).toMatchObject({ givesAccess: true })
  })
})
