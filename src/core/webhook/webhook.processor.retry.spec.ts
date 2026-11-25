/**
 * @fileoverview Unit tests for the retry of a failed event whose identifier has not been removed.
 *
 * Goal: a delivery of an event that failed is processed when the removal of its identifier is
 * still pending or failed, in the same process, and not answered as a duplicate; a duplicate of a
 * processed event is still a duplicate; concurrent retries make one read; and nothing of the
 * event reaches a log line or an observer payload.
 * Mocks: the fake source and the in-memory store, with `forgetEvent` held or rejected by hand.
 * @layer core
 */
import {
  encodeAccountKey,
  type AccountReference,
  type SourceNotification
} from '@bymax-one/nest-subscription/internal'
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
const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const NOTIFICATION: SourceNotification = {
  eventId: 'evt-1',
  accountIds: ['acc-1'],
  kind: 'RENEWAL',
  eventTime: T0,
  environment: 'production'
}

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
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

/** A removal the test settles itself. */
function heldRemoval(): { promise: Promise<void>; remove: () => void; fail: () => void } {
  let remove = (): void => undefined
  let fail = (): void => undefined
  const promise = new Promise<void>((resolve, reject) => {
    remove = resolve
    fail = () => reject(new Error('store down'))
  })
  return { promise, remove, fail }
}

describe('WebhookProcessor retry of a failed event', () => {
  it('processes a retry that arrives while the removal is still pending', async () => {
    // Scenario: the first delivery fails and its removal never returns; the source retries the
    // event and gets it processed, not answered as already seen (D16).
    const { source, store, processor } = build()
    const mark = jest.spyOn(store, 'markEventProcessed')
    jest.spyOn(store, 'forgetEvent').mockReturnValue(heldRemoval().promise)
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    expect(await processor.process(request)).toStrictEqual({ kind: 'failed' })
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.readCount(ACCOUNT)).toBe(2)
    expect(mark).toHaveBeenCalledTimes(1)
  })

  it('processes a retry after the removal failed, in the same process', async () => {
    // Scenario: the store could not remove the identifier, so it is still recorded; the retry is
    // processed anyway, and the identifier is not recorded a second time.
    const { source, store, processor } = build()
    const mark = jest.spyOn(store, 'markEventProcessed')
    jest.spyOn(store, 'forgetEvent').mockRejectedValue(new Error('store down'))
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    await flush()
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.readCount(ACCOUNT)).toBe(2)
    expect(mark).toHaveBeenCalledTimes(1)
  })

  it('takes the normal path for a retry after the removal succeeded', async () => {
    // Scenario: the removal completed before the retry, so the retry records the identifier again.
    const { source, store, processor } = build()
    const mark = jest.spyOn(store, 'markEventProcessed')
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    await flush()
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(mark).toHaveBeenCalledTimes(2)
  })

  it('still answers a duplicate of a processed event as a duplicate', async () => {
    // Scenario: nothing failed, so nothing is remembered and the second delivery is a duplicate.
    const { source, processor } = build()
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    expect(await processor.process(request)).toStrictEqual({ kind: 'duplicate' })
    expect(source.readCount(ACCOUNT)).toBe(1)
  })

  it('answers a duplicate after a retry processed under a failed removal succeeded', async () => {
    // Scenario: the identifier is still recorded after the reprocessing, so later deliveries are
    // duplicates and are no longer remembered as unreleased.
    const { source, store, processor } = build()
    jest.spyOn(store, 'forgetEvent').mockRejectedValue(new Error('store down'))
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    await flush()
    await processor.process(request)
    expect(await processor.process(request)).toStrictEqual({ kind: 'duplicate' })
    expect(source.readCount(ACCOUNT)).toBe(2)
  })

  it('starts a new removal and keeps processing retries when a retry fails again', async () => {
    // Scenario: the first removal is pending, the retry fails, a second removal starts, and the
    // next retry is processed; the second removal outlives the first, which does not forget it.
    const { source, store, processor } = build()
    const first = heldRemoval()
    const second = heldRemoval()
    const forget = jest
      .spyOn(store, 'forgetEvent')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const mark = jest.spyOn(store, 'markEventProcessed')
    source.failNextRead(new Error('source down'))
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    expect(await processor.process(request)).toStrictEqual({ kind: 'failed' })
    expect(await processor.process(request)).toStrictEqual({ kind: 'failed' })
    expect(forget).toHaveBeenCalledTimes(2)
    first.remove()
    await flush()
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.readCount(ACCOUNT)).toBe(3)
    expect(mark).toHaveBeenCalledTimes(1)
  })

  it('forgets the identifier once the latest removal succeeds', async () => {
    // Scenario: after the latest removal settles the identifier is gone from the store, so the
    // retry takes the normal path and records it again.
    const { source, store, processor } = build()
    const removal = heldRemoval()
    jest.spyOn(store, 'forgetEvent').mockReturnValue(removal.promise)
    const mark = jest.spyOn(store, 'markEventProcessed')
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    removal.remove()
    await flush()
    await processor.process(request)
    expect(mark).toHaveBeenCalledTimes(2)
  })

  it('makes one source read for two concurrent retries of a pending identifier', async () => {
    // Scenario: both retries are processed and share the refresher's single flight.
    const { source, store, processor } = build()
    jest.spyOn(store, 'forgetEvent').mockReturnValue(heldRemoval().promise)
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    const release = source.delayNextRead()
    const retries = Promise.all([processor.process(request), processor.process(request)])
    await flush()
    release()
    expect(await retries).toStrictEqual([
      { kind: 'processed', accounts: 1 },
      { kind: 'processed', accounts: 1 }
    ])
    expect(source.readCount(ACCOUNT)).toBe(2)
  })

  it('keeps every sentinel of the event out of the log and the observer on these paths', async () => {
    // Scenario: a pending removal, a failed one, a processed retry and a duplicate, with the
    // identifier, the account and the error text carrying sentinels (SEC06).
    const { source, store, processor, capture } = build()
    const [eventId, accountId, errorText] = [
      'sentinel-event-9',
      'sentinel-account-9',
      'sentinel-error-9'
    ]
    const sentinels = [eventId, accountId, errorText]
    const notification = { ...NOTIFICATION, eventId, accountIds: [accountId] }
    const request = source.buildRequest(notification)
    jest.spyOn(store, 'forgetEvent').mockRejectedValue(new Error(errorText))
    source.failNextRead(new Error(errorText))
    await processor.process(request)
    await flush()
    await processor.process(request)
    await processor.process(request)
    assertNoSentinel(capture, sentinels)
    const heard = capture.payloads
      .filter((entry) => entry.method === 'onWebhook')
      .map((entry) => (entry.payload as { outcome: string }).outcome)
    expect(heard).toStrictEqual(['failed', 'processed', 'duplicate'])
    expect(await store.getSnapshot(encodeAccountKey({ accountId }))).not.toBeNull()
  })
})
