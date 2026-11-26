/**
 * @fileoverview Pins what a server can do with a RevenueCat record, per origin and store, against
 * the specification's Appendix A.4: a table-driven test over every origin and every store a web
 * record can have, and the rule that the source is read only where the store decides.
 * @layer revenuecat
 */
import { SubscriptionError, type ManagedRecord } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { capabilitiesOf, operationsOf } from './capabilities'
import { ok, purchaseOf, stubbed, subscriptionOf } from './management.builders.spec'

/** A subscription target of an origin. */
const sub = (origin: Parameters<typeof subscriptionOf>[0] = {}): ManagedRecord => ({
  kind: 'subscription',
  record: subscriptionOf(origin)
})

describe('operationsOf: Appendix A.4, stop renewal and extend', () => {
  it.each([
    ['Google Play', 'play_store', null, ['stop_renewal', 'extend']],
    ['App Store', 'app_store', null, ['extend']],
    ['RevenueCat web billing', 'web', 'rc_billing', ['stop_renewal', 'extend']],
    ['Stripe tracked by RevenueCat', 'web', 'stripe', []],
    ['another web store', 'web', 'paddle', []],
    ['a web record whose store is not stated', 'web', null, []],
    ['a promotional grant', 'promotional', null, []],
    ['another origin', 'other', null, []]
  ] as const)('%s allows %j', (_label, origin, store, expected) => {
    // Scenario: each row of the stop renewal and extend columns, per origin and store.
    expect(operationsOf(sub({ origin }), store)).toStrictEqual(expected)
  })

  it('allows nothing to stop on a non-renewing purchase, whatever its origin', () => {
    // Scenario: a purchase renews nothing.
    for (const origin of ['play_store', 'web', 'app_store'] as const) {
      expect(
        operationsOf({ kind: 'purchase', record: purchaseOf({ origin }) }, 'rc_billing')
      ).toStrictEqual([])
    }
  })
})

describe('operationsOf: Appendix A.4, resume and change product', () => {
  const origins = ['play_store', 'app_store', 'web', 'promotional', 'other'] as const
  const stores = [null, 'rc_billing', 'stripe', 'play_store', 'app_store', 'paddle'] as const

  it.each(origins)('allows neither resume nor change product for %s on any store', (origin) => {
    // Scenario: no RevenueCat page documents a server operation for either, so every origin and
    // store is answered as not possible, for a subscription and for a purchase.
    for (const store of stores) {
      for (const target of [
        sub({ origin }),
        { kind: 'purchase', record: purchaseOf({ origin }) } as const
      ]) {
        const operations = operationsOf(target, store)
        expect(operations).not.toContain('resume')
        expect(operations).not.toContain('change_product')
      }
    }
  })
})

describe('capabilitiesOf', () => {
  it('answers a Google Play subscription without reading the source, with its management reference', async () => {
    // Scenario: the origin alone decides, so no request is made.
    const { context, calls } = stubbed(() => ok({}))
    expect(await capabilitiesOf(context, sub())).toStrictEqual({
      operations: ['stop_renewal', 'extend'],
      managementReference: 'https://manage.example/sub_1'
    })
    expect(calls).toHaveLength(0)
  })

  it('reads the store of a web subscription, once, and answers by it', async () => {
    // Scenario: web billing may stop; Stripe may not and the reference is returned.
    const web = stubbed(() => ok({ store: 'rc_billing' }))
    expect((await capabilitiesOf(web.context, sub({ origin: 'web' }))).operations).toStrictEqual([
      'stop_renewal',
      'extend'
    ])
    expect(web.calls.map((call) => call.url)).toStrictEqual([
      'https://rc.test/v2/projects/proj_1/subscriptions/sub_1'
    ])
    const stripe = stubbed(() => ok({ store: 'stripe' }))
    expect(await capabilitiesOf(stripe.context, sub({ origin: 'web' }))).toStrictEqual({
      operations: [],
      managementReference: 'https://manage.example/sub_1'
    })
  })

  it('answers an App Store subscription as able to extend only, with no request', async () => {
    // Scenario: Apple does not allow it; the management reference is returned.
    const { context, calls } = stubbed(() => ok({}))
    expect(await capabilitiesOf(context, sub({ origin: 'app_store' }))).toStrictEqual({
      operations: ['extend'],
      managementReference: 'https://manage.example/sub_1'
    })
    expect(calls).toHaveLength(0)
  })

  it('answers a purchase with no management reference, reading a web purchase by its own path', async () => {
    // Scenario: the purchase endpoint carries the store of a web purchase.
    const { context, calls } = stubbed(() => ok({ store: 'stripe' }))
    expect(
      await capabilitiesOf(context, { kind: 'purchase', record: purchaseOf({ origin: 'web' }) })
    ).toStrictEqual({ operations: [], managementReference: null })
    expect(calls[0]?.url).toBe('https://rc.test/v2/projects/proj_1/purchases/pur_1')
  })

  it('fails as the source being unavailable when the store cannot be read, with no identifier in the error', async () => {
    // Scenario: a 404 and a 500 on the read; neither is an unknown account and neither names a
    // reference, the key or the body.
    for (const status of [404, 500]) {
      const { context } = stubbed(() => ({ status, body: { message: 'sentinel-body-9d1' } }))
      const failure: unknown = await capabilitiesOf(context, sub({ origin: 'web' })).catch(
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(SubscriptionError)
      expect(failure).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
      expect(JSON.stringify(failure) + String(failure)).not.toMatch(/sentinel|sub_1|proj_1/)
    }
  })

  it('fails as unavailable when the body of the read is not an object', async () => {
    // Scenario: RevenueCat answers a list where a subscription is expected.
    const { context } = stubbed(() => ok([]))
    await expect(capabilitiesOf(context, sub({ origin: 'web' }))).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
  })
})
