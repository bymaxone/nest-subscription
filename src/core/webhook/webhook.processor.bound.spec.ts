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

/** A processor whose store can never remove an identifier, and every failed event it handled. */
async function afterFailures(count: number): Promise<{
  source: FakeSubscriptionSource
  processor: WebhookProcessor
}> {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  jest.spyOn(store, 'forgetEvent').mockRejectedValue(new Error('store down'))
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
  return { source, processor }
}

describe('WebhookProcessor bound on remembered failed events', () => {
  it('fixes the bound at one thousand events', () => {
    // Scenario: the bound is a documented constant of the processor.
    expect(UNRELEASED_EVENTS_BOUND).toBe(1000)
  })

  it('still processes the oldest event when exactly the bound many failed', async () => {
    // Scenario: at the bound nothing is dropped, so the oldest event's retry is processed.
    const { source, processor } = await afterFailures(UNRELEASED_EVENTS_BOUND)
    const reads = source.totalReads
    const retry = await processor.process(source.buildRequest(event(1)))
    expect(retry).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.totalReads).toBe(reads + 1)
  })

  it('drops the oldest event past the bound and answers its retry as the store says', async () => {
    // Scenario: one event more than the bound failed, so the oldest was forgotten by the
    // processor; the store still holds its identifier, so the retry is a duplicate, while the
    // newest event's retry is still processed.
    const { source, processor } = await afterFailures(UNRELEASED_EVENTS_BOUND + 1)
    const reads = source.totalReads
    expect(await processor.process(source.buildRequest(event(1)))).toStrictEqual({
      kind: 'duplicate'
    })
    expect(source.totalReads).toBe(reads)
    expect(
      await processor.process(source.buildRequest(event(UNRELEASED_EVENTS_BOUND + 1)))
    ).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(await processor.process(source.buildRequest(event(2)))).toStrictEqual({
      kind: 'processed',
      accounts: 1
    })
  })
})
