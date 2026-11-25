/**
 * @fileoverview Unit tests for the bound on the failed events the processor remembers.
 *
 * Goal: the processor remembers at most the bound's number of failed events whose removal failed,
 * the oldest drops out first, and an event that dropped out is answered as the store says.
 * Mocks: the fake source and the in-memory store, with `forgetEvent` rejected so every failed
 * event stays remembered and recorded.
 * @layer core
 */
import type { SourceNotification } from '@bymax-one/nest-subscription/internal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { timerWait } from './deadline'
import { UNRELEASED_EVENTS_BOUND } from './unreleased-events'
import { WebhookProcessor } from './webhook.processor'

const T0 = '2026-01-01T00:00:00.000Z'

/** The notification of the nth event. */
function event(n: number): SourceNotification {
  return {
    eventId: `evt-${String(n)}`,
    accountIds: ['acc-1'],
    kind: 'RENEWAL',
    eventTime: T0,
    environment: 'production'
  }
}

/** What `afterFailures` leaves for a test. */
interface Aftermath {
  readonly source: FakeSubscriptionSource
  readonly store: InMemorySubscriptionStore
  readonly processor: WebhookProcessor
  /** Settles the removals that were held, in the order they were asked for. */
  readonly settles: Array<(succeeds: boolean) => void>
}

/**
 * A processor after `count` events failed. With `hold` every removal stays in flight until the
 * test settles it; without it every removal fails at once, so every event stays recorded.
 */
async function afterFailures(count: number, hold = false): Promise<Aftermath> {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const settles: Array<(succeeds: boolean) => void> = []
  const real = store.forgetEvent.bind(store)
  jest.spyOn(store, 'forgetEvent').mockImplementation((sourceName, eventId) => {
    if (!hold) return Promise.reject(new Error('store down'))
    return new Promise<void>((resolve, reject) => {
      settles.push((succeeds) => {
        if (succeeds) void real(sourceName, eventId).then(resolve)
        else reject(new Error('store down'))
      })
    })
  })
  const clock = new ManualClock(T0)
  const options = resolveOptions({
    source,
    store,
    clock,
    accountResolver: () => null,
    logger: { warn: () => undefined }
  })
  const bridge = new ObserverBridge(null, clock)
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
  for (let n = 1; n <= count; n += 1) {
    source.failNextRead(new Error('source down'))
    await processor.process(source.buildRequest(event(n)))
  }
  return { source, store, processor, settles }
}

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
}

describe('WebhookProcessor bound on remembered failed events', () => {
  it('fixes the bound at one thousand events', () => {
    // Scenario: the bound is a documented constant of the processor.
    expect(UNRELEASED_EVENTS_BOUND).toBe(1000)
  })

  it('still remembers the oldest event when exactly the bound many failed', async () => {
    // Scenario: at the bound nothing is dropped, so the oldest event is still answered as a
    // failure, without a read, and its removal is started again.
    const { source, store, processor } = await afterFailures(UNRELEASED_EVENTS_BOUND)
    await flush()
    const removals = jest.spyOn(store, 'forgetEvent')
    removals.mockClear()
    const reads = source.totalReads
    const retry = await processor.process(source.buildRequest(event(1)))
    expect(retry).toStrictEqual({ kind: 'failed' })
    expect(source.totalReads).toBe(reads)
    expect(removals).toHaveBeenCalledTimes(1)
  })

  it('drops the oldest event past the bound and answers its retry as already seen', async () => {
    // Scenario: one event more than the bound failed and every removal failed, so the oldest was
    // forgotten while its identifier is still recorded: its retry is a duplicate. The newest event
    // and the second oldest are still remembered and answered as failures.
    const { source, processor } = await afterFailures(UNRELEASED_EVENTS_BOUND + 1)
    await flush()
    const reads = source.totalReads
    expect(await processor.process(source.buildRequest(event(1)))).toStrictEqual({
      kind: 'duplicate'
    })
    expect(
      await processor.process(source.buildRequest(event(UNRELEASED_EVENTS_BOUND + 1)))
    ).toStrictEqual({ kind: 'failed' })
    expect(await processor.process(source.buildRequest(event(2)))).toStrictEqual({
      kind: 'failed'
    })
    expect(source.totalReads).toBe(reads)
  })

  it('settles the removal of an event dropped while it was in flight without effect', async () => {
    // Scenario: the oldest event is dropped past the bound with its removal still in flight; the
    // removal then succeeds and the identifier is gone, so a later delivery of the event is
    // recorded and processed as new.
    const { source, processor, settles } = await afterFailures(UNRELEASED_EVENTS_BOUND + 1, true)
    settles[0]?.(true)
    await flush()
    const request = source.buildRequest(event(1))
    expect(await processor.process(request)).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(await processor.process(request)).toStrictEqual({ kind: 'duplicate' })
  })

  it('answers the removal of a dropped event that failed as already seen', async () => {
    // Scenario: the same, but the removal fails: the identifier stays recorded and the later
    // delivery of the dropped event is a duplicate (the documented limit of the bound).
    const { source, processor, settles } = await afterFailures(UNRELEASED_EVENTS_BOUND + 1, true)
    settles[0]?.(false)
    await flush()
    expect(await processor.process(source.buildRequest(event(1)))).toStrictEqual({
      kind: 'duplicate'
    })
  })
})
