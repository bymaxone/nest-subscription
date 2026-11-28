/**
 * @fileoverview Unit tests for the receiver's response deadline.
 *
 * Goal: a read slower than the deadline is answered as a failure before the deadline by the
 * injected clock, is not abandoned, frees the event for the retry, and leaves no timer pending; an identifier the store may have
 * recorded late or without acknowledging it is removed.
 * Mocks: the fake source with a read held by hand; a deadline wait that moves the manual clock and
 * resolves when the test says; `markEventProcessed` replaced so a test settles it; Jest fake timers for the default wait.
 * @layer core
 */
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type SourceNotification
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  type SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock,
  createCapture
} from '@bymax-one/nest-subscription/testing'

import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { timerWait, type DeadlineWait } from './deadline'
import { WebhookProcessor } from './webhook.processor'

const T0 = '2026-01-01T00:00:00.000Z'
const DEADLINE_MS = 5000
const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const NOTIFICATION: SourceNotification = {
  eventId: 'evt-1',
  accountIds: ['acc-1'],
  kind: 'RENEWAL',
  eventTime: T0,
  environment: 'production'
}
const RECORD: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: 'P1M',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
}

/** A processor whose deadline wait is the given one, or a hand-resolved one by default. */
function build(wait?: DeadlineWait): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  processor: WebhookProcessor
  hook: jest.Mock
  waits: number[]
  expire: () => void
  capture: ReturnType<typeof createCapture>
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const capture = createCapture()
  const hook = jest.fn()
  const options = resolveOptions({
    source,
    store,
    clock,
    accountResolver: () => null,
    observer: capture.observer,
    logger: capture.logger,
    webhookDeadlineMs: DEADLINE_MS
  })
  const bridge = new ObserverBridge(options.observer, clock)
  const dispatcher = new ChangeDispatcher(hook, store, options.logger, bridge)
  const refresher = new SnapshotRefresher(source, store, clock, null, dispatcher, bridge)
  const waits: number[] = []
  let expire = (): void => undefined
  const manual: DeadlineWait = (milliseconds) => {
    waits.push(milliseconds)
    return new Promise<void>((resolve) => {
      expire = () => {
        clock.advance(milliseconds)
        resolve()
      }
    })
  }
  const processor = new WebhookProcessor(
    source,
    store,
    clock,
    options,
    refresher,
    bridge,
    wait ?? manual
  )
  return { source, store, clock, processor, hook, waits, expire: () => expire(), capture }
}

describe('WebhookProcessor deadline', () => {
  it('waits for the configured deadline and answers a failure when a read is slower', async () => {
    // Scenario: the read is held; the deadline passes by the injected clock; the answer is a
    // failure and the observer's duration is the deadline, no more.
    const { source, processor, waits, expire, capture } = build()
    const release = source.delayNextRead()
    const answer = processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expire()
    const outcome = await answer
    expect(outcome).toStrictEqual({ kind: 'failed' })
    expect(waits).toStrictEqual([DEADLINE_MS])
    await flush()
    expect(capture.payloads.filter((entry) => entry.method === 'onWebhook')).toStrictEqual([
      {
        method: 'onWebhook',
        payload: { outcome: 'failed', durationMs: DEADLINE_MS, retained: false }
      }
    ])
    release()
  })

  it('does not answer before the deadline while the read is pending', async () => {
    // Scenario: with the read held and the deadline not reached, the call has not answered.
    const { source, processor } = build()
    const release = source.delayNextRead()
    const settled = jest.fn()
    void processor.process(source.buildRequest(NOTIFICATION)).then(settled)
    await flush()
    expect(settled).toHaveBeenCalledTimes(0)
    release()
    await flush()
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('stores the snapshot of a slow read that completes after the answer', async () => {
    // Scenario: the answer is a failure, and the read it left running still completes through the
    // ordered write and tells the host's hook.
    const { source, store, processor, expire, hook } = build()
    source.setAccount(ACCOUNT, {
      ...createEmptySnapshot({ accountId: 'acc-1', source: 'fake', fetchedAt: T0 }),
      sourceUpdatedAt: '2026-01-01T00:00:10.000Z',
      subscriptions: [RECORD]
    })
    const release = source.delayNextRead()
    const answer = processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expire()
    expect(await answer).toStrictEqual({ kind: 'failed' })
    expect(await store.getSnapshot(encodeAccountKey(ACCOUNT))).toBeNull()
    release()
    await flush()
    const stored = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(stored?.snapshot.subscriptions).toHaveLength(1)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('processes the retry of a timed-out event and reads again after the read still running', async () => {
    // Scenario: the identifier was removed on timeout; the retry arrives while the first read is
    // held, is processed (not a duplicate), waits for that read, which began before the retry, and
    // reads once more, so the source is read twice.
    const { source, processor, expire } = build()
    const release = source.delayNextRead()
    const request = source.buildRequest(NOTIFICATION)
    const first = processor.process(request)
    await flush()
    expire()
    expect(await first).toStrictEqual({ kind: 'failed' })
    const retry = processor.process(request)
    await flush()
    release()
    expect(await retry).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.readCount(ACCOUNT)).toBe(2)
  })

  it('counts the wait for an older read inside the deadline', async () => {
    // Scenario: a refresh that began before the event is held; the webhook waits for it, the
    // deadline passes, and the answer is a failure although the webhook's own read never began.
    const { source, processor, expire, waits } = build()
    const release = source.delayNextRead()
    void processor['refresher'].refresh(ACCOUNT).catch(() => undefined)
    await flush()
    const answer = processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expire()
    expect(await answer).toStrictEqual({ kind: 'failed' })
    expect(waits).toStrictEqual([DEADLINE_MS])
    expect(source.readCount(ACCOUNT)).toBe(1)
    release()
    await flush()
  })

  it('does not fail a read that finishes before the deadline', async () => {
    // Scenario: the wait is started and never expires; the read wins the race.
    const { source, processor, waits } = build()
    const outcome = await processor.process(source.buildRequest(NOTIFICATION))
    expect(outcome).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(waits).toStrictEqual([DEADLINE_MS])
  })

  it('answers a failure and forgets the event when the wait itself rejects', async () => {
    // Scenario: an injected wait that breaks cannot make the receiver throw or hold the event.
    const broken: DeadlineWait = () => Promise.reject(new Error('wait broke'))
    const { source, processor } = build(broken)
    const request = source.buildRequest(NOTIFICATION)
    const first = await processor.process(request)
    const second = await processor.process(request)
    expect(first).toStrictEqual({ kind: 'failed' })
    expect(second).toStrictEqual({ kind: 'failed' })
  })
})

/** What `settledWithin` yields when the promise had not settled by the time the loop turned. */
const STILL_PENDING = Symbol('still pending')

/** The promise's value if it settles before the event loop turns once, else `STILL_PENDING`. */
function settledWithin<T>(promise: Promise<T>): Promise<T | typeof STILL_PENDING> {
  return Promise.race([
    promise,
    new Promise<typeof STILL_PENDING>((resolve) => setImmediate(() => resolve(STILL_PENDING)))
  ])
}

/** The payloads the observer heard about webhooks. */
function webhookPayloads(capture: ReturnType<typeof createCapture>): unknown[] {
  return capture.payloads.filter((entry) => entry.method === 'onWebhook').map((e) => e.payload)
}

describe('WebhookProcessor removal of a failed event', () => {
  it('answers a failure at the deadline although the store never settles the removal', async () => {
    // Scenario: the read is held past the deadline and `forgetEvent` never returns. The answer
    // does not wait for the removal, which was started before the answer.
    const { source, store, processor, expire } = build()
    const forget = jest.spyOn(store, 'forgetEvent').mockReturnValue(new Promise(() => undefined))
    const release = source.delayNextRead()
    const answer = processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expire()
    expect(await settledWithin(answer)).toStrictEqual({ kind: 'failed' })
    expect(forget).toHaveBeenCalledTimes(1)
    expect(forget).toHaveBeenCalledWith('fake', 'evt-1')
    release()
  })

  it('answers a failed read without waiting for a removal that never settles', async () => {
    // Scenario: the same on the path of a source that cannot be read, with no deadline involved.
    const { source, store, processor } = build()
    jest.spyOn(store, 'forgetEvent').mockReturnValue(new Promise(() => undefined))
    source.failNextRead(new Error('source down'))
    const answer = processor.process(source.buildRequest(NOTIFICATION))
    expect(await settledWithin(answer)).toStrictEqual({ kind: 'failed' })
  })

  it('reports a failed event once, when its removal settles, with the duration of the answer', async () => {
    // Scenario: nothing is reported while the removal is pending; when it settles the observer
    // hears one event, whose duration is the time to the answer and not to the removal.
    const { source, store, processor, expire, clock, capture } = build()
    let settle = (): void => undefined
    jest.spyOn(store, 'forgetEvent').mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      })
    )
    const release = source.delayNextRead()
    const answer = processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expire()
    await answer
    await flush()
    expect(webhookPayloads(capture)).toStrictEqual([])
    clock.advance(777)
    settle()
    await flush()
    expect(webhookPayloads(capture)).toStrictEqual([
      { outcome: 'failed', durationMs: DEADLINE_MS, retained: false }
    ])
    release()
  })

  it('handles a removal that fails later, and reports it once without the identifier', async () => {
    // Scenario: the removal rejects after the answer; nothing is left unhandled, the observer
    // and the log each hear of it once, and neither holds the event identifier or the error text.
    const { source, store, processor, capture } = build()
    let fail = (_error: unknown): void => undefined
    jest.spyOn(store, 'forgetEvent').mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        fail = reject
      })
    )
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest({ ...NOTIFICATION, eventId: 'sentinel-event-id' })
    expect(await processor.process(request)).toStrictEqual({ kind: 'failed' })
    expect(webhookPayloads(capture)).toStrictEqual([])
    fail(
      new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE, { cause: 'sentinel-text' })
    )
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).toHaveBeenCalledTimes(0)
    expect(webhookPayloads(capture)).toStrictEqual([
      { outcome: 'failed', durationMs: 0, retained: true }
    ])
    expect(capture.lines).toHaveLength(1)
    expect(JSON.stringify([capture.lines, capture.payloads])).not.toContain('sentinel')
  })
})

/** A processor whose first record of an event settles only when the test says so. */
function heldRecord(): {
  h: ReturnType<typeof build>
  /** The store's own method, which records without being held. */
  record: InMemorySubscriptionStore['markEventProcessed']
  calls: () => number
  settle: (how: 'recorded' | 'seen' | 'rejected') => Promise<void>
} {
  const h = build()
  const real = h.store.markEventProcessed.bind(h.store)
  let held: ((how: 'recorded' | 'seen' | 'rejected') => void) | undefined
  let calls = 0
  jest.spyOn(h.store, 'markEventProcessed').mockImplementation((source, id, at) => {
    calls += 1
    if (calls > 1) return real(source, id, at)
    return new Promise((resolve, reject) => {
      held = (how) => {
        if (how === 'rejected') reject(new Error('store down'))
        else if (how === 'seen') resolve(false)
        else resolve(real(source, id, at))
      }
    })
  })
  return {
    h,
    record: real,
    calls: () => calls,
    settle: async (how) => {
      held?.(how)
      await flush()
    }
  }
}

describe('WebhookProcessor record of an event', () => {
  it('removes the identifier when the store rejects after recording it', async () => {
    // Scenario: the store commits the record and the acknowledgement is lost. The identifier is
    // removed, so the source's retry is processed instead of being answered as already seen.
    const h = build()
    const real = h.store.markEventProcessed.bind(h.store)
    let lose = true
    jest.spyOn(h.store, 'markEventProcessed').mockImplementation(async (source, id, at) => {
      const isNew = await real(source, id, at)
      if (!lose) return isNew
      lose = false
      throw new Error('acknowledgement lost')
    })
    const request = h.source.buildRequest(NOTIFICATION)
    await expect(h.processor.process(request)).resolves.toStrictEqual({ kind: 'failed' })
    expect(h.source.totalReads).toBe(0)
    await flush()
    await expect(h.processor.process(request)).resolves.toStrictEqual({
      kind: 'processed',
      accounts: 1
    })
  })

  it('answers failed at the deadline when the record of the event does not settle', async () => {
    // Scenario: the store is frozen at the first call. The answer comes with the deadline, the
    // observer hears it, nothing is read, and a retry meanwhile is a failure with no store call.
    const { h, calls } = heldRecord()
    const request = h.source.buildRequest(NOTIFICATION)
    const pending = h.processor.process(request)
    await flush()
    h.expire()
    await expect(pending).resolves.toStrictEqual({ kind: 'failed' })
    await expect(h.processor.process(request)).resolves.toStrictEqual({ kind: 'failed' })
    expect(calls()).toBe(1)
    expect(h.source.totalReads).toBe(0)
    expect(h.capture.payloads.filter((entry) => entry.method === 'onWebhook')).toStrictEqual([
      {
        method: 'onWebhook',
        payload: { outcome: 'failed', durationMs: DEADLINE_MS, retained: false }
      },
      { method: 'onWebhook', payload: { outcome: 'failed', durationMs: 0, retained: false } }
    ])
  })

  it.each(['recorded', 'rejected'] as const)(
    'removes the identifier when a record held past the deadline ends as %s',
    async (how) => {
      // Scenario: the record settles after the answer. No read is started for the answered
      // delivery, and whatever the record left is removed, so the source's retry is processed.
      const { h, settle } = heldRecord()
      const forget = jest.spyOn(h.store, 'forgetEvent')
      const request = h.source.buildRequest(NOTIFICATION)
      const pending = h.processor.process(request)
      await flush()
      h.expire()
      await pending
      await settle(how)
      expect(h.source.totalReads).toBe(0)
      expect(forget).toHaveBeenCalledWith('fake', 'evt-1')
      await expect(h.processor.process(request)).resolves.toStrictEqual({
        kind: 'processed',
        accounts: 1
      })
    }
  )

  it('removes nothing when a record held past the deadline says the event was seen', async () => {
    // Scenario: the identifier belongs to an earlier delivery, so it stays recorded.
    const { h, record, settle } = heldRecord()
    await record('fake', 'evt-1', T0)
    const forget = jest.spyOn(h.store, 'forgetEvent')
    const request = h.source.buildRequest(NOTIFICATION)
    const pending = h.processor.process(request)
    await flush()
    h.expire()
    await pending
    await settle('seen')
    expect(forget).toHaveBeenCalledTimes(0)
    await expect(h.processor.process(request)).resolves.toStrictEqual({ kind: 'duplicate' })
  })

  it('keeps an identifier already seen when the wait ends first', async () => {
    // Scenario: the wait is over at once and the record has already said the event was seen. The
    // identifier belongs to an earlier delivery, so nothing is removed.
    const { source, store, processor } = build(() => Promise.resolve())
    const request = source.buildRequest(NOTIFICATION)
    await store.markEventProcessed('fake', 'evt-1', T0)
    const forget = jest.spyOn(store, 'forgetEvent')
    await processor.process(request)
    await flush()
    expect(forget).toHaveBeenCalledTimes(0)
  })

  it('starts the removal again when the removal of a late record fails', async () => {
    // Scenario: the record lands after the deadline and its removal fails. The retry starts the
    // removal again and is answered as a failure.
    let refuse = true
    const forgotten: string[] = []
    const { h, settle } = heldRecord()
    jest.spyOn(h.store, 'forgetEvent').mockImplementation((_source, id) => {
      forgotten.push(id)
      return refuse ? Promise.reject(new Error('store down')) : Promise.resolve()
    })
    const request = h.source.buildRequest(NOTIFICATION)
    const pending = h.processor.process(request)
    await flush()
    h.expire()
    await pending
    await settle('recorded')
    refuse = false
    await expect(h.processor.process(request)).resolves.toStrictEqual({ kind: 'failed' })
    await flush()
    expect(forgotten).toStrictEqual(['evt-1', 'evt-1'])
  })
})

describe('WebhookProcessor default wait', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('leaves no timer pending after an answer that beat the deadline', async () => {
    // Scenario: the read finishes at once; the timer started for the deadline has been cleared.
    const { source, processor } = build(timerWait)
    const outcome = await processor.process(source.buildRequest(NOTIFICATION))
    expect(outcome.kind).toBe('processed')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('leaves no timer pending after an answer that missed the deadline', async () => {
    // Scenario: the read is held; the timer fires at the deadline; nothing is pending afterwards.
    const { source, processor } = build(timerWait)
    const release = source.delayNextRead()
    const answer = processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(DEADLINE_MS)
    expect(await answer).toStrictEqual({ kind: 'failed' })
    expect(jest.getTimerCount()).toBe(0)
    release()
  })
})
