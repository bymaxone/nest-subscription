/**
 * @fileoverview What the receiver does when a part it depends on misbehaves, end to end: an
 * adapter that throws or answers with something that is not an acceptance, a store that cannot
 * record or forget an event, a broken deadline wait, the real timer wait, a tenant that comes from
 * the host's route, the retention purge of reconciliation, and every configuration the module
 * refuses at boot.
 * @layer e2e
 */
import { Test } from '@nestjs/testing'
import {
  SubscriptionModule,
  SubscriptionError,
  SubscriptionService,
  encodeAccountKey,
  toHttpAnswer
} from '@bymax-one/nest-subscription'
import type {
  SourceNotification,
  SubscriptionOptionsInput,
  WebhookRequest,
  WebhookVerification
} from '@bymax-one/nest-subscription'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  createFailingStore,
  type FailingStore
} from '@bymax-one/nest-subscription/testing'

import { UNRELEASED_EVENTS_BOUND } from '../../src/core/webhook/unreleased-events'
import { WebhookProcessor } from '../../src/core/webhook/webhook.processor'
import {
  ACCOUNT,
  CONTROLLER_ROUTE,
  DEADLINE_MS,
  DIRECT_ROUTE,
  NOTIFICATION,
  TENANT_HEADER,
  buildWebhookApp,
  send,
  signed,
  subscribed
} from './fixtures/webhook-app'

const REFUSED = toHttpAnswer({ kind: 'refused' })

/** A source whose verification is whatever the test scripted. */
class ScriptedSource extends FakeSubscriptionSource {
  script: () => unknown = () => ({ accepted: false })

  override verifyWebhook(_request: WebhookRequest): Promise<WebhookVerification> {
    return Promise.resolve().then(() => this.script() as WebhookVerification)
  }
}

/** An acceptance whose notification differs from the good one by the given fields. */
function accept(fields: Record<string, unknown>): unknown {
  return { accepted: true, notification: { ...NOTIFICATION, ...fields } }
}

const MISBEHAVING: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'an adapter that throws',
    () => {
      throw new Error('verifier exploded')
    }
  ],
  ['an acceptance with no notification', () => ({ accepted: true })],
  ['an acceptance with a blank event identifier', () => accept({ eventId: ' ' })],
  ['an acceptance whose accounts are not a list', () => accept({ accountIds: 'sentinel-acc-1' })],
  ['an acceptance naming a blank account', () => accept({ accountIds: [' '] })],
  ['an answer that is not an object', () => null]
]

describe.each([
  ['the controller', CONTROLLER_ROUTE],
  ['the processor on a host route', DIRECT_ROUTE]
])('webhook receiver failures through %s', (_form, route) => {
  it.each(MISBEHAVING)(
    'answers %s with the one refusal and changes nothing',
    async (_name, script) => {
      // Scenario: the adapter itself misbehaves; the answer, headers included, is the refusal every
      // other failed check gets, and nothing is read, recorded or stored.
      const source = new ScriptedSource()
      const app = await buildWebhookApp({ source })
      const reference = await send(app, route, { bytes: Buffer.alloc(0) })
      source.script = script
      const answer = await send(app, route, signed(app))
      expect(answer.status).toBe(401)
      expect(answer.body).toStrictEqual(REFUSED.body)
      expect(answer.headers).toStrictEqual(reference.headers)
      expect(source.totalReads).toBe(0)
      expect(await app.store.getSnapshot(encodeAccountKey(ACCOUNT))).toBeNull()
      await app.app.close()
    }
  )

  it('answers a failure, and removes the identifier, when the store cannot record the event', async () => {
    // Scenario: the store is down for the first call; the source is told to retry, nothing is read,
    // and the identifier is removed because the failed record may have stored it.
    let failing: FailingStore | undefined
    const app = await buildWebhookApp({
      wrapStore: (store) => (failing = createFailingStore(store))
    })
    failing?.fail(['markEventProcessed'])
    const forget = jest.spyOn(app.store, 'forgetEvent')
    expect((await send(app, route, signed(app))).status).toBe(503)
    expect(app.source.totalReads).toBe(0)
    expect(forget).toHaveBeenCalledTimes(1)
    await app.app.close()
  })

  it('answers a retry as a failure while the removal is pending and processes it once it succeeded', async () => {
    // Scenario: the source is down and the removal is held; the retry during it gets a 503 and
    // reads nothing; when the removal succeeded the next retry is read and answered 200 (D16).
    const app = await buildWebhookApp()
    const settles = holdRemovals(app.store)
    app.source.failNextRead(new Error('source down'))
    const first = await send(app, route, signed(app))
    const during = await send(app, route, signed(app))
    expect(app.source.readCount(ACCOUNT)).toBe(1)
    await settles[0]?.(true)
    const after = await send(app, route, signed(app))
    expect([first.status, during.status, after.status]).toStrictEqual([503, 503, 200])
    expect(after.body).toStrictEqual({ outcome: 'processed', accounts: 1 })
    expect(app.source.readCount(ACCOUNT)).toBe(2)
    await app.app.close()
  })

  it('starts the removal again for a retry after it failed and processes once it succeeded', async () => {
    // Scenario: the removal fails, which the log and the observer hear once; the retry starts it
    // again and gets a 503; when that one succeeded the next retry is processed.
    const app = await buildWebhookApp()
    const settles = holdRemovals(app.store)
    app.source.failNextRead(new Error('source down'))
    await send(app, route, signed(app))
    await settles[0]?.(false)
    const restart = await send(app, route, signed(app))
    expect(settles).toHaveLength(2)
    await settles[1]?.(true)
    const after = await send(app, route, signed(app))
    expect([restart.status, after.status]).toStrictEqual([503, 200])
    expect(app.capture.lines).toHaveLength(1)
    expect(
      app.capture.payloads
        .filter((entry) => entry.method === 'onWebhook')
        .map((entry) => (entry.payload as { retained: boolean }).retained)
    ).toStrictEqual([true, false, false])
    await app.app.close()
  })

  it('logs a failed removal by the code of the error and answers the retry as a failure', async () => {
    // Scenario: the store cannot forget and raises the library's own error; the log holds one fixed
    // sentence with its code, the observer reports the identifier as retained, and the retry gets
    // a 503 because the removal is started again.
    let failing: FailingStore | undefined
    const app = await buildWebhookApp({
      wrapStore: (store) => (failing = createFailingStore(store))
    })
    failing?.fail(
      ['forgetEvent'],
      new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    )
    app.source.failNextRead(new Error('source down'))
    const first = await send(app, route, signed(app))
    const retry = await send(app, route, signed(app))
    expect([first.status, retry.status]).toStrictEqual([503, 503])
    expect(app.capture.lines[0]).toMatch(/: SUBSCRIPTION_SOURCE_UNAVAILABLE\.$/)
    expect(app.capture.payloads.filter((entry) => entry.method === 'onWebhook')).toHaveLength(2)
    await app.app.close()
  })

  it('answers a failure and frees the event when the deadline wait itself breaks', async () => {
    // Scenario: a wait that rejects cannot make the receiver throw or keep the event.
    const app = await buildWebhookApp({ wait: () => Promise.reject(new Error('wait broke')) })
    const first = await send(app, route, signed(app))
    const second = await send(app, route, signed(app))
    expect([first.status, second.status]).toStrictEqual([503, 503])
    await app.app.close()
  })
})

describe('webhook receiver memory of failed events', () => {
  it('drops the oldest failed event past the bound and answers its retry as already seen', async () => {
    // Scenario: more events than the bound fail and their removal fails too; the processor keeps
    // the newest ones, so the oldest event's retry is answered as already seen (the documented
    // limit of the bound) and a recent one's is answered as a failure.
    let failing: FailingStore | undefined
    const app = await buildWebhookApp({
      wrapStore: (store) => (failing = createFailingStore(store))
    })
    failing?.fail(['forgetEvent'])
    const processor = app.moduleRef.get(WebhookProcessor)
    const event = (n: number): SourceNotification => ({
      ...NOTIFICATION,
      eventId: `evt-${String(n)}`
    })
    for (let n = 1; n <= UNRELEASED_EVENTS_BOUND + 1; n += 1) {
      app.source.failNextRead(new Error('source down'))
      await processor.process(app.source.buildRequest(event(n)))
    }
    const oldest = await processor.process(app.source.buildRequest(event(1)))
    const recent = await processor.process(app.source.buildRequest(event(2)))
    expect([oldest.kind, recent.kind]).toStrictEqual(['duplicate', 'failed'])
    await app.app.close()
  })
})

/** Holds every removal the store is asked for; a success removes the identifier for real. */
function holdRemovals(
  store: InMemorySubscriptionStore
): Array<(succeeds: boolean) => Promise<void>> {
  const settles: Array<(succeeds: boolean) => Promise<void>> = []
  const real = store.forgetEvent.bind(store)
  jest.spyOn(store, 'forgetEvent').mockImplementation(
    (sourceName, eventId) =>
      new Promise<void>((resolve, reject) => {
        settles.push(async (succeeds) => {
          if (succeeds) {
            await real(sourceName, eventId)
            resolve()
          } else {
            reject(new Error('store down'))
          }
          for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
        })
      })
  )
  return settles
}

describe('webhook receiver removal of an event dropped from the memory', () => {
  it('settles the removal of an event that was dropped past the bound without effect', async () => {
    // Scenario: the removal of the oldest event is still pending when the memory drops it; when it
    // settles nothing happens, and a retry of that event is answered as the store says.
    const app = await buildWebhookApp()
    const settles = holdRemovals(app.store)
    const processor = app.moduleRef.get(WebhookProcessor)
    for (let n = 1; n <= UNRELEASED_EVENTS_BOUND + 1; n += 1) {
      app.source.failNextRead(new Error('source down'))
      await processor.process(
        app.source.buildRequest({ ...NOTIFICATION, eventId: `evt-${String(n)}` })
      )
    }
    await settles[0]?.(true)
    const retry = await processor.process(
      app.source.buildRequest({ ...NOTIFICATION, eventId: 'evt-1' })
    )
    expect(retry).toStrictEqual({ kind: 'processed', accounts: 1 })
    await app.app.close()
  })
})

describe('webhook receiver record still unsettled at the deadline', () => {
  it.each([
    ['removes the identifier of an event it recorded late', true, 1],
    ['leaves the identifier an earlier delivery recorded', false, 0]
  ])('answers a failure and then %s', async (_label, isNew, removals) => {
    // Scenario: the store answers the record only after the deadline has been answered.
    const app = await buildWebhookApp()
    let settle: (value: boolean) => void = () => undefined
    jest
      .spyOn(app.store, 'markEventProcessed')
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (settle = resolve)))
    const forget = jest.spyOn(app.store, 'forgetEvent')
    const processor = app.moduleRef.get(WebhookProcessor)
    const answer = processor.process(app.source.buildRequest(NOTIFICATION))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    app.expire()
    expect(await answer).toStrictEqual({ kind: 'failed' })
    expect(forget).toHaveBeenCalledTimes(0)
    settle(isNew)
    for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
    expect(forget).toHaveBeenCalledTimes(removals)
    expect(app.source.totalReads).toBe(0)
    await app.app.close()
  })
})

describe('webhook receiver tenants', () => {
  it('reads under the tenant of the host route and not the one a signed body names', async () => {
    // Scenario: a multi-tenant host passes the tenant its authentication gave (SEC08); a tenant
    // named in the signed body is not used.
    const app = await buildWebhookApp({
      module: { multiTenant: true, webhookController: false }
    })
    const body = { ...NOTIFICATION, tenantId: 'from-body' }
    const answer = await send(app, DIRECT_ROUTE, {
      ...signed(app, body),
      headers: { ...signed(app, body).headers, [TENANT_HEADER]: 't-1' }
    })
    expect(answer.status).toBe(200)
    expect(app.source.readCount({ ...ACCOUNT, tenantId: 't-1' })).toBe(1)
    expect(app.source.readCount({ ...ACCOUNT, tenantId: 'from-body' })).toBe(0)
    await app.app.close()
  })

  it('fails the route before the adapter is called when a multi-tenant host gives no tenant', async () => {
    // Scenario: the host's route forgot the tenant, which is its own mistake and not the request's.
    const app = await buildWebhookApp({
      module: { multiTenant: true, webhookController: false }
    })
    const verify = jest.spyOn(app.source, 'verifyWebhook')
    expect((await send(app, DIRECT_ROUTE, signed(app))).status).toBe(500)
    expect(verify).toHaveBeenCalledTimes(0)
    await app.app.close()
  })
})

describe('webhook receiver deadline with the real wait', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('answers a failure when the timer fires and leaves no timer pending', async () => {
    // Scenario: with the module's own wait, a held read is answered as a failure at the deadline
    // and the timer is gone afterwards; time moves by Jest's fake timers, not by waiting.
    const app = await buildWebhookApp({ wait: 'timer' })
    const processor = app.moduleRef.get(WebhookProcessor)
    app.source.setAccount(ACCOUNT, subscribed('sentinel-acc-1', '2026-01-01T00:00:10.000Z'))
    const release = app.source.delayNextRead()
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
    const answer = processor.process(app.source.buildRequest(NOTIFICATION))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(DEADLINE_MS)
    expect(await answer).toStrictEqual({ kind: 'failed' })
    expect(jest.getTimerCount()).toBe(0)
    release()
    await app.app.close()
  })

  it('clears the timer when the read finishes first', async () => {
    // Scenario: a read that finishes at once leaves no timer pending.
    const app = await buildWebhookApp({ wait: 'timer' })
    const processor = app.moduleRef.get(WebhookProcessor)
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
    const outcome = await processor.process(app.source.buildRequest(NOTIFICATION))
    expect(outcome.kind).toBe('processed')
    expect(jest.getTimerCount()).toBe(0)
    await app.app.close()
  })
})

describe('retention purge by reconciliation', () => {
  it('forgets identifiers older than the retention and keeps the younger ones', async () => {
    // Scenario: one day of retention; an event recorded two days ago is new again after a run,
    // and one recorded an hour ago is still seen.
    const app = await buildWebhookApp({ module: { eventRetentionMs: 86_400_000 } })
    await app.store.markEventProcessed('fake', 'old', '2025-12-30T00:00:00.000Z')
    await app.store.markEventProcessed('fake', 'young', '2025-12-31T23:00:00.000Z')
    await app.moduleRef.get(SubscriptionService).reconcile({})
    expect(await app.store.markEventProcessed('fake', 'old', '2026-01-01T00:00:00.000Z')).toBe(true)
    expect(await app.store.markEventProcessed('fake', 'young', '2026-01-01T00:00:00.000Z')).toBe(
      false
    )
    await app.app.close()
  })

  it('logs one line for a failed purge, without the error text, and finishes the run', async () => {
    // Scenario: the store cannot purge; the run still ends and the line carries no text of the error.
    let failing: FailingStore | undefined
    const app = await buildWebhookApp({
      wrapStore: (store) => (failing = createFailingStore(store))
    })
    failing?.fail(['deleteEventsOlderThan'], new Error('connection string secret'))
    await expect(app.moduleRef.get(SubscriptionService).reconcile({})).resolves.toMatchObject({
      failed: 0
    })
    expect(app.capture.lines).toHaveLength(1)
    expect(app.capture.lines[0]).not.toContain('secret')
    await app.app.close()
  })

  it('skips the purge when the retention reaches before the earliest instant', async () => {
    // Scenario: a retention beyond what a date can hold leaves nothing older to purge.
    const app = await buildWebhookApp({ module: { eventRetentionMs: Number.MAX_SAFE_INTEGER } })
    const purge = jest.spyOn(app.store, 'deleteEventsOlderThan')
    await app.moduleRef.get(SubscriptionService).reconcile({})
    expect(purge).toHaveBeenCalledTimes(0)
    await app.app.close()
  })
})

describe('webhook configuration at boot', () => {
  /** The module options every case starts from. */
  function options(extra: Partial<SubscriptionOptionsInput>): SubscriptionOptionsInput {
    return {
      source: new FakeSubscriptionSource(),
      store: new InMemorySubscriptionStore({ logger: () => undefined }),
      accountResolver: () => null,
      ...extra
    }
  }

  it.each([
    ['the controller on with no route', { webhookController: true }, 'webhookPath'],
    [
      'the controller on in a multi-tenant host',
      { webhookController: true, webhookPath: 'hooks', multiTenant: true },
      'webhookController'
    ],
    ['a deadline above the source limit', { webhookDeadlineMs: 60_001 }, 'webhookDeadlineMs']
  ])('refuses %s and names the option', async (_name, extra, path) => {
    // Scenario: the application does not start, and the error names the option and no value.
    const compile = Test.createTestingModule({
      imports: [SubscriptionModule.forRoot(options(extra))]
    }).compile()
    await expect(compile).rejects.toThrow(`Offending options: ${path}.`)
  })

  it.each([
    [
      'a factory that enables the controller and names a route, with no static route',
      { useFactory: () => options({ webhookController: true, webhookPath: 'hooks' }) },
      'webhookPath'
    ],
    [
      'a factory that names a route only, with no static route',
      { useFactory: () => options({ webhookPath: 'hooks' }) },
      'webhookPath'
    ],
    [
      'a factory that enables the controller only, with no static route',
      { useFactory: () => options({ webhookController: true }) },
      'webhookPath'
    ],
    [
      'a factory that names another route beside the static one',
      { webhookPath: 'hooks', useFactory: () => options({ webhookPath: 'other' }) },
      'webhookPath'
    ],
    [
      'a route that is not valid',
      { webhookPath: 'a b', useFactory: () => options({}) },
      'webhookPath'
    ],
    [
      'a factory that switches the controller off beside a route',
      { webhookPath: 'hooks', useFactory: () => options({ webhookController: false }) },
      'webhookController'
    ]
  ])('refuses %s in forRootAsync', async (_name, async, path) => {
    // Scenario: the contradiction stops the application where it can be seen.
    const build = async (): Promise<unknown> =>
      Test.createTestingModule({ imports: [SubscriptionModule.forRootAsync(async)] }).compile()
    await expect(build()).rejects.toThrow(`Offending options: ${path}.`)
  })
})
