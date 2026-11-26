/**
 * @fileoverview Source parity (AC08): one host application, with one protected route, the webhook
 * controller with the raw body and one change hook, runs the same cases against the library's fake
 * source and against the RevenueCat adapter over HTTP to a local stand-in that serves recorded
 * fixtures. The only difference between the runs is the entry of the source list: the module
 * configuration, how it scripts the account and the signed request it builds. Adding another
 * source later is one more entry in that list and no change to a case or to the application.
 * @layer e2e
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import request from 'supertest'
import {
  SUBSCRIPTION_ERROR_CODES,
  type SubscriptionFailPolicy,
  type SubscriptionSource,
  type WebhookRequest
} from '@bymax-one/nest-subscription'
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'
import {
  FakeSubscriptionSource,
  ManualClock,
  buildRevenueCatWebhookRequest
} from '@bymax-one/nest-subscription/testing'

import {
  PARITY_ACCOUNT_HEADER,
  PARITY_ENTITLEMENT,
  PARITY_PREMIUM_ROUTE,
  PARITY_WEBHOOK_ROUTE,
  buildParityApp,
  type ParityApp
} from './fixtures/parity-app'
import { startStandIn } from './fixtures/revenuecat-stand-in'
import { snapshotOf } from './fixtures/guarded-app'

const START = '2026-11-25T12:00:00.000Z'
const DAY_MS = 86_400_000
const ACCOUNT = { accountId: 'user_PLACEHOLDER_a' }
const API_KEY = 'sentinel-parity-api-key-1a2b'
const SIGNING_SECRET = 'sentinel-parity-signing-3c4d'
const AUTHORIZATION = 'sentinel-parity-authorization-5e6f'

/** What an entry gives a run: the source to configure and the means to script it. */
interface Scripted {
  /** The module configuration that differs: the billing source. */
  readonly source: SubscriptionSource
  /** Makes the source report one subscription that grants the entitlement. */
  readonly grant: () => void
  /** Makes the source report an account with no subscription. */
  readonly empty: () => void
  /** Makes every later read of the source fail. */
  readonly breakSource: () => void
  /** The signed request that tells the host the account's subscription began. */
  readonly webhook: () => WebhookRequest
  /** How many times the source was read for the account. */
  readonly reads: () => number
  /** Releases what the entry started. */
  readonly close: () => Promise<void>
}

/** One billing source the suite runs against. */
interface SourceEntry {
  /** The name shown in the title of each case. */
  readonly name: string
  /** Builds the source on the clock and the means to script it. */
  readonly start: (clock: ManualClock) => Promise<Scripted>
}

/** The library's fake source, scripted through its own methods. */
const FAKE: SourceEntry = {
  name: 'the fake source',
  start: (clock) => {
    const source = new FakeSubscriptionSource({ clock })
    const fetchedAt = (): string => clock.now().toISOString()
    return Promise.resolve({
      source,
      grant: () =>
        source.setAccount(
          ACCOUNT,
          snapshotOf(ACCOUNT, {
            givesAccess: true,
            entitlement: PARITY_ENTITLEMENT,
            fetchedAt: fetchedAt()
          })
        ),
      empty: () =>
        source.setAccount(
          ACCOUNT,
          createEmptySnapshot({
            accountId: ACCOUNT.accountId,
            source: source.name,
            fetchedAt: fetchedAt()
          })
        ),
      breakSource: () => {
        for (let read = 0; read < 50; read += 1) source.failNextRead(new Error('source down'))
      },
      webhook: () =>
        source.buildRequest({
          eventId: 'event-parity-1',
          accountIds: [ACCOUNT.accountId],
          kind: 'INITIAL_PURCHASE',
          eventTime: START,
          environment: 'production'
        }),
      reads: () => source.readCount(ACCOUNT),
      close: () => Promise.resolve()
    })
  }
}

/** The RevenueCat adapter over HTTP to the local stand-in, scripted through recorded fixtures. */
const REVENUECAT: SourceEntry = {
  name: 'the RevenueCat adapter',
  start: async (clock) => {
    const stand = await startStandIn(API_KEY)
    const event: unknown = JSON.parse(
      readFileSync(
        join(__dirname, '..', 'fixtures', 'revenuecat', 'webhook-initial-purchase.json'),
        'utf8'
      )
    )
    return {
      source: revenueCatSource({
        projectId: 'proj_PLACEHOLDER',
        apiKey: API_KEY,
        baseUrl: stand.baseUrl,
        webhookAuthorization: AUTHORIZATION,
        webhookSigningSecret: SIGNING_SECRET,
        clock
      }),
      grant: () => stand.serveFixture(ACCOUNT.accountId, 'active-subscription'),
      empty: () => stand.serveFixture(ACCOUNT.accountId, 'empty-customer'),
      breakSource: () => stand.failWith(503),
      webhook: () =>
        buildRevenueCatWebhookRequest({
          body: event,
          signingSecret: SIGNING_SECRET,
          authorization: AUTHORIZATION,
          now: clock.now()
        }),
      reads: () =>
        stand.requests.filter((received) =>
          received.url.split('?')[0]?.endsWith(`/customers/${ACCOUNT.accountId}/subscriptions`)
        ).length,
      close: () => stand.close()
    }
  }
}

/** The sources every case runs against. Another source is one more entry here. */
const SOURCES: readonly SourceEntry[] = [FAKE, REVENUECAT]

/** Lets the event loop turn until the condition holds; no timer is involved. */
async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 2000 && !condition(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  expect(condition()).toBe(true)
}

describe.each(SOURCES)('source parity: $name', (entry) => {
  let scripted: Scripted
  let clock: ManualClock
  let host: ParityApp

  /** Builds the host over the entry's source and the policy. */
  async function boot(failPolicy?: SubscriptionFailPolicy): Promise<void> {
    clock = new ManualClock(START)
    scripted = await entry.start(clock)
    host = await buildParityApp({
      source: scripted.source,
      clock,
      ...(failPolicy === undefined ? {} : { failPolicy })
    })
  }

  /** A request to the protected route as the account. */
  function getPremium(): request.Test {
    return request(host.app.getHttpServer())
      .get(PARITY_PREMIUM_ROUTE)
      .set(PARITY_ACCOUNT_HEADER, ACCOUNT.accountId)
  }

  /** Delivers a request to the webhook controller as the source would. */
  function deliver(built: WebhookRequest): request.Test {
    let call = request(host.app.getHttpServer()).post(PARITY_WEBHOOK_ROUTE)
    for (const [name, value] of Object.entries(built.headers)) {
      if (value !== undefined) call = call.set(name, value)
    }
    return call.send(Buffer.from(built.rawBody).toString('utf8'))
  }

  afterEach(async () => {
    await host.app.close()
    await scripted.close()
  })

  it('admits a request when the entitlement is granted', async () => {
    // Scenario: the source reports a granting subscription; after a refresh the route answers 200.
    await boot()
    scripted.grant()
    await host.service.refresh(ACCOUNT)
    expect((await getPremium()).status).toBe(200)
  })

  it('refuses an account with no subscription as the entitlement being required', async () => {
    // Scenario: the source reports an account with nothing; the route answers 403 with the code.
    await boot()
    scripted.empty()
    await host.service.refresh(ACCOUNT)
    const response = await getPremium()
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED })
  })

  it('changes the snapshot and calls the hook once for a verified webhook', async () => {
    // Scenario: nothing is stored; one verified event reads the source, stores what it reports and
    // tells the host that the subscription started.
    await boot()
    scripted.grant()
    expect((await getPremium()).status).toBe(403)
    expect((await deliver(scripted.webhook())).status).toBe(200)
    await until(() => host.notifications.length > 0)
    expect(host.notifications).toHaveLength(1)
    expect(host.notifications[0]?.changes.map((change) => change.kind)).toContain('started')
    expect((await getPremium()).status).toBe(200)
  })

  it('reads the source once and calls the hook once when the same event arrives five times', async () => {
    // Scenario: the source retries one event; every delivery is answered success.
    await boot()
    scripted.grant()
    const built = scripted.webhook()
    for (let delivery = 0; delivery < 5; delivery += 1) {
      expect((await deliver(built)).status).toBe(200)
    }
    await until(() => host.notifications.length > 0)
    expect(host.notifications).toHaveLength(1)
    expect(scripted.reads()).toBe(1)
  })

  it('refuses a request that is not signed by the source and changes nothing', async () => {
    // Scenario: the event's bytes are altered after signing; the answer is a refusal and neither
    // the source is read nor the hook called.
    await boot()
    scripted.grant()
    const built = scripted.webhook()
    const altered = { ...built, rawBody: new TextEncoder().encode('{"tampered":true}') }
    expect((await deliver(altered)).status).toBe(401)
    expect(scripted.reads()).toBe(0)
    expect(host.notifications).toHaveLength(0)
  })

  it.each([
    ['refuse', 503],
    ['last_known_state', 200]
  ] as const)(
    'follows the %s fail policy when the source is down and the snapshot is stale',
    async (policy, status) => {
      // Scenario: a snapshot was stored, a day and a half passes, the source fails; the guard
      // refuses under `refuse` and trusts the last known state under `last_known_state`.
      await boot(policy)
      scripted.grant()
      await host.service.refresh(ACCOUNT)
      expect((await getPremium()).status).toBe(200)
      clock.advance(DAY_MS + DAY_MS / 2)
      scripted.breakSource()
      expect((await getPremium()).status).toBe(status)
    }
  )
})

describe('source parity: the application is written once', () => {
  it('names no billing source in the application factory', () => {
    // Scenario: the factory file holds no reference to a source by name, so the routes and the
    // hook cannot be defined per source.
    const text = readFileSync(join(__dirname, 'fixtures', 'parity-app.ts'), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/FakeSubscriptionSource|revenueCatSource|RevenueCat|finance/i)
  })

  it('never branches on the name of a source in a case', () => {
    // Scenario: the suite reads an entry only through its members, never through its name.
    const text = readFileSync(__filename, 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/entry\.name\s*[=!]=|\.name\s*===\s*'/)
    expect(SOURCES.map((entry) => entry.name)).toStrictEqual([
      'the fake source',
      'the RevenueCat adapter'
    ])
  })
})
