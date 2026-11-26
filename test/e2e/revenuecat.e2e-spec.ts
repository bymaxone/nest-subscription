/**
 * @fileoverview The RevenueCat adapter end to end through the real service: the adapter reads a
 * local stand-in for the RevenueCat API through its `baseUrl` option, which is the only HTTP the
 * suite uses. One-time purchases that grant an entitlement give it through the service, with the
 * instant RevenueCat reports or none for a lifetime grant; a consumable grants nothing; a refund
 * removes the access and is reported through the existing change kinds.
 * @layer e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import {
  SubscriptionModule,
  SubscriptionService,
  type SubscriptionChangeNotification
} from '@bymax-one/nest-subscription'
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'
import { InMemorySubscriptionStore, ManualClock } from '@bymax-one/nest-subscription/testing'

import { fixtureLists, startStandIn, type StandIn } from './fixtures/revenuecat-stand-in'

const KEY = 'sentinel-api-key-e2e-1f3c'
const ACCOUNT = { accountId: 'customer_a' }
const START = '2026-11-25T12:00:00.000Z'

interface Running {
  readonly module: TestingModule
  readonly service: SubscriptionService
  readonly stand: StandIn
  readonly clock: ManualClock
  readonly notifications: SubscriptionChangeNotification[]
}

let running: Running

/** Boots the application with the RevenueCat adapter pointed at a fresh stand-in. */
async function boot(
  sourceOptions: Partial<Parameters<typeof revenueCatSource>[0]> = {}
): Promise<Running> {
  const stand = await startStandIn(KEY)
  const clock = new ManualClock(START)
  const notifications: SubscriptionChangeNotification[] = []
  const module = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source: revenueCatSource({
          projectId: 'proj_PLACEHOLDER',
          apiKey: KEY,
          baseUrl: stand.baseUrl,
          clock,
          ...sourceOptions
        }),
        store: new InMemorySubscriptionStore({ logger: () => undefined }),
        clock,
        accountResolver: () => null,
        onChange: (notification) => void notifications.push(notification)
      })
    ]
  }).compile()
  return { module, service: module.get(SubscriptionService), stand, clock, notifications }
}

afterEach(async () => {
  await running.module.close()
  await running.stand.close()
})

describe('the RevenueCat adapter with non-renewing purchases, through the service', () => {
  it('gives an active entitlement with no end for a lifetime purchase', async () => {
    // Scenario: D31: the recorded lifetime purchase grants its entitlement for ever.
    running = await boot()
    running.stand.serveFixture('customer_a', 'lifetime-purchase')
    const snapshot = await running.service.refresh(ACCOUNT)
    expect(snapshot.entitlements).toStrictEqual([
      {
        name: 'premium',
        active: true,
        until: null,
        grantingSubscriptionReference: 'purchase_PLACEHOLDER_1',
        grantingSubscriptionReferences: ['purchase_PLACEHOLDER_1']
      }
    ])
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
  })

  it('gives an active entitlement until the instant RevenueCat reports for a term purchase', async () => {
    // Scenario: the recorded year pass has an expiry on its entitlement.
    running = await boot()
    running.stand.serveFixture('customer_a', 'non-renewing-purchase')
    const snapshot = await running.service.refresh(ACCOUNT)
    expect(snapshot.entitlements[0]).toMatchObject({
      name: 'premium',
      active: true,
      until: '2026-12-18T13:20:00.000Z'
    })
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
  })

  it('stops giving the entitlement of a term purchase once the clock passes its end', async () => {
    // Scenario: D36: the entitlement is active only while its end is later than now, by the clock.
    running = await boot()
    running.stand.serveFixture('customer_a', 'non-renewing-purchase')
    await running.service.refresh(ACCOUNT)
    running.clock.set('2026-12-18T13:20:00.001Z')
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
  })

  it('grants nothing for a consumable', async () => {
    // Scenario: D31: a purchase whose entitlement list is empty is not held.
    running = await boot()
    running.stand.serveFixture('customer_a', 'consumable-purchase')
    const snapshot = await running.service.refresh(ACCOUNT)
    expect(snapshot.entitlements).toStrictEqual([])
    expect(snapshot.nonRenewingPurchases).toStrictEqual([])
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
  })

  it('removes the access of a refunded purchase on the next read and reports the grant and the refund', async () => {
    // Scenario: the grant is a start; the refund is a refund and an expiry, through the existing kinds.
    running = await boot()
    running.stand.serveFixture('customer_a', 'lifetime-purchase')
    await running.service.refresh(ACCOUNT)
    expect(running.notifications.at(-1)?.changes.map((change) => change.kind)).toStrictEqual([
      'started'
    ])
    running.clock.advance(60_000)
    running.stand.serveFixture('customer_a', 'refunded-purchase')
    await running.service.refresh(ACCOUNT)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
    expect(running.notifications.at(-1)?.changes.map((change) => change.kind)).toStrictEqual([
      'expired',
      'refunded'
    ])
  })

  it('gives nothing for a sandbox purchase RevenueCat reports as active, and the entitlement when sandbox is allowed', async () => {
    // Scenario: AC06 for purchases, both configurations.
    running = await boot()
    running.stand.serveFixture('customer_a', 'sandbox-purchase')
    await running.service.refresh(ACCOUNT)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
    await running.module.close()
    await running.stand.close()
    running = await boot({ allowSandbox: true })
    running.stand.serveFixture('customer_a', 'sandbox-purchase')
    await running.service.refresh(ACCOUNT)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
  })

  it('gives one active entitlement, with the latest end, when a subscription and a purchase grant it', async () => {
    // Scenario: FR05 with a purchase: the lifetime purchase outranks the dated subscription.
    running = await boot()
    running.stand.serve('customer_a', {
      subscriptions: fixtureLists('active-subscription').subscriptions,
      purchases: fixtureLists('lifetime-purchase').purchases,
      activeEntitlements: fixtureLists('lifetime-purchase').activeEntitlements
    })
    const snapshot = await running.service.refresh(ACCOUNT)
    expect(snapshot.entitlements).toHaveLength(1)
    expect(snapshot.entitlements[0]).toMatchObject({
      until: null,
      grantingSubscriptionReferences: ['purchase_PLACEHOLDER_1', 'sub_PLACEHOLDER_1']
    })
  })

  it('keeps the stored entitlement when a later request of a refresh answers 404', async () => {
    // Scenario: a subscription's entitlement list disappears between two requests of one read: the
    // refresh fails, the stored snapshot still grants access and no change is delivered.
    running = await boot()
    const list = (items: unknown[]): unknown => ({ object: 'list', items, next_page: null })
    const entitlements = list([{ id: 'entl_1', lookup_key: 'premium' }])
    running.stand.serve('customer_a', {
      subscriptions: list([
        {
          id: 's1',
          status: 'active',
          gives_access: true,
          environment: 'production',
          store: 'app_store'
        }
      ])
    })
    let present = true
    running.stand.respondWith((request) =>
      request.url.includes('/subscriptions/s1/entitlements')
        ? present
          ? { status: 200, body: entitlements }
          : { status: 404, body: { type: 'resource_missing' } }
        : undefined
    )
    await running.service.refresh(ACCOUNT)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
    const delivered = running.notifications.length
    present = false
    running.clock.advance(60_000)
    await expect(running.service.refresh(ACCOUNT)).rejects.toMatchObject({
      code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE'
    })
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
    expect(running.notifications).toHaveLength(delivered)
    expect(
      running.notifications.flatMap((entry) => entry.changes.map((change) => change.kind))
    ).toStrictEqual(['started'])
  })

  it('reads the stand-in with the key and nowhere else', async () => {
    // Scenario: every request is to the stand-in's address, with the bearer key.
    running = await boot()
    running.stand.serveFixture('customer_a', 'lifetime-purchase')
    await running.service.refresh(ACCOUNT)
    expect(running.stand.requests.length).toBeGreaterThan(0)
    expect(
      running.stand.requests.every((request) => request.authorization === `Bearer ${KEY}`)
    ).toBe(true)
    expect(
      running.stand.requests.every((request) =>
        request.url.startsWith('/v2/projects/proj_PLACEHOLDER/customers/customer_a/')
      )
    ).toBe(true)
  })
})
