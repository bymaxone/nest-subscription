/**
 * @fileoverview Unit tests for the receiver's response deadline.
 *
 * Layer: unit.
 * Goal: a read slower than the deadline is answered as a failure before the deadline by the
 * injected clock, is not abandoned, frees the event for the retry, and leaves no timer pending.
 * Mocks: the fake source with a read held by hand; a deadline wait that moves the manual clock and
 * resolves when the test says; Jest fake timers for the default wait.
 */
import {
  encodeAccountKey,
  type AccountReference,
  type SourceNotification
} from '@bymax-one/nest-subscription/internal'
import { createEmptySnapshot, type SubscriptionRecord } from '@bymax-one/nest-subscription/shared'
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

  it('processes the retry of a timed-out event and shares the read still running', async () => {
    // Scenario: the identifier was removed on timeout; the retry arrives while the first read is
    // held, is processed (not a duplicate) and joins that read, so the source is read once.
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
    expect(source.readCount(ACCOUNT)).toBe(1)
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
