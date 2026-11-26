/**
 * @fileoverview Pins stop renewal at RevenueCat: a Google Play subscription makes exactly one
 * version 1 write, RevenueCat web billing exactly one version 2 write, every other origin and
 * store none, and a failed request becomes a typed failure that carries no body, key or
 * identifier.
 * @layer revenuecat
 */
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import {
  APP_USER,
  KEY,
  ok,
  stubbed,
  subscriptionOf,
  type Responder
} from './management.builders.spec'
import { stopRenewalAt } from './stop-renewal'

const ACCOUNT = { accountId: APP_USER }

/** Answers a read of a subscription with the given store and identifier, and a write with 200. */
function reading(store: string, identifier: string | null = 'store-sub-1'): Responder {
  return (call) =>
    ok(
      call.method === 'GET'
        ? { store, ...(identifier === null ? {} : { store_subscription_identifier: identifier }) }
        : { object: 'customer' }
    )
}

describe('stopRenewalAt', () => {
  it('makes exactly one version 1 write for a Google Play subscription, with no body', async () => {
    // Scenario: the identifier is read from the source and the cancel goes to version 1, with the
    // App User ID and the store identifier encoded into the path.
    const { context, calls, writes } = stubbed(reading('play_store'))
    expect(await stopRenewalAt(context, ACCOUNT, subscriptionOf())).toStrictEqual({
      outcome: 'accepted'
    })
    expect(writes()).toStrictEqual([
      {
        method: 'POST',
        url: 'https://rc.test/v1/subscribers/sentinel-app-user%2F1/subscriptions/store-sub-1/cancel',
        body: undefined
      }
    ])
    expect(calls.filter((call) => call.url.startsWith('https://rc.test/v2'))).toHaveLength(1)
  })

  it('makes exactly one version 2 write for RevenueCat web billing', async () => {
    // Scenario: the store is rc_billing; the cancel goes to the subscription's action path.
    const { context, writes } = stubbed(reading('rc_billing'))
    await stopRenewalAt(context, ACCOUNT, subscriptionOf({ origin: 'web' }))
    expect(writes().map((call) => `${call.method} ${call.url}`)).toStrictEqual([
      'POST https://rc.test/v2/projects/proj_1/subscriptions/sub_1/actions/cancel'
    ])
  })

  it.each([
    ['an App Store subscription', subscriptionOf({ origin: 'app_store' }), 'unused', 0],
    ['a Stripe subscription tracked by RevenueCat', subscriptionOf({ origin: 'web' }), 'stripe', 1],
    ['a promotional grant', subscriptionOf({ origin: 'promotional' }), 'unused', 0]
  ])(
    'makes no write for %s and returns the management reference',
    async (_label, record, store, reads) => {
      // Scenario: not possible from a server; at most the store is read.
      const { context, calls, writes } = stubbed(reading(store))
      expect(await stopRenewalAt(context, ACCOUNT, record)).toStrictEqual({
        outcome: 'customer_action_required',
        managementReference: 'https://manage.example/sub_1'
      })
      expect(writes()).toHaveLength(0)
      expect(calls).toHaveLength(reads)
    }
  )

  it('fails as unavailable, with no store identifier, when a Google Play subscription names none', async () => {
    // Scenario: the read has no store_subscription_identifier, so no cancel can be addressed.
    const { context, writes } = stubbed(reading('play_store', null))
    await expect(stopRenewalAt(context, ACCOUNT, subscriptionOf())).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(writes()).toHaveLength(0)
  })

  it.each([
    ['version 1', 'play_store', 'play_store'],
    ['version 2', 'web', 'rc_billing']
  ] as const)(
    'turns a 4xx of the %s operation into a typed failure with no body, key or identifier',
    async (_label, origin, store) => {
      // Scenario: the operation is refused (409 then 404); the failure is the fixed one.
      for (const status of [409, 404]) {
        const { context } = stubbed((call) =>
          call.method === 'GET'
            ? ok({ store, store_subscription_identifier: 'store-sub-1' })
            : { status, body: { message: 'sentinel-body-77', customer: APP_USER } }
        )
        const failure: unknown = await stopRenewalAt(
          context,
          ACCOUNT,
          subscriptionOf({ origin })
        ).catch((error: unknown) => error)
        expect(failure).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
        const shown =
          JSON.stringify(failure) +
          String(failure) +
          (failure instanceof Error ? (failure.stack ?? '') : '')
        expect(shown).not.toContain('sentinel-body-77')
        expect(shown).not.toContain(APP_USER)
        expect(shown).not.toContain(KEY)
        expect(shown).not.toContain('store-sub-1')
      }
    }
  )
})
