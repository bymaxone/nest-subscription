/**
 * @fileoverview The RevenueCat adapter behind the real webhook controller, against a local
 * stand-in for the RevenueCat API. Recorded notifications, built and signed by the testing
 * subpath, drive the acceptance cases: a purchase yields an entitlement read from the source
 * (AC01), a refund removes it and is reported (AC05), a sandbox purchase grants nothing (AC06),
 * every kind of invalid request is refused with one answer and changes nothing (AC02), a
 * non-renewing purchase grants through the receiver and a consumable does not (D31), the payload's
 * own state is never applied (SEC01), and no secret or identifier reaches a log or an observer
 * payload.
 * @layer e2e
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'

import { Test, type TestingModule } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import {
  SubscriptionModule,
  SubscriptionService,
  encodeAccountKey,
  toHttpAnswer,
  type SubscriptionChangeNotification
} from '@bymax-one/nest-subscription'
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'
import {
  InMemorySubscriptionStore,
  ManualClock,
  REVENUECAT_REQUEST_FLAWS,
  assertNoSentinel,
  buildRevenueCatWebhookRequest,
  createCapture,
  type Capture,
  type RevenueCatRequestFlaw
} from '@bymax-one/nest-subscription/testing'

import { watch } from './setup/sentinel-sweep'
import { outputsOf } from './fixtures/sentinel-sweep'
import { startStandIn, type StandIn } from './fixtures/revenuecat-stand-in'

const API_KEY = 'sentinel-api-key-e2e-1f3c'
const SIGNING = 'sentinel-signing-secret-e2e-90ab'
const AUTHORIZATION = 'sentinel-authorization-e2e-77de'
const ROUTE = '/webhooks/revenuecat'
const START = '2026-11-25T12:00:00.000Z'
const USER = 'user_PLACEHOLDER_a'
const ACCOUNT = { accountId: USER }
const REFUSED = toHttpAnswer({ kind: 'refused' })

interface Running {
  readonly app: INestApplication
  readonly module: TestingModule
  readonly service: SubscriptionService
  readonly store: InMemorySubscriptionStore
  readonly stand: StandIn
  readonly clock: ManualClock
  readonly capture: Capture
  readonly notifications: SubscriptionChangeNotification[]
}

let running: Running

/** The body of a recorded webhook fixture. */
function eventFixture(name: string): unknown {
  const parsed: unknown = JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'revenuecat', `${name}.json`), 'utf8')
  )
  return parsed
}

/** Boots the receiver with the adapter pointed at a fresh stand-in. */
async function boot(allowSandbox = false): Promise<Running> {
  const stand = await startStandIn(API_KEY)
  const clock = new ManualClock(START)
  const capture = createCapture()
  watch(capture)
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const notifications: SubscriptionChangeNotification[] = []
  const module = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source: revenueCatSource({
          projectId: 'proj_PLACEHOLDER',
          apiKey: API_KEY,
          baseUrl: stand.baseUrl,
          webhookAuthorization: AUTHORIZATION,
          webhookSigningSecret: SIGNING,
          allowSandbox,
          clock
        }),
        store,
        clock,
        accountResolver: () => null,
        onChange: (notification) => void notifications.push(notification),
        logger: capture.logger,
        observer: capture.observer,
        webhookController: true,
        webhookPath: ROUTE
      })
    ]
  }).compile()
  const app = module.createNestApplication({ rawBody: true })
  await app.init()
  return {
    app,
    module,
    service: module.get(SubscriptionService),
    store,
    stand,
    clock,
    capture,
    notifications
  }
}

/** Sends a built request to the controller and returns the status and the body. */
async function deliver(
  current: Running,
  name: string,
  flaw?: RevenueCatRequestFlaw
): Promise<{ status: number; body: unknown }> {
  const built = buildRevenueCatWebhookRequest({
    body: eventFixture(name),
    signingSecret: SIGNING,
    authorization: AUTHORIZATION,
    now: current.clock.now(),
    ...(flaw === undefined ? {} : { flaw })
  })
  let call = request(current.app.getHttpServer()).post(ROUTE)
  for (const [header, value] of Object.entries(built.headers)) {
    if (value !== undefined) call = call.set(header, value)
  }
  const response = await call.send(Buffer.from(built.rawBody).toString('utf8'))
  return { status: response.status, body: response.body as unknown }
}

afterEach(async () => {
  await running.app.close()
  await running.stand.close()
})

describe('a purchase notification behind the controller (AC01)', () => {
  it('yields an active entitlement read from the source, with one read, and tells the host', async () => {
    // Scenario: the recorded purchase is signed and delivered; the entitlement comes from the stand-in.
    running = await boot()
    running.stand.serveFixture(USER, 'active-subscription')
    const answer = await deliver(running, 'webhook-initial-purchase')
    expect(answer).toStrictEqual({ status: 200, body: { outcome: 'processed', accounts: 1 } })
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
    expect(running.stand.requests.filter((r) => r.url.includes('/subscriptions'))).toHaveLength(1)
    expect(running.notifications.at(-1)?.changes.map((change) => change.kind)).toStrictEqual([
      'started'
    ])
  })

  it('applies nothing the payload says: a purchase the source does not know gives no entitlement', async () => {
    // Scenario: SEC01: the notification says a purchase happened, the source has no customer.
    running = await boot()
    const answer = await deliver(running, 'webhook-initial-purchase')
    expect(answer.status).toBe(200)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
    expect((await running.service.getSnapshot(ACCOUNT)).subscriptions).toStrictEqual([])
  })

  it('refreshes both accounts of a transfer, and an event of a kind nobody has seen', async () => {
    // Scenario: the destination and the source of a transfer are both read; an unknown kind refreshes.
    running = await boot()
    running.stand.serveFixture('user_PLACEHOLDER_a', 'empty-customer')
    running.stand.serveFixture('user_PLACEHOLDER_b', 'active-subscription')
    expect((await deliver(running, 'webhook-transfer')).body).toStrictEqual({
      outcome: 'processed',
      accounts: 2
    })
    expect(
      await running.service.hasEntitlement({ accountId: 'user_PLACEHOLDER_b' }, 'premium')
    ).toBe(true)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
    expect((await deliver(running, 'webhook-unknown-kind')).body).toStrictEqual({
      outcome: 'processed',
      accounts: 1
    })
  })

  it('accepts an event that names only an anonymous identifier, reads nothing and tells the host without it', async () => {
    // Scenario: recorded and reported, never dropped silently, with no identifier in the report.
    running = await boot()
    const answer = await deliver(running, 'webhook-anonymous-only')
    expect(answer).toStrictEqual({ status: 200, body: { outcome: 'ignored' } })
    expect(running.stand.requests).toHaveLength(0)
  })
})

describe('a refund notification behind the controller (AC05)', () => {
  it('removes access on the next refresh and reports the refund', async () => {
    // Scenario: the subscription gives access; a refund is delivered and the source now shows it ended early.
    running = await boot()
    running.stand.serveFixture(USER, 'active-subscription')
    await running.service.refresh(ACCOUNT)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
    running.clock.advance(60_000)
    running.stand.serveFixture(USER, 'refunded-subscription')
    expect((await deliver(running, 'webhook-refund')).status).toBe(200)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
    expect(running.notifications.at(-1)?.changes.map((change) => change.kind)).toContain('refunded')
  })
})

describe('a sandbox notification behind the controller (AC06)', () => {
  it('grants nothing under the default configuration, though the source reports the entitlement as active', async () => {
    // Scenario: RevenueCat's default grants sandbox purchases; the adapter filters them itself.
    running = await boot()
    running.stand.serveFixture(USER, 'sandbox-subscription')
    expect((await deliver(running, 'webhook-sandbox-purchase')).status).toBe(200)
    const snapshot = await running.service.getSnapshot(ACCOUNT)
    expect(snapshot.subscriptions[0]).toMatchObject({ environment: 'sandbox', givesAccess: false })
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
  })

  it('grants the entitlement when the host enabled sandbox access', async () => {
    // Scenario: the same notification with the option on.
    running = await boot(true)
    running.stand.serveFixture(USER, 'sandbox-subscription')
    await deliver(running, 'webhook-sandbox-purchase')
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
  })
})

describe('an invalid request behind the controller (AC02)', () => {
  it.each(REVENUECAT_REQUEST_FLAWS)(
    'refuses the flaw %s with the one answer and changes nothing',
    async (flaw) => {
      // Scenario: each flaw the builder can make, delivered; the answer is the fixed refusal, the
      // source is not read, nothing is stored and the host hook is not called.
      running = await boot()
      running.stand.serveFixture(USER, 'active-subscription')
      expect(await deliver(running, 'webhook-initial-purchase', flaw)).toStrictEqual({
        status: REFUSED.status,
        body: REFUSED.body
      })
      expect(running.stand.requests).toHaveLength(0)
      expect(await running.store.getSnapshot(encodeAccountKey(ACCOUNT))).toBeNull()
      expect(running.notifications).toHaveLength(0)
    }
  )

  it('accepts the same request without the flaw', async () => {
    // Scenario: the control for the table above.
    running = await boot()
    running.stand.serveFixture(USER, 'active-subscription')
    expect((await deliver(running, 'webhook-initial-purchase')).status).toBe(200)
  })
})

describe('a non-renewing purchase notification behind the controller (D31)', () => {
  it('yields an active entitlement with no end for a lifetime purchase', async () => {
    // Scenario: the recorded purchase event, the recorded lifetime purchase from the source.
    running = await boot()
    running.stand.serveFixture(USER, 'lifetime-purchase')
    expect((await deliver(running, 'webhook-non-renewing-purchase')).status).toBe(200)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(true)
    expect((await running.service.getSnapshot(ACCOUNT)).entitlements[0]).toMatchObject({
      until: null
    })
  })

  it('grants nothing for a consumable', async () => {
    // Scenario: the same event for a customer whose purchase grants no entitlement.
    running = await boot()
    running.stand.serveFixture(USER, 'consumable-purchase')
    expect((await deliver(running, 'webhook-non-renewing-purchase')).status).toBe(200)
    expect(await running.service.hasEntitlement(ACCOUNT, 'premium')).toBe(false)
    expect((await running.service.getSnapshot(ACCOUNT)).nonRenewingPurchases).toStrictEqual([])
  })
})

describe('what the receiver, the adapter and the logs hold', () => {
  it('shows no secret on the sweep paths of the service, and none in a log line or an observer payload', async () => {
    // Scenario: SEC05 and SEC06 end to end: every secret and the customer identifier are sentinels.
    running = await boot()
    running.stand.serveFixture(USER, 'active-subscription')
    await deliver(running, 'webhook-initial-purchase')
    await deliver(running, 'webhook-initial-purchase', 'wrong_signature')
    await running.service.refresh(ACCOUNT)
    const sentinels = [API_KEY, SIGNING, AUTHORIZATION]
    assertNoSentinel(running.capture, [...sentinels, USER])
    expect(running.capture.payloads.length).toBeGreaterThan(0)
    expectNoSentinelOf(running.service, sentinels)
    expectNoSentinelOf(running.module.get(SubscriptionService), sentinels)
    expect(inspect(running.service, { depth: null, showHidden: true })).not.toContain(API_KEY)
  })

  it('sends the key as a bearer credential with each request to the stand-in', async () => {
    // Scenario: the credential travels in the header of every request, to the loopback address only.
    running = await boot()
    running.stand.serveFixture(USER, 'active-subscription')
    await deliver(running, 'webhook-initial-purchase')
    expect(running.stand.requests.length).toBeGreaterThan(0)
    expect(running.stand.requests.every((r) => r.authorization === `Bearer ${API_KEY}`)).toBe(true)
  })
})

/** Fails when any path that can expose a value of the object shows one of the secrets. */
function expectNoSentinelOf(subject: object, secrets: readonly string[]): void {
  for (const output of outputsOf(subject)) {
    for (const secret of secrets) expect(output).not.toContain(secret)
  }
  expect(secrets.length).toBeGreaterThan(0)
}
