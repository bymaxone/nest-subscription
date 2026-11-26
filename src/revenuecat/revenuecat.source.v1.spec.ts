/**
 * @fileoverview Pins the version 1 key of the RevenueCat adapter: the two operations that exist
 * only in version 1 (Google Play stop renewal and Google Play one-time-purchase refund) are
 * possible only with `apiKeyV1`, run with that key and never with the version 2 key, and are the
 * person's, with no request, without it.
 * @layer revenuecat
 */
import type { ManagedRecord } from '@bymax-one/nest-subscription/internal'

import { purchaseOf, subscriptionOf } from './management/management.builders.spec'
import type { RevenueCatSourceOptions } from './revenuecat.options'
import { revenueCatSource } from './revenuecat.source'

const V2_KEY = 'sentinel-v2-key-4c1a'
const V1_KEY = 'sentinel-v1-key-9e07'
const ACCOUNT = { accountId: 'customer_a' }

/** A request the fetch stub saw. */
interface Seen {
  readonly method: string
  readonly url: string
  readonly authorization: string | undefined
}

/** An adapter over a fetch stub that answers the reads of a Google Play record. */
function adapter(extra: Partial<RevenueCatSourceOptions> = {}): {
  source: ReturnType<typeof revenueCatSource>
  seen: Seen[]
} {
  const seen: Seen[] = []
  const source = revenueCatSource({
    projectId: 'proj_1',
    apiKey: V2_KEY,
    baseUrl: 'https://rc.test/v2',
    fetch: (url, init) => {
      const headers: Record<string, string> = Object(init.headers)
      seen.push({ method: init.method ?? 'GET', url, authorization: headers['authorization'] })
      const body = url.includes('/purchases/')
        ? { store: 'play_store', store_purchase_identifier: 'store-pur-1' }
        : { store: 'play_store', store_subscription_identifier: 'store-sub-1' }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    },
    ...extra
  })
  return { source, seen }
}

const SUBSCRIPTION: ManagedRecord = { kind: 'subscription', record: subscriptionOf() }
const PURCHASE: ManagedRecord = { kind: 'purchase', record: purchaseOf() }

describe('revenueCatSource with and without apiKeyV1', () => {
  it('answers Google Play stop renewal and Google Play purchase refund as not possible without apiKeyV1', async () => {
    // Scenario: exactly those two pairs lose the operation; extend and the subscription refund stay.
    const { source } = adapter()
    expect((await source.capabilities(ACCOUNT, SUBSCRIPTION)).operations).toStrictEqual([
      'extend',
      'refund'
    ])
    expect((await source.capabilities(ACCOUNT, PURCHASE)).operations).toStrictEqual([])
  })

  it('answers the same two pairs as possible with apiKeyV1', async () => {
    // Scenario: with a version 1 key the full Google Play column of Appendix A.4 holds.
    const { source } = adapter({ apiKeyV1: V1_KEY })
    expect((await source.capabilities(ACCOUNT, SUBSCRIPTION)).operations).toStrictEqual([
      'stop_renewal',
      'extend',
      'refund'
    ])
    expect((await source.capabilities(ACCOUNT, PURCHASE)).operations).toStrictEqual(['refund'])
  })

  it('makes no request and returns the management reference for the two operations without apiKeyV1', async () => {
    // Scenario: the person must act, and nothing reaches the source.
    const { source, seen } = adapter()
    expect(await source.stopRenewal(ACCOUNT, subscriptionOf())).toStrictEqual({
      outcome: 'customer_action_required',
      managementReference: 'https://manage.example/sub_1'
    })
    expect(await source.refund?.(ACCOUNT, PURCHASE)).toStrictEqual({
      outcome: 'customer_action_required',
      managementReference: null
    })
    expect(seen).toHaveLength(0)
  })

  it('sends the version 1 key to version 1 and the version 2 key to every version 2 request', async () => {
    // Scenario: both version 1 operations run; each request carries the key of its own version.
    const { source, seen } = adapter({ apiKeyV1: V1_KEY })
    await source.stopRenewal(ACCOUNT, subscriptionOf())
    await source.refund?.(ACCOUNT, PURCHASE)
    const v1 = seen.filter((request) => request.url.startsWith('https://rc.test/v1/'))
    const v2 = seen.filter((request) => request.url.startsWith('https://rc.test/v2/'))
    expect(v1.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      'POST https://rc.test/v1/subscribers/customer_a/subscriptions/store-sub-1/cancel',
      'POST https://rc.test/v1/subscribers/customer_a/transactions/store-pur-1/refund'
    ])
    expect(v1.every((request) => request.authorization === `Bearer ${V1_KEY}`)).toBe(true)
    expect(v2).toHaveLength(2)
    expect(v2.every((request) => request.authorization === `Bearer ${V2_KEY}`)).toBe(true)
    expect(seen.map((request) => request.authorization)).not.toContain(undefined)
  })

  it('sends the version 1 key, not the version 2 key, when a rotation pair is given', async () => {
    // Scenario: a rotation pair holds a current key; it is the one that is sent.
    const { source, seen } = adapter({ apiKeyV1: { current: V1_KEY, previous: 'sentinel-old-v1' } })
    await source.stopRenewal(ACCOUNT, subscriptionOf())
    const v1 = seen.filter((request) => request.url.includes('/v1/'))
    expect(v1.map((request) => request.authorization)).toStrictEqual([`Bearer ${V1_KEY}`])
  })
})
