/**
 * @fileoverview Pins extend at RevenueCat: one version 2 write for Google Play, the App Store and
 * RevenueCat web billing with the body the API documents, the App Store's reason and 90-day limit
 * refused before any request, every other store answered as not possible with no write, and a
 * failed request that names no body, key or identifier.
 * @layer revenuecat
 */
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { extendAt } from './extend'
import { KEY, ok, stubbed, subscriptionOf } from './management.builders.spec'

const EXTEND_PATH = 'https://rc.test/v2/projects/proj_1/subscriptions/sub_1/actions/extend'

describe('extendAt', () => {
  it.each([
    ['Google Play', 'play_store', 'play_store', 0, { extend_by_days: 7 }],
    [
      'the App Store',
      'app_store',
      'app_store',
      0,
      { extend_by_days: 7, extend_reason_code: 'other' }
    ],
    ['RevenueCat web billing', 'web', 'rc_billing', 1, { extend_by_days: 7 }]
  ] as const)(
    'makes exactly one version 2 write for %s, with the documented body',
    async (_label, origin, store, reads, body) => {
      // Scenario: the request body carries whole days, and the reason only where it was given.
      const { context, calls, writes } = stubbed(() => ok({ store }))
      const reason = origin === 'app_store' ? ('other' as const) : undefined
      expect(
        await extendAt(context, subscriptionOf({ origin }), { days: 7, reason })
      ).toStrictEqual({
        outcome: 'accepted'
      })
      expect(writes()).toStrictEqual([
        { method: 'POST', url: EXTEND_PATH, body: JSON.stringify(body) }
      ])
      expect(calls.filter((call) => call.method === 'GET')).toHaveLength(reads)
    }
  )

  it.each([
    ['Stripe tracked by RevenueCat', 'web', 'stripe', 1],
    ['a promotional grant', 'promotional', 'promotional', 0],
    ['another origin', 'other', 'amazon', 0]
  ] as const)(
    'makes no write for %s and returns the management reference',
    async (_label, origin, store, reads) => {
      // Scenario: not documented as extendable; at most the store is read.
      const { context, calls, writes } = stubbed(() => ok({ store }))
      expect(await extendAt(context, subscriptionOf({ origin }), { days: 3 })).toStrictEqual({
        outcome: 'customer_action_required',
        managementReference: 'https://manage.example/sub_1'
      })
      expect(writes()).toHaveLength(0)
      expect(calls).toHaveLength(reads)
    }
  )

  it.each([
    ['no reason', { days: 7 }],
    ['91 days', { days: 91, reason: 'other' as const }]
  ])('refuses an App Store extension with %s before any request', async (_label, extension) => {
    // Scenario: Apple needs a reason and allows 90 days at most.
    const { context, calls } = stubbed(() => ok({}))
    await expect(
      extendAt(context, subscriptionOf({ origin: 'app_store' }), extension)
    ).rejects.toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT })
    expect(calls).toHaveLength(0)
  })

  it('accepts exactly 90 days for the App Store', async () => {
    // Scenario: the limit is inclusive.
    const { context, writes } = stubbed(() => ok({}))
    await extendAt(context, subscriptionOf({ origin: 'app_store' }), { days: 90, reason: 'other' })
    expect(writes()).toHaveLength(1)
  })

  it('does not limit the days of a Google Play extension to 90', async () => {
    // Scenario: only Apple's cap is documented.
    const { context, writes } = stubbed(() => ok({}))
    await extendAt(context, subscriptionOf(), { days: 200 })
    expect(writes()[0]?.body).toBe('{"extend_by_days":200}')
  })

  it('turns a 4xx into a typed failure with no body, key or identifier', async () => {
    // Scenario: the operation is refused; the failure is the fixed one.
    const { context } = stubbed(() => ({ status: 422, body: { message: 'sentinel-body-ext-2e' } }))
    const failure: unknown = await extendAt(context, subscriptionOf(), { days: 3 }).catch(
      (error: unknown) => error
    )
    expect(failure).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
    const shown =
      JSON.stringify(failure) +
      String(failure) +
      (failure instanceof Error ? (failure.stack ?? '') : '')
    for (const secret of ['sentinel-body-ext-2e', 'sub_1', 'proj_1', KEY]) {
      expect(shown).not.toContain(secret)
    }
  })
})
