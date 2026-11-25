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
  ['an acceptance whose accounts are not a list', () => accept({ accountIds: 'acc-1' })],
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

  it('answers a failure, and records nothing to forget, when the store cannot record the event', async () => {
    // Scenario: the store is down for the first call; the source is told to retry and nothing is read.
    let failing: FailingStore | undefined
    const app = await buildWebhookApp({
      wrapStore: (store) => (failing = createFailingStore(store))
    })
    failing?.fail(['markEventProcessed'])
    const forget = jest.spyOn(app.store, 'forgetEvent')
    expect((await send(app, route, signed(app))).status).toBe(503)
    expect(app.source.totalReads).toBe(0)
    expect(forget).toHaveBeenCalledTimes(0)
    await app.app.close()
  })

  it('processes the retry of a failure whose identifier could not be forgotten, in the same process', async () => {
    // Scenario: the source is down and the store cannot forget; the processor remembers the event,
    // so the retry is processed, the observer reports the identifier as retained and the log holds
    // one fixed sentence.
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
    expect([first.status, retry.status]).toStrictEqual([503, 200])
    expect(retry.body).toStrictEqual({ outcome: 'processed', accounts: 1 })
    expect(
      app.capture.payloads
        .filter((entry) => entry.method === 'onWebhook')
        .map((entry) => entry.payload)
    ).toStrictEqual([
      expect.objectContaining({ outcome: 'failed', retained: true }),
      expect.objectContaining({ outcome: 'processed', retained: false })
    ])
    expect(app.capture.lines).toHaveLength(1)
    await app.app.close()
  })

  it('processes the retry of a failure while the removal of its identifier is still pending', async () => {
    // Scenario: the source is down and the store never returns from the removal; the source's
    // retry is processed and answered 200, not answered as already seen (D16).
    const app = await buildWebhookApp()
    jest.spyOn(app.store, 'forgetEvent').mockReturnValue(new Promise(() => undefined))
    app.source.failNextRead(new Error('source down'))
    const first = await send(app, route, signed(app))
    const retry = await send(app, route, signed(app))
    expect([first.status, retry.status]).toStrictEqual([503, 200])
    expect(retry.body).toStrictEqual({ outcome: 'processed', accounts: 1 })
    expect(app.source.readCount(ACCOUNT)).toBe(2)
    await app.app.close()
  })

  it('answers a duplicate after a removal that erased the identifier settled after a processed retry', async () => {
    // Scenario: the source is down and the removal is held; the retry is processed and answered
    // 200; the removal then erases the identifier; the processor records it again, so the next
    // delivery is a duplicate and the source is not read again.
    const app = await buildWebhookApp()
    const real = app.store.forgetEvent.bind(app.store)
    let settle = async (): Promise<void> => undefined
    jest.spyOn(app.store, 'forgetEvent').mockImplementation(
      (sourceName, eventId) =>
        new Promise<void>((resolve) => {
          settle = async () => {
            await real(sourceName, eventId)
            resolve()
          }
        })
    )
    app.source.failNextRead(new Error('source down'))
    const first = await send(app, route, signed(app))
    const retry = await send(app, route, signed(app))
    await settle()
    for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
    const next = await send(app, route, signed(app))
    expect([first.status, retry.status, next.status]).toStrictEqual([503, 200, 200])
    expect(next.body).toStrictEqual({ outcome: 'duplicate' })
    expect(app.source.readCount(ACCOUNT)).toBe(2)
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
  it('drops the oldest failed event past the bound and answers its retry as the store says', async () => {
    // Scenario: more events than the bound fail and their removal fails too; the processor keeps
    // the newest ones, so the oldest event's retry is answered as already seen and a recent
    // one's is processed.
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
    expect([oldest.kind, recent.kind]).toStrictEqual(['duplicate', 'processed'])
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

describe('webhook receiver removals that settle after a retry', () => {
  it.each([
    ['a removal that fails after the retry', [false]],
    [
      'two removals, one succeeding before the retry and one failing after it',
      [true, 'retry', false]
    ],
    [
      'two removals, one failing before the retry and one succeeding after it',
      [false, 'retry', true]
    ]
  ] as const)('ends with the identifier recorded for %s', async (_name, steps) => {
    // Scenario: the event fails once or twice, a retry is processed while a removal is pending,
    // and the removals settle in the given order; the next delivery is a duplicate and the
    // source is not read for it.
    const app = await buildWebhookApp()
    const settles = holdRemovals(app.store)
    const processor = app.moduleRef.get(WebhookProcessor)
    const request = app.source.buildRequest(NOTIFICATION)
    const failures = steps.filter((step) => typeof step === 'boolean').length
    for (let n = 0; n < failures; n += 1) {
      app.source.failNextRead(new Error('source down'))
      await processor.process(request)
    }
    if (!steps.some((step) => typeof step === 'string')) await processor.process(request)
    let removal = 0
    for (const step of steps) {
      if (typeof step === 'string') await processor.process(request)
      else await settles[removal++]?.(step)
    }
    const reads = app.source.totalReads
    expect(await processor.process(request)).toStrictEqual({ kind: 'duplicate' })
    expect(app.source.totalReads).toBe(reads)
    await app.app.close()
  })

  it('reports a failure to record the identifier again once, and lets another retry overtake it', async () => {
    // Scenario: the recording after the removal is held and then fails; a retry processed while
    // it is held is answered at once, and the failure is logged and reported once.
    const app = await buildWebhookApp()
    const settles = holdRemovals(app.store)
    const processor = app.moduleRef.get(WebhookProcessor)
    const request = app.source.buildRequest(NOTIFICATION)
    app.source.failNextRead(new Error('source down'))
    await processor.process(request)
    await processor.process(request)
    const mark = jest.spyOn(app.store, 'markEventProcessed')
    let fail = (): void => undefined
    mark.mockReturnValueOnce(
      new Promise<boolean>((_resolve, reject) => {
        fail = () => reject(new Error('store down'))
      })
    )
    await settles[0]?.(true)
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    fail()
    for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
    expect(app.capture.lines).toHaveLength(1)
    expect(
      app.capture.payloads.filter((entry) => entry.method === 'onEventRecordFailure')
    ).toHaveLength(1)
    await app.app.close()
  })
})

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
    app.source.setAccount(ACCOUNT, subscribed('acc-1', '2026-01-01T00:00:10.000Z'))
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
