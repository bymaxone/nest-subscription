/**
 * @fileoverview The RevenueCat management operations end to end through the real service and the
 * local stand-in for the API: which origin and store allows which operation, the one write each
 * operation makes and the version it goes to, and that the result is the customer read back.
 * @layer e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import {
  SUBSCRIPTION_ERROR_CODES,
  Secret,
  SubscriptionModule,
  SubscriptionService
} from '@bymax-one/nest-subscription'
import {
  type NonRenewingPurchaseRecord,
  type SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'
import { InMemorySubscriptionStore, ManualClock } from '@bymax-one/nest-subscription/testing'

import { versionOne } from '../../src/revenuecat/management/management-context'
import { RevenueCatHttp } from '../../src/revenuecat/revenuecat-http'
import {
  fixtureLists,
  startStandIn,
  type StandIn,
  type StandInAnswer,
  type StandInRequest
} from './fixtures/revenuecat-stand-in'

const KEY = 'sentinel-api-key-e2e-8a41'
const KEY_V1 = 'sentinel-v1-key-e2e-2b70'
const ACCOUNT = { accountId: 'customer_a' }
const PROJECT = '/v2/projects/proj_PLACEHOLDER'
const SUBSCRIPTION = 'sub_PLACEHOLDER_1'

interface Running {
  readonly module: TestingModule
  readonly service: SubscriptionService
  readonly stand: StandIn
}

let running: Running

/** The customer's lists with the store and renewal status of its one subscription changed. */
function customerOf(
  store: string,
  renewal: string,
  periodEndsAt?: number
): ReturnType<typeof fixtureLists> {
  const lists = fixtureLists('active-subscription')
  const subscriptions: Record<string, unknown> = Object(lists.subscriptions)
  const items: unknown = subscriptions['items']
  const first: Record<string, unknown> = Object(Array.isArray(items) ? items[0] : {})
  return {
    ...lists,
    subscriptions: {
      ...subscriptions,
      items: [
        {
          ...first,
          store,
          auto_renewal_status: renewal,
          ...(periodEndsAt === undefined ? {} : { current_period_ends_at: periodEndsAt }),
          management_url: `https://manage.example/${store}`
        }
      ]
    }
  }
}

/** Boots the application over a stand-in that serves the customer as given. */
async function boot(store: string, withV1 = true): Promise<Running> {
  const stand = await startStandIn(KEY)
  stand.serve(ACCOUNT.accountId, customerOf(store, 'will_renew'))
  const clock = new ManualClock('2026-11-25T12:00:00.000Z')
  const module = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source: revenueCatSource({
          projectId: 'proj_PLACEHOLDER',
          apiKey: KEY,
          ...(withV1 ? { apiKeyV1: KEY_V1 } : {}),
          baseUrl: stand.baseUrl,
          clock
        }),
        store: new InMemorySubscriptionStore({ logger: () => undefined }),
        clock,
        accountResolver: () => null
      })
    ]
  }).compile()
  const service = module.get(SubscriptionService)
  await service.refresh(ACCOUNT)
  return { module, service, stand }
}

/** The requests of the stand-in that change something. */
function writes(stand: StandIn): StandInRequest[] {
  return stand.requests.filter((request) => request.method !== 'GET')
}

/** Answers the read of the subscription itself, and a write by `onWrite`. */
function serving(
  store: string,
  onWrite: (request: StandInRequest) => StandInAnswer
): (request: StandInRequest) => StandInAnswer | undefined {
  return (request) => {
    if (request.url === `${PROJECT}/subscriptions/${SUBSCRIPTION}`) {
      return {
        status: 200,
        body: { store, store_subscription_identifier: 'store_sub_PLACEHOLDER_1' }
      }
    }
    return request.method === 'POST' ? onWrite(request) : undefined
  }
}

afterEach(async () => {
  await running.module.close()
  await running.stand.close()
})

describe('revenuecat management: stop renewal', () => {
  it('stops a Google Play renewal with one version 1 write and returns the customer read back', async () => {
    // Scenario: the cancel goes to version 1; the stand-in then serves the customer as no longer
    // renewing, and that read is the result.
    running = await boot('play_store')
    const { service, stand } = running
    stand.respondWith(
      serving('play_store', () => {
        stand.serve(ACCOUNT.accountId, customerOf('play_store', 'will_not_renew'))
        return { status: 200, body: { subscriber: {} } }
      })
    )
    const result = await service.stopRenewal(ACCOUNT, SUBSCRIPTION)
    expect(result.outcome).toBe('stopped')
    if (!('snapshot' in result)) throw new Error('Google Play allows it')
    expect(result.snapshot.subscriptions[0]?.willRenew).toBe('no')
    expect(writes(stand).map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      'POST /v1/subscribers/customer_a/subscriptions/store_sub_PLACEHOLDER_1/cancel'
    ])
    expect(writes(stand).map((request) => request.authorization)).toStrictEqual([
      `Bearer ${KEY_V1}`
    ])
    const version2 = stand.requests.filter((request) => request.url.startsWith('/v2/'))
    expect(version2.every((request) => request.authorization === `Bearer ${KEY}`)).toBe(true)
  })

  it('stops a web billing renewal with one version 2 write', async () => {
    // Scenario: RevenueCat's own web billing; the origin is web and the store decides.
    running = await boot('rc_billing')
    const { service, stand } = running
    stand.respondWith(
      serving('rc_billing', () => {
        stand.serve(ACCOUNT.accountId, customerOf('rc_billing', 'will_not_renew'))
        return { status: 200, body: {} }
      })
    )
    expect((await service.stopRenewal(ACCOUNT, SUBSCRIPTION)).outcome).toBe('stopped')
    expect(writes(stand).map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `POST ${PROJECT}/subscriptions/${SUBSCRIPTION}/actions/cancel`
    ])
  })

  it.each([
    ['app_store', 'App Store'],
    ['stripe', 'Stripe tracked by RevenueCat']
  ])(
    'asks the person to act, with the management reference, and writes nothing for %s',
    async (store) => {
      // Scenario: not possible from a server; the reference of the read is returned.
      running = await boot(store)
      const { service, stand } = running
      stand.respondWith(serving(store, () => ({ status: 500 })))
      expect(await service.stopRenewal(ACCOUNT, SUBSCRIPTION)).toStrictEqual({
        outcome: 'person_must_act',
        managementReference: `https://manage.example/${store}`
      })
      expect(writes(stand)).toHaveLength(0)
    }
  )

  it('reports not stopped when RevenueCat accepted the request and the read-back still renews', async () => {
    // Scenario: the write answers 200 and the customer is unchanged.
    running = await boot('play_store')
    const { service, stand } = running
    stand.respondWith(serving('play_store', () => ({ status: 200, body: {} })))
    const result = await service.stopRenewal(ACCOUNT, SUBSCRIPTION)
    expect(result.outcome).toBe('not_stopped')
  })

  it('fails as source-unavailable, with no body or identifier in the error, when the operation is refused', async () => {
    // Scenario: a 4xx on the cancel; the stored snapshot is as it was.
    running = await boot('play_store')
    const { service, stand } = running
    stand.respondWith(
      serving('play_store', () => ({ status: 409, body: { message: 'sentinel-body-e2e-3c9' } }))
    )
    const before = await service.getSnapshot(ACCOUNT)
    const failure: unknown = await service
      .stopRenewal(ACCOUNT, SUBSCRIPTION)
      .catch((e: unknown) => e)
    expect(failure).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
    const shown = JSON.stringify(failure) + String(failure)
    for (const secret of ['sentinel-body-e2e-3c9', ACCOUNT.accountId, KEY]) {
      expect(shown).not.toContain(secret)
    }
    const after = await service.getSnapshot(ACCOUNT)
    expect(after.subscriptions).toStrictEqual(before.subscriptions)
  })

  it('answers the capabilities of each origin and store from the adapter', async () => {
    // Scenario: Appendix A.4 for stop renewal, through the service.
    const expected: ReadonlyArray<readonly [string, boolean]> = [
      ['play_store', true],
      ['rc_billing', true],
      ['stripe', false],
      ['app_store', false]
    ]
    for (const [store, possible] of expected) {
      running = await boot(store)
      running.stand.respondWith(serving(store, () => ({ status: 500 })))
      const answer = await running.service.getCapabilities(ACCOUNT, SUBSCRIPTION)
      expect(answer.possible.stop_renewal).toBe(possible)
      expect(answer.managementReference).toBe(`https://manage.example/${store}`)
      await running.module.close()
      await running.stand.close()
    }
    running = await boot('app_store')
  })
})

describe('revenuecat management: resume and change product', () => {
  it.each([
    ['play_store', 'resume'],
    ['rc_billing', 'resume'],
    ['app_store', 'resume'],
    ['stripe', 'resume'],
    ['play_store', 'change_product'],
    ['rc_billing', 'change_product'],
    ['app_store', 'change_product'],
    ['stripe', 'change_product']
  ] as const)(
    'answers %s as not possible for %s, with the management reference, and writes nothing',
    async (store, operation) => {
      // Scenario: RevenueCat documents no server operation for either, for any origin or store.
      running = await boot(store)
      const { service, stand } = running
      stand.respondWith(serving(store, () => ({ status: 500 })))
      const answer = await service.getCapabilities(ACCOUNT, SUBSCRIPTION)
      expect(answer.possible[operation]).toBe(false)
      const result =
        operation === 'resume'
          ? await service.resume(ACCOUNT, SUBSCRIPTION)
          : await service.changeProduct(ACCOUNT, SUBSCRIPTION, 'product_PLACEHOLDER_annual')
      expect(result).toStrictEqual({
        outcome: 'person_must_act',
        managementReference: `https://manage.example/${store}`
      })
      expect(writes(stand)).toHaveLength(0)
    }
  )
})

describe('revenuecat management: extend', () => {
  const PERIOD_END = 1797600000000
  const WEEK = 7 * 24 * 3600 * 1000

  it.each([
    ['play_store', 'Google Play', undefined],
    ['rc_billing', 'RevenueCat web billing', undefined],
    ['app_store', 'the App Store', 'customer_satisfaction' as const]
  ])(
    'extends %s with one version 2 write and returns the period read back',
    async (store, _label, reason) => {
      // Scenario: the write goes to the extend action with whole days; the stand-in then serves the
      // customer with a later period end, and that read is the result.
      running = await boot(store)
      const { service, stand } = running
      stand.respondWith(
        serving(store, () => {
          stand.serve(ACCOUNT.accountId, customerOf(store, 'will_renew', PERIOD_END + WEEK))
          return { status: 200, body: {} }
        })
      )
      const result = await service.extend(ACCOUNT, SUBSCRIPTION, { days: 7, reason })
      expect(result.outcome).toBe('extended')
      if (!('snapshot' in result)) throw new Error('the origin allows it')
      expect(Date.parse(result.snapshot.subscriptions[0]?.currentPeriodEnd ?? '')).toBe(
        PERIOD_END + WEEK
      )
      expect(writes(stand).map((request) => `${request.method} ${request.url}`)).toStrictEqual([
        `POST ${PROJECT}/subscriptions/${SUBSCRIPTION}/actions/extend`
      ])
      expect(JSON.parse(writes(stand)[0]?.body ?? '{}')).toStrictEqual({
        extend_by_days: 7,
        ...(reason === undefined ? {} : { extend_reason_code: reason })
      })
    }
  )

  it('reports not extended when RevenueCat accepted and the period did not move', async () => {
    // Scenario: the write answers 200 and the next read is the same period.
    running = await boot('play_store')
    const { service, stand } = running
    stand.respondWith(serving('play_store', () => ({ status: 200, body: {} })))
    expect((await service.extend(ACCOUNT, SUBSCRIPTION, { days: 7 })).outcome).toBe('not_extended')
  })

  it('refuses an App Store extension without a reason or past 90 days before any write', async () => {
    // Scenario: the origin's limits are checked ahead of the write, after the fresh read.
    running = await boot('app_store')
    const { service, stand } = running
    stand.respondWith(serving('app_store', () => ({ status: 500 })))
    for (const extension of [{ days: 7 }, { days: 91, reason: 'other' as const }]) {
      await expect(service.extend(ACCOUNT, SUBSCRIPTION, extension)).rejects.toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
      })
    }
    expect(writes(stand)).toHaveLength(0)
  })

  it('asks the person to act for Stripe, and answers the capability per origin', async () => {
    // Scenario: Stripe is not listed as extendable; the capability column says the same.
    running = await boot('stripe')
    const { service, stand } = running
    stand.respondWith(serving('stripe', () => ({ status: 500 })))
    expect((await service.getCapabilities(ACCOUNT, SUBSCRIPTION)).possible.extend).toBe(false)
    expect(await service.extend(ACCOUNT, SUBSCRIPTION, { days: 7 })).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/stripe'
    })
    expect(writes(stand)).toHaveLength(0)
  })
})

/** What a customer's refund state looks like in the lists: refunded or not. */
interface Refundable {
  readonly store: string
  readonly refunded: boolean
}

/**
 * A customer with one subscription and one purchase of the same store. Refunded, the subscription
 * ended before its paid period did and gives no access, and the purchase says so by its status.
 */
function refundCustomer(held: Refundable): ReturnType<typeof fixtureLists> {
  const base = customerOf(held.store, 'will_renew')
  const subscriptions: Record<string, unknown> = Object(base.subscriptions)
  const first: Record<string, unknown> = Object(
    Array.isArray(subscriptions['items']) ? subscriptions['items'][0] : {}
  )
  const purchase: Record<string, unknown> = Object(
    Array.isArray(Object(fixtureLists('non-renewing-purchase').purchases)['items'])
      ? Object(fixtureLists('non-renewing-purchase').purchases)['items'][0]
      : {}
  )
  const subscription = held.refunded
    ? { ...first, gives_access: false, status: 'expired', ends_at: 1797500000000 }
    : first
  return {
    subscriptions: { ...subscriptions, items: [subscription] },
    purchases: {
      object: 'list',
      items: [
        {
          ...purchase,
          store: held.store,
          status: held.refunded ? 'refunded' : 'owned',
          store_purchase_identifier: 'store_purchase_PLACEHOLDER_1'
        }
      ],
      next_page: null,
      url: ''
    },
    activeEntitlements: held.refunded
      ? { object: 'list', items: [], next_page: null, url: '' }
      : base.activeEntitlements
  }
}

/** Serves the stores' reads and the transactions list, and a write by `onWrite`. */
function refunding(
  store: string,
  onWrite: (request: StandInRequest) => StandInAnswer
): (request: StandInRequest) => StandInAnswer | undefined {
  return (request) => {
    if (request.url.startsWith(`${PROJECT}/subscriptions/${SUBSCRIPTION}/transactions?`)) {
      return { status: 200, body: { items: [{ id: 'txn_PLACEHOLDER_9' }], next_page: null } }
    }
    if (request.url === `${PROJECT}/purchases/purchase_PLACEHOLDER_1`) {
      return {
        status: 200,
        body: { store, store_purchase_identifier: 'store_purchase_PLACEHOLDER_1' }
      }
    }
    return serving(store, onWrite)(request)
  }
}

describe('revenuecat management: refund', () => {
  it.each([
    [
      'play_store',
      SUBSCRIPTION,
      `POST ${PROJECT}/subscriptions/${SUBSCRIPTION}/transactions/txn_PLACEHOLDER_9/actions/refund`
    ],
    ['rc_billing', SUBSCRIPTION, `POST ${PROJECT}/subscriptions/${SUBSCRIPTION}/actions/refund`],
    [
      'rc_billing',
      'purchase_PLACEHOLDER_1',
      `POST ${PROJECT}/purchases/purchase_PLACEHOLDER_1/actions/refund`
    ],
    [
      'play_store',
      'purchase_PLACEHOLDER_1',
      'POST /v1/subscribers/customer_a/transactions/store_purchase_PLACEHOLDER_1/refund'
    ]
  ])(
    'refunds on %s: %s with one write, and the result is the customer read back',
    async (store, reference, write) => {
      // Scenario: the write goes where the documentation sends it; the stand-in then serves the
      // customer as refunded, and that read is the result.
      running = await boot(store)
      const { service, stand } = running
      stand.serve(ACCOUNT.accountId, refundCustomer({ store, refunded: false }))
      await service.refresh(ACCOUNT)
      stand.respondWith(
        refunding(store, () => {
          stand.serve(ACCOUNT.accountId, refundCustomer({ store, refunded: true }))
          return { status: 200, body: {} }
        })
      )
      const result = await service.refund(ACCOUNT, reference)
      expect(result.outcome).toBe('refunded')
      expect(writes(stand).map((request) => `${request.method} ${request.url}`)).toStrictEqual([
        write
      ])
    }
  )

  it('reports not refunded when RevenueCat accepted and the read-back shows no refund', async () => {
    // Scenario: the write answers 200 and the customer is unchanged.
    running = await boot('rc_billing')
    const { service, stand } = running
    stand.serve(ACCOUNT.accountId, refundCustomer({ store: 'rc_billing', refunded: false }))
    await service.refresh(ACCOUNT)
    stand.respondWith(refunding('rc_billing', () => ({ status: 200, body: {} })))
    expect((await service.refund(ACCOUNT, SUBSCRIPTION)).outcome).toBe('not_refunded')
  })

  it.each([
    ['app_store', SUBSCRIPTION],
    ['app_store', 'purchase_PLACEHOLDER_1'],
    ['stripe', SUBSCRIPTION],
    ['stripe', 'purchase_PLACEHOLDER_1']
  ])('asks the person to act and writes nothing for %s: %s', async (store, reference) => {
    // Scenario: Apple and Stripe refunds are done outside RevenueCat.
    running = await boot(store)
    const { service, stand } = running
    stand.serve(ACCOUNT.accountId, refundCustomer({ store, refunded: false }))
    await service.refresh(ACCOUNT)
    stand.respondWith(refunding(store, () => ({ status: 500 })))
    expect((await service.getCapabilities(ACCOUNT, reference)).possible.refund).toBe(false)
    expect((await service.refund(ACCOUNT, reference)).outcome).toBe('person_must_act')
    expect(writes(stand)).toHaveLength(0)
  })

  it('fails as source-unavailable, with no body or identifier in the error, when the refund is refused', async () => {
    // Scenario: a 4xx on the refund of a Google Play purchase through version 1.
    running = await boot('play_store')
    const { service, stand } = running
    stand.serve(ACCOUNT.accountId, refundCustomer({ store: 'play_store', refunded: false }))
    await service.refresh(ACCOUNT)
    stand.respondWith(
      refunding('play_store', () => ({
        status: 422,
        body: { message: 'sentinel-body-refund-e2e' }
      }))
    )
    const failure: unknown = await service
      .refund(ACCOUNT, 'purchase_PLACEHOLDER_1')
      .catch((e: unknown) => e)
    expect(failure).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
    const shown = JSON.stringify(failure) + String(failure)
    for (const secret of [
      'sentinel-body-refund-e2e',
      ACCOUNT.accountId,
      KEY,
      'store_purchase_PLACEHOLDER_1'
    ]) {
      expect(shown).not.toContain(secret)
    }
  })
})

describe('revenuecat management: the adapter asked directly', () => {
  /** The adapter over the running stand-in, and the records its read of the customer holds. */
  async function adapterOver(
    store: string,
    reading: unknown
  ): Promise<{
    source: ReturnType<typeof revenueCatSource>
    stand: StandIn
    subscription: SubscriptionRecord
    purchase: NonRenewingPurchaseRecord
  }> {
    running = await boot(store)
    const { stand } = running
    stand.serve(ACCOUNT.accountId, refundCustomer({ store, refunded: false }))
    stand.respondWith((request) => {
      const reads =
        request.method === 'GET' &&
        (request.url.startsWith(`${PROJECT}/subscriptions/`) ||
          request.url.startsWith(`${PROJECT}/purchases/`))
      if (reads) return { status: 200, body: reading }
      return request.method === 'POST' ? { status: 200, body: {} } : undefined
    })
    const source = revenueCatSource({
      projectId: 'proj_PLACEHOLDER',
      apiKey: KEY,
      apiKeyV1: KEY_V1,
      baseUrl: stand.baseUrl
    })
    const snapshot = await source.readAccount(ACCOUNT)
    const subscription = snapshot.subscriptions[0]
    const purchase = snapshot.nonRenewingPurchases?.[0]
    if (subscription === undefined || purchase === undefined) throw new Error('both records exist')
    return { source, stand, subscription, purchase }
  }

  it.each([
    [
      'app_store',
      'a stop',
      (s: ReturnType<typeof revenueCatSource>, a: SubscriptionRecord) => s.stopRenewal(ACCOUNT, a)
    ],
    [
      'stripe',
      'a stop',
      (s: ReturnType<typeof revenueCatSource>, a: SubscriptionRecord) => s.stopRenewal(ACCOUNT, a)
    ],
    [
      'stripe',
      'an extension',
      (s: ReturnType<typeof revenueCatSource>, a: SubscriptionRecord) =>
        s.extend?.(ACCOUNT, a, { days: 3 })
    ],
    [
      'stripe',
      'a refund',
      (s: ReturnType<typeof revenueCatSource>, a: SubscriptionRecord) =>
        s.refund?.(ACCOUNT, { kind: 'subscription', record: a })
    ],
    [
      'app_store',
      'a refund',
      (s: ReturnType<typeof revenueCatSource>, a: SubscriptionRecord) =>
        s.refund?.(ACCOUNT, { kind: 'subscription', record: a })
    ]
  ])(
    'answers %s: %s as not possible with no write, whatever the caller checked first',
    async (store, _label, act) => {
      // Scenario: the adapter does not rely on the service having asked for capabilities.
      const { source, stand, subscription } = await adapterOver(store, { store })
      expect(await act(source, subscription)).toMatchObject({ outcome: 'customer_action_required' })
      expect(writes(stand)).toHaveLength(0)
    }
  )

  it.each([
    ['a Google Play stop whose subscription names no store identifier', 'play_store', 'stop'],
    [
      'a Google Play purchase refund whose purchase names no store identifier',
      'play_store',
      'purchase'
    ],
    ['a store read that is not an object', 'play_store', 'list']
  ])('fails as unavailable, without a write, for %s', async (_label, store, kind) => {
    // Scenario: what the next request needs is missing from RevenueCat's answer.
    const reading = kind === 'list' ? [] : { store }
    const { source, stand, subscription, purchase } = await adapterOver(store, reading)
    const attempt =
      kind === 'purchase'
        ? source.refund?.(ACCOUNT, { kind: 'purchase', record: purchase })
        : source.stopRenewal(ACCOUNT, subscription)
    await expect(attempt).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(writes(stand)).toHaveLength(0)
  })

  it('fails as unavailable when the newest transaction of a Google Play subscription is missing or unnamed', async () => {
    // Scenario: the transactions list is empty, then holds an item with no id.
    const { source, stand, subscription } = await adapterOver('play_store', { store: 'play_store' })
    for (const items of [[], [{ nope: 1 }], [7]]) {
      stand.respondWith((request) =>
        request.url.includes('/transactions?')
          ? { status: 200, body: { items, next_page: null } }
          : undefined
      )
      await expect(
        source.refund?.(ACCOUNT, { kind: 'subscription', record: subscription })
      ).rejects.toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
    }
    expect(writes(stand)).toHaveLength(0)
  })

  it('derives the version 1 address from a base address that does not end in /v2', async () => {
    running = await boot('app_store')
    // Scenario: the adapter builds with a bare host; no request is made.
    expect(() =>
      revenueCatSource({
        projectId: 'proj_PLACEHOLDER',
        apiKey: KEY,
        baseUrl: 'http://127.0.0.1:9'
      })
    ).not.toThrow()
  })
})

describe('revenuecat management: without a version 1 key', () => {
  it("answers Google Play stop renewal and purchase refund as the person's, with no request, and says so in the capabilities", async () => {
    // Scenario: no apiKeyV1: the two operations that exist only in version 1 are not possible,
    // and the version 2 key is never offered to version 1.
    running = await boot('play_store', false)
    const { service, stand } = running
    stand.serve(ACCOUNT.accountId, refundCustomer({ store: 'play_store', refunded: false }))
    await service.refresh(ACCOUNT)
    stand.respondWith(refunding('play_store', () => ({ status: 500 })))
    const before = stand.requests.length
    expect((await service.getCapabilities(ACCOUNT, SUBSCRIPTION)).possible).toMatchObject({
      stop_renewal: false,
      extend: true,
      refund: true
    })
    expect((await service.getCapabilities(ACCOUNT, 'purchase_PLACEHOLDER_1')).possible.refund).toBe(
      false
    )
    expect(await service.stopRenewal(ACCOUNT, SUBSCRIPTION)).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/play_store'
    })
    expect(await service.refund(ACCOUNT, 'purchase_PLACEHOLDER_1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: null
    })
    expect(stand.requests).toHaveLength(before)
    expect(stand.requests.some((request) => request.url.startsWith('/v1/'))).toBe(false)
  })

  it('hands out no version 1 client when none was configured', async () => {
    running = await boot('app_store')
    // Scenario: the guard that keeps the version 2 key from standing in for a version 1 key.
    const http = new RevenueCatHttp({
      baseUrl: 'http://127.0.0.1:9/v2',
      apiKey: new Secret(KEY),
      timeoutMs: 1000,
      fetch: () => Promise.reject(new Error('no request is made'))
    })
    expect(() => versionOne({ http, httpV1: null, projectId: 'proj_PLACEHOLDER' })).toThrow(
      expect.objectContaining({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
    )
  })
})
