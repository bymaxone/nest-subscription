/**
 * @fileoverview Unit tests for a removal that settles after a retry of the same event succeeded.
 *
 * Goal: an event whose retry succeeded while a removal of its identifier was pending ends with its
 * identifier recorded, whatever order the removals settle in; a failure to record it again is
 * reported once without the identifier; and no answer waits for a removal or for that recording.
 * Mocks: the fake source and the in-memory store, with `forgetEvent` held so the test settles each
 * removal itself, and `markEventProcessed` failed or held where a case needs it.
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

/** A removal the test settles itself: it really removes the identifier when it succeeds. */
interface HeldRemoval {
  /** Settles the removal; a success removes the identifier from the store first. */
  readonly settle: (succeeds: boolean) => Promise<void>
}

/** Holds every removal the store is asked for, in the order they are asked. */
function holdRemovals(store: InMemorySubscriptionStore): HeldRemoval[] {
  const held: HeldRemoval[] = []
  const real = store.forgetEvent.bind(store)
  jest.spyOn(store, 'forgetEvent').mockImplementation(
    (sourceName, eventId) =>
      new Promise<void>((resolve, reject) => {
        held.push({
          settle: async (succeeds) => {
            if (succeeds) {
              await real(sourceName, eventId)
              resolve()
            } else {
              reject(new Error('store down'))
            }
            await flush()
          }
        })
      })
  )
  return held
}

/** Fails the next read and delivers the request: the event fails and a removal is started. */
async function fail(
  source: FakeSubscriptionSource,
  processor: WebhookProcessor,
  notification: SourceNotification = NOTIFICATION
): Promise<unknown> {
  source.failNextRead(new Error('source down'))
  return processor.process(source.buildRequest(notification))
}

describe('WebhookProcessor removal that settles after a retry succeeded', () => {
  it('records the identifier again when a removal succeeds after the retry', async () => {
    // Scenario: the retry is processed while removal A is pending; A then removes the identifier;
    // the processor records it again, so the next delivery is a duplicate with no read.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    await fail(source, processor)
    expect(await processor.process(source.buildRequest(NOTIFICATION))).toStrictEqual({
      kind: 'processed',
      accounts: 1
    })
    await removals[0]?.settle(true)
    const reads = source.totalReads
    expect(await processor.process(source.buildRequest(NOTIFICATION))).toStrictEqual({
      kind: 'duplicate'
    })
    expect(source.totalReads).toBe(reads)
  })

  it('leaves the identifier recorded when the removal fails after the retry', async () => {
    // Scenario: A fails, so the identifier is still recorded; the next delivery is a duplicate,
    // and nothing is recorded again.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    const mark = jest.spyOn(store, 'markEventProcessed')
    await fail(source, processor)
    await processor.process(source.buildRequest(NOTIFICATION))
    await removals[0]?.settle(false)
    expect(await processor.process(source.buildRequest(NOTIFICATION))).toStrictEqual({
      kind: 'duplicate'
    })
    expect(mark).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['A settles before the retry and B after it', ['A', 'retry', 'B']],
    ['B settles before the retry and A after it', ['B', 'retry', 'A']],
    ['both settle before the retry', ['A', 'B', 'retry']],
    ['the retry comes first and both settle after it', ['retry', 'A', 'B']],
    ['the retry comes first and they settle the other way round', ['retry', 'B', 'A']]
  ] as const)(
    'ends with the identifier recorded when %s (A succeeds, B fails)',
    async (_name, order) => {
      // Scenario: two removals, the event fails twice; one removal succeeds and the other fails,
      // and a retry is processed at each position. Whatever the order, the identifier ends
      // recorded, so the next delivery is a duplicate with no read.
      const { source, store, processor } = build()
      const removals = holdRemovals(store)
      await fail(source, processor)
      await fail(source, processor)
      const steps = {
        A: () => removals[0]?.settle(true),
        B: () => removals[1]?.settle(false),
        retry: () => processor.process(source.buildRequest(NOTIFICATION))
      }
      for (const step of order) await steps[step]()
      const reads = source.totalReads
      expect(await processor.process(source.buildRequest(NOTIFICATION))).toStrictEqual({
        kind: 'duplicate'
      })
      expect(source.totalReads).toBe(reads)
    }
  )

  it('processes a later delivery again when recording the identifier again fails', async () => {
    // Scenario: A erased the identifier after the retry and recording it again fails; a later
    // delivery is processed again, and the failure is logged and reported once by its code.
    const { source, store, processor, capture } = build()
    const removals = holdRemovals(store)
    const real = store.markEventProcessed.bind(store)
    const mark = jest.spyOn(store, 'markEventProcessed')
    await fail(source, processor)
    await processor.process(source.buildRequest(NOTIFICATION))
    mark.mockRejectedValueOnce(new Error('store down'))
    await removals[0]?.settle(true)
    mark.mockImplementation(real)
    const reads = source.totalReads
    expect(await processor.process(source.buildRequest(NOTIFICATION))).toStrictEqual({
      kind: 'processed',
      accounts: 1
    })
    expect(source.totalReads).toBe(reads + 1)
    expect(capture.lines).toStrictEqual([
      'A processed webhook event could not be recorded again; a later delivery of it is processed again: unclassified.'
    ])
    expect(
      capture.payloads.filter((entry) => entry.method === 'onEventRecordFailure')
    ).toStrictEqual([{ method: 'onEventRecordFailure', payload: { code: null } }])
  })

  it('handles a failure to record the identifier again without an unhandled rejection', async () => {
    // Scenario: the recording fails after the answer; nothing is left unhandled.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    const mark = jest.spyOn(store, 'markEventProcessed')
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    await fail(source, processor)
    await processor.process(source.buildRequest(NOTIFICATION))
    mark.mockRejectedValue(new Error('store down'))
    await removals[0]?.settle(true)
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).toHaveBeenCalledTimes(0)
  })

  it('keeps the event when a retry fails again, and forgets it once a removal succeeded', async () => {
    // Scenario: A is pending, the retry fails and B starts; A succeeding does not forget the event
    // while B is pending, so the next retry is processed without recording; once B settled the
    // identifier is gone and the event is forgotten, so the next delivery takes the normal path.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    const mark = jest.spyOn(store, 'markEventProcessed')
    await fail(source, processor)
    await fail(source, processor)
    expect(removals).toHaveLength(2)
    await removals[0]?.settle(true)
    await fail(source, processor)
    expect(mark).toHaveBeenCalledTimes(1)
    await removals[1]?.settle(true)
    await removals[2]?.settle(true)
    expect(await processor.process(source.buildRequest(NOTIFICATION))).toStrictEqual({
      kind: 'processed',
      accounts: 1
    })
    expect(mark).toHaveBeenCalledTimes(2)
  })

  it('answers neither a retry nor a failure by waiting for a removal or the recording', async () => {
    // Scenario: A is settled so the recording starts and is held; while it is held, a delivery
    // and a failed delivery are both answered at once, and the failed one starts its removal.
    const { source, store, processor } = build()
    const removals = holdRemovals(store)
    const mark = jest.spyOn(store, 'markEventProcessed')
    await fail(source, processor)
    await processor.process(source.buildRequest(NOTIFICATION))
    mark.mockReturnValueOnce(new Promise(() => undefined))
    await removals[0]?.settle(true)
    expect(mark).toHaveBeenCalledTimes(2)
    const retry = processor.process(source.buildRequest(NOTIFICATION))
    expect(await settledWithin(retry)).toStrictEqual({ kind: 'processed', accounts: 1 })
    source.failNextRead(new Error('source down'))
    const failing = processor.process(source.buildRequest(NOTIFICATION))
    expect(await settledWithin(failing)).toStrictEqual({ kind: 'failed' })
    expect(removals).toHaveLength(2)
  })

  it('keeps every sentinel of the event out of the log and the observer on these paths', async () => {
    // Scenario: a removal that succeeds after the retry, one that fails, a failed recording and
    // a failure that starts a second removal, with the identifier, the account and the error text
    // carrying sentinels (SEC06).
    const { source, store, processor, capture } = build()
    const [eventId, accountId, errorText] = ['sentinel-evt-7', 'sentinel-acc-7', 'sentinel-err-7']
    const sentinels = [eventId, accountId, errorText]
    const removals = holdRemovals(store)
    const mark = jest.spyOn(store, 'markEventProcessed')
    const notification = { ...NOTIFICATION, eventId, accountIds: [accountId] }
    const request = source.buildRequest(notification)
    await fail(source, processor, notification)
    await processor.process(request)
    mark.mockRejectedValueOnce(new Error(errorText))
    await removals[0]?.settle(true)
    await fail(source, processor, notification)
    await fail(source, processor, notification)
    await removals[1]?.settle(false)
    await removals[2]?.settle(false)
    await processor.process(request)
    assertNoSentinel(capture, sentinels)
    expect(capture.lines.length).toBeGreaterThan(0)
  })
})
