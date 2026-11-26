/**
 * @fileoverview Pins refund at RevenueCat for both kinds of record: exactly one write, to the
 * version and path the documentation gives for each origin and store, none where a server cannot
 * refund, and a failed request that names no body, key or identifier.
 * @layer revenuecat
 */
import type { ManagedRecord } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import {
  APP_USER,
  KEY,
  ok,
  purchaseOf,
  stubbed,
  subscriptionOf,
  type Responder
} from './management.builders.spec'
import { refundAt } from './refund'

const ACCOUNT = { accountId: APP_USER }
const sub = (origin: 'play_store' | 'web' | 'app_store' | 'promotional'): ManagedRecord => ({
  kind: 'subscription',
  record: subscriptionOf({ origin })
})
const pur = (origin: 'play_store' | 'web' | 'app_store'): ManagedRecord => ({
  kind: 'purchase',
  record: purchaseOf({ origin })
})

/** Answers each read of the source with what the path says, and a write with 200. */
function source(store: string, identifier: string | null = 'store-id-1'): Responder {
  return (call) => {
    if (call.method !== 'GET') return ok({})
    if (call.url.includes('/transactions')) return ok({ items: [{ id: 'txn-9' }], next_page: null })
    const key = call.url.includes('/purchases/')
      ? 'store_purchase_identifier'
      : 'store_subscription_identifier'
    return ok({ store, ...(identifier === null ? {} : { [key]: identifier }) })
  }
}

/** The writes of a stub as `METHOD url`. */
function written(calls: { method: string; url: string }[]): string[] {
  return calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`)
}

describe('refundAt', () => {
  it('refunds a Google Play subscription through its latest transaction, in one write', async () => {
    // Scenario: the transactions are listed newest first, one, and the newest is refunded.
    const { context, calls } = stubbed(source('play_store'))
    expect(await refundAt(context, ACCOUNT, sub('play_store'))).toStrictEqual({
      outcome: 'accepted'
    })
    expect(calls.filter((call) => call.method === 'GET').map((call) => call.url)).toStrictEqual([
      'https://rc.test/v2/projects/proj_1/subscriptions/sub_1/transactions?sort=purchased_at&direction=desc&limit=1'
    ])
    expect(written(calls)).toStrictEqual([
      'POST https://rc.test/v2/projects/proj_1/subscriptions/sub_1/transactions/txn-9/actions/refund'
    ])
  })

  it('refunds a web billing subscription in one version 2 write', async () => {
    // Scenario: the store decides; web billing refunds the subscription itself.
    const { context, calls } = stubbed(source('rc_billing'))
    await refundAt(context, ACCOUNT, sub('web'))
    expect(written(calls)).toStrictEqual([
      'POST https://rc.test/v2/projects/proj_1/subscriptions/sub_1/actions/refund'
    ])
  })

  it('refunds a web billing purchase in one version 2 write', async () => {
    // Scenario: the purchase's own refund action.
    const { context, calls } = stubbed(source('rc_billing'))
    await refundAt(context, ACCOUNT, pur('web'))
    expect(written(calls)).toStrictEqual([
      'POST https://rc.test/v2/projects/proj_1/purchases/pur_1/actions/refund'
    ])
  })

  it('refunds a Google Play purchase in one version 1 write, with the store identifier', async () => {
    // Scenario: the one-time purchase exists only in version 1; its path names the App User ID
    // and the identifier the store gave the purchase.
    const { context, calls } = stubbed(source('play_store'))
    await refundAt(context, ACCOUNT, pur('play_store'))
    expect(written(calls)).toStrictEqual([
      'POST https://rc.test/v1/subscribers/sentinel-app-user%2F1/transactions/store-id-1/refund'
    ])
  })

  it.each([
    ['an App Store subscription', sub('app_store'), 'app_store', 0],
    ['an App Store purchase', pur('app_store'), 'app_store', 0],
    ['a promotional grant', sub('promotional'), 'promotional', 0],
    ['a Stripe subscription tracked by RevenueCat', sub('web'), 'stripe', 1],
    ['a Stripe purchase tracked by RevenueCat', pur('web'), 'stripe', 1]
  ] as const)(
    'makes no write for %s and returns the management reference',
    async (_label, target, store, reads) => {
      // Scenario: not possible from a server; at most the store is read.
      const { context, calls } = stubbed(source(store))
      expect(await refundAt(context, ACCOUNT, target)).toStrictEqual({
        outcome: 'customer_action_required',
        managementReference: target.kind === 'subscription' ? 'https://manage.example/sub_1' : null
      })
      expect(written(calls)).toHaveLength(0)
      expect(calls).toHaveLength(reads)
    }
  )

  it.each([
    [
      'a Google Play purchase with no store identifier',
      pur('play_store'),
      source('play_store', null)
    ],
    [
      'a Google Play subscription whose transactions are empty',
      sub('play_store'),
      (call: { method: string }) => ok(call.method === 'GET' ? { items: [], next_page: null } : {})
    ],
    [
      'a Google Play subscription whose newest transaction has no id',
      sub('play_store'),
      (call: { method: string }) =>
        ok(call.method === 'GET' ? { items: [{ nope: 1 }], next_page: null } : {})
    ],
    [
      'a Google Play subscription whose transactions are not a list',
      sub('play_store'),
      (call: { method: string }) => ok(call.method === 'GET' ? [] : {})
    ],
    [
      'a Google Play subscription whose newest transaction is not an object',
      sub('play_store'),
      (call: { method: string }) => ok(call.method === 'GET' ? { items: [7] } : {})
    ]
  ])('fails as unavailable, without a write, for %s', async (_label, target, respond) => {
    // Scenario: what the next request needs is not in the response.
    const { context, calls } = stubbed(respond)
    await expect(refundAt(context, ACCOUNT, target)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(written(calls)).toHaveLength(0)
  })

  it.each([
    ['a version 1 refund', pur('play_store')],
    ['a version 2 subscription refund', sub('web')],
    ['a version 2 transaction refund', sub('play_store')]
  ])(
    'turns a 4xx of %s into a typed failure with no body, key or identifier',
    async (_label, target) => {
      // Scenario: the refund is refused; the failure is the fixed one.
      const reading = source(target.kind === 'purchase' ? 'play_store' : 'rc_billing')
      const { context } = stubbed((call) =>
        call.method === 'GET'
          ? reading(call)
          : { status: 409, body: { message: 'sentinel-body-refund-5a', customer: APP_USER } }
      )
      const failure: unknown = await refundAt(context, ACCOUNT, target).catch(
        (error: unknown) => error
      )
      expect(failure).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
      const shown =
        JSON.stringify(failure) +
        String(failure) +
        (failure instanceof Error ? (failure.stack ?? '') : '')
      for (const secret of ['sentinel-body-refund-5a', APP_USER, KEY, 'store-id-1', 'txn-9']) {
        expect(shown).not.toContain(secret)
      }
    }
  )
})
