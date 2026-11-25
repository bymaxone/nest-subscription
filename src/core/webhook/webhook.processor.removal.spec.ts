/**
 * @fileoverview Unit tests for a delivery of an event whose identifier removal has not settled.
 *
 * Goal: an event is never processed while the removal of its identifier is in flight or after it
 * failed: the delivery is answered as a failure at once and, after a failed removal, starts the
 * removal again; once a removal succeeded the next delivery is processed; a delivery of an event
 * that never failed is still a duplicate; no answer waits for a removal; and nothing of the
 * event reaches a log line or an observer payload.
 * Mocks: the fake source and the in-memory store, with `forgetEvent` held so the test settles
 * each removal itself.
 * @layer core
 */
import type { SourceNotification } from '@bymax-one/nest-subscription/internal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock,
  assertNoSentinel,
  createCapture
} from '@bymax-one/nest-subscription/testing'

import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { timerWait } from './deadline'
import { WebhookProcessor } from './webhook.processor'

const T0 = '2026-01-01T00:00:00.000Z'
const NOTIFICATION: SourceNotification = {
  eventId: 'evt-1',
  accountIds: ['acc-1'],
  kind: 'RENEWAL',
  eventTime: T0,
  environment: 'production'
}
const STILL_PENDING = Symbol('still pending')

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
}

/** The promise's value if it settles before the event loop turns once, else `STILL_PENDING`. */
function settledWithin<T>(promise: Promise<T>): Promise<T | typeof STILL_PENDING> {
  return Promise.race([
    promise,
    new Promise<typeof STILL_PENDING>((resolve) => setImmediate(() => resolve(STILL_PENDING)))
  ])
}

/** One processor over the fake source and the in-memory store. */
function build(): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  processor: WebhookProcessor
  capture: ReturnType<typeof createCapture>
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const capture = createCapture()
  const options = resolveOptions({
    source,
    store,
    clock,
    accountResolver: () => null,
    observer: capture.observer,
    logger: capture.logger
  })
  const bridge = new ObserverBridge(options.observer, clock)
  const dispatcher = new ChangeDispatcher(() => undefined, store, options.logger, bridge)
  const refresher = new SnapshotRefresher(source, store, clock, null, dispatcher, bridge)
  const processor = new WebhookProcessor(
    source,
    store,
    clock,
    options,
    refresher,
    bridge,
    timerWait
  )
  return { source, store, processor, capture }
}

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
          await flush()
        })
      })
  )
  return settles
}

/** Fails the next read and delivers the request: the event fails and a removal is started. */
function fail(
  source: FakeSubscriptionSource,
  processor: WebhookProcessor,
  notification: SourceNotification = NOTIFICATION
): Promise<unknown> {
  source.failNextRead(new Error('source down'))
  return processor.process(source.buildRequest(notification))
}

describe('WebhookProcessor delivery while a removal is unsettled', () => {
  it('answers a failure, with no store call and no read, while the removal is pending', async () => {
    // Scenario: the removal is held; the source retries and gets a temporary failure, and
    // nothing is recorded or read for that delivery. Once the removal succeeded, the next
    // delivery is processed.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    const mark = jest.spyOn(store, 'markEventProcessed')
    await fail(source, processor)
    const request = source.buildRequest(NOTIFICATION)
    expect(await processor.process(request)).toStrictEqual({ kind: 'failed' })
    expect(mark).toHaveBeenCalledTimes(1)
    expect(source.totalReads).toBe(1)
    expect(removals).toHaveLength(1)
    await removals[0]?.(true)
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(mark).toHaveBeenCalledTimes(2)
    expect(source.totalReads).toBe(2)
  })

  it('starts the removal again after it failed, and processes once it succeeded', async () => {
    // Scenario: the first removal fails; the retry starts a new removal and gets a failure
    // without being processed; when that removal succeeds the next retry is processed.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    await fail(source, processor)
    await removals[0]?.(false)
    const request = source.buildRequest(NOTIFICATION)
    expect(await processor.process(request)).toStrictEqual({ kind: 'failed' })
    expect(removals).toHaveLength(2)
    expect(source.totalReads).toBe(1)
    await removals[1]?.(true)
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.totalReads).toBe(2)
  })

  it('starts one removal for each retry after a failed removal, never two at once', async () => {
    // Scenario: removals keep failing; each retry starts exactly one, and retries that arrive
    // while one is in flight start none.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    await fail(source, processor)
    await removals[0]?.(false)
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    expect(removals).toHaveLength(2)
    const concurrent = await Promise.all([processor.process(request), processor.process(request)])
    expect(concurrent).toStrictEqual([{ kind: 'failed' }, { kind: 'failed' }])
    expect(removals).toHaveLength(2)
    await removals[1]?.(false)
    expect(await processor.process(request)).toStrictEqual({ kind: 'failed' })
    expect(removals).toHaveLength(3)
    expect(source.totalReads).toBe(1)
  })

  it('still answers a duplicate of an event that never failed', async () => {
    // Scenario: nothing failed, so nothing is remembered and the second delivery is a duplicate.
    const { source, processor } = build()
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    expect(await processor.process(request)).toStrictEqual({ kind: 'duplicate' })
    expect(source.totalReads).toBe(1)
  })

  it('does not wait for a removal that never settles, on the failure and on the retry', async () => {
    // Scenario: the removal never returns; the failed delivery, a retry during it and a retry
    // after a failed removal that starts another one that never returns, are all answered at once.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    const request = source.buildRequest(NOTIFICATION)
    source.failNextRead(new Error('source down'))
    expect(await settledWithin(processor.process(request))).toStrictEqual({ kind: 'failed' })
    expect(await settledWithin(processor.process(request))).toStrictEqual({ kind: 'failed' })
    await removals[0]?.(false)
    expect(await settledWithin(processor.process(request))).toStrictEqual({ kind: 'failed' })
    expect(removals).toHaveLength(2)
  })

  it('reports a failed removal once to the log and the observer, without the identifier', async () => {
    // Scenario: the store raises its own error on the removal; the log holds one fixed sentence,
    // the observer hears the failed delivery once with the identifier retained, and the error text
    // and the identifier appear nowhere.
    const { source, store, processor, capture } = build()
    const removals = holdRemovals(store)
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    await fail(source, processor, { ...NOTIFICATION, eventId: 'sentinel-event-id' })
    await removals[0]?.(false)
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).toHaveBeenCalledTimes(0)
    expect(capture.lines).toStrictEqual([
      'A failed webhook event could not be forgotten; its identifier stays recorded: unclassified.'
    ])
    expect(capture.payloads.filter((entry) => entry.method === 'onWebhook')).toStrictEqual([
      { method: 'onWebhook', payload: { outcome: 'failed', durationMs: 0, retained: true } }
    ])
    expect(JSON.stringify([capture.lines, capture.payloads])).not.toContain('sentinel')
  })

  it('keeps every sentinel of the event out of the log and the observer on these paths', async () => {
    // Scenario: a pending removal, a failed one, a retry that restarts it, a success and a
    // duplicate, with the identifier, the account and the error text carrying sentinels (SEC06).
    const { source, store, processor, capture } = build()
    const [eventId, accountId] = ['sentinel-evt-3', 'sentinel-acc-3']
    const notification = { ...NOTIFICATION, eventId, accountIds: [accountId] }
    const removals = holdRemovals(store)
    const request = source.buildRequest(notification)
    await fail(source, processor, notification)
    await processor.process(request)
    await removals[0]?.(false)
    await processor.process(request)
    await removals[1]?.(true)
    await processor.process(request)
    await processor.process(request)
    assertNoSentinel(capture, [eventId, accountId, 'store down'])
    const heard = capture.payloads
      .filter((entry) => entry.method === 'onWebhook')
      .map((entry) => (entry.payload as { outcome: string }).outcome)
    expect(heard).toStrictEqual(['failed', 'failed', 'failed', 'processed', 'duplicate'])
  })
})
