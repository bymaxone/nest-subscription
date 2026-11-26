/**
 * @fileoverview The RevenueCat management operations end to end through the real service and the
 * local stand-in for the API: which origin and store allows which operation, the one write each
 * operation makes and the version it goes to, and that the result is the customer read back.
 * @layer e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import {
  SUBSCRIPTION_ERROR_CODES,
  SubscriptionModule,
  SubscriptionService
} from '@bymax-one/nest-subscription'
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'
import { InMemorySubscriptionStore, ManualClock } from '@bymax-one/nest-subscription/testing'

import {
  fixtureLists,
  startStandIn,
  type StandIn,
  type StandInAnswer,
  type StandInRequest
} from './fixtures/revenuecat-stand-in'

const KEY = 'sentinel-api-key-e2e-8a41'
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
function customerOf(store: string, renewal: string): ReturnType<typeof fixtureLists> {
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
          management_url: `https://manage.example/${store}`
        }
      ]
    }
  }
}

/** Boots the application over a stand-in that serves the customer as given. */
async function boot(store: string): Promise<Running> {
  const stand = await startStandIn(KEY)
  stand.serve(ACCOUNT.accountId, customerOf(store, 'will_renew'))
  const clock = new ManualClock('2026-11-25T12:00:00.000Z')
  const module = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source: revenueCatSource({
          projectId: 'proj_PLACEHOLDER',
          apiKey: KEY,
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
    if (result.outcome === 'person_must_act') throw new Error('Google Play allows it')
    expect(result.snapshot.subscriptions[0]?.willRenew).toBe('no')
    expect(writes(stand).map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      'POST /v1/subscribers/customer_a/subscriptions/store_sub_PLACEHOLDER_1/cancel'
    ])
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
