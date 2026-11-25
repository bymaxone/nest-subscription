/**
 * @fileoverview Pins how reconciliation purges processed webhook event identifiers: once per run,
 * before anything else, at the instant the retention gives by the injected clock, and a failure
 * of the purge is logged by its code and does not end the run.
 * @layer core
 */
import { SubscriptionError, type SubscriptionStore } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock,
  createFailingStore
} from '@bymax-one/nest-subscription/testing'

import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { Reconciler } from './reconciler'

const T0 = '2026-01-10T00:00:00.000Z'
const DAY = 86_400_000

/** A reconciler over a store, with the log lines it writes. */
function setup(
  store: SubscriptionStore,
  eventRetentionMs?: number
): { reconciler: Reconciler; lines: string[]; clock: ManualClock } {
  const source = new FakeSubscriptionSource()
  const clock = new ManualClock(T0)
  const lines: string[] = []
  const options = resolveOptions({
    source,
    store,
    clock,
    accountResolver: () => null,
    logger: { warn: (line: string) => void lines.push(line) },
    ...(eventRetentionMs === undefined ? {} : { eventRetentionMs })
  })
  const bridge = new ObserverBridge(null, clock)
  const refresher = new SnapshotRefresher(source, store, clock, null, null, bridge)
  const dispatcher = new ChangeDispatcher(() => undefined, store, options.logger, bridge)
  return { reconciler: new Reconciler(store, clock, refresher, options, dispatcher), lines, clock }
}

describe('Reconciler event purge', () => {
  it('purges the identifiers older than the default retention of 7 days', async () => {
    // Scenario: with no retention set, the cut-off is seven days before now by the injected clock.
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const purge = jest.spyOn(store, 'deleteEventsOlderThan')
    const { reconciler } = setup(store)
    await reconciler.run({})
    expect(purge).toHaveBeenCalledTimes(1)
    expect(purge).toHaveBeenCalledWith('2026-01-03T00:00:00.000Z')
  })

  it('purges at the cut-off of the retention the host set', async () => {
    // Scenario: a retention of one day moves the cut-off to one day before now.
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const purge = jest.spyOn(store, 'deleteEventsOlderThan')
    const { reconciler } = setup(store, DAY)
    await reconciler.run({})
    expect(purge).toHaveBeenCalledWith('2026-01-09T00:00:00.000Z')
  })

  it('keeps an identifier younger than the retention and removes an older one', async () => {
    // Scenario: two identifiers recorded either side of the cut-off; only the older is forgotten,
    // so a later delivery of it is new again and a later delivery of the other is not.
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    await store.markEventProcessed('fake', 'old', '2026-01-02T00:00:00.000Z')
    await store.markEventProcessed('fake', 'young', '2026-01-08T00:00:00.000Z')
    const { reconciler } = setup(store)
    await reconciler.run({})
    expect(await store.markEventProcessed('fake', 'old', T0)).toBe(true)
    expect(await store.markEventProcessed('fake', 'young', T0)).toBe(false)
  })

  it('purges before it lists anything', async () => {
    // Scenario: the purge is the first store call of a run.
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const order: string[] = []
    jest.spyOn(store, 'deleteEventsOlderThan').mockImplementation(() => {
      order.push('purge')
      return Promise.resolve()
    })
    jest.spyOn(store, 'listKeysWithPendingChanges').mockImplementation(() => {
      order.push('pending')
      return Promise.resolve({ keys: [], nextCursor: null })
    })
    const { reconciler } = setup(store)
    await reconciler.run({})
    expect(order).toStrictEqual(['purge', 'pending'])
  })

  it('skips the purge when the retention reaches before the earliest instant', async () => {
    // Scenario: a retention longer than any date can represent leaves nothing older to purge.
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const purge = jest.spyOn(store, 'deleteEventsOlderThan')
    const { reconciler, lines } = setup(store, Number.MAX_SAFE_INTEGER)
    await expect(reconciler.run({})).resolves.toMatchObject({ failed: 0 })
    expect(purge).toHaveBeenCalledTimes(0)
    expect(lines).toStrictEqual([])
  })

  it('logs a failed purge by its code and still runs', async () => {
    // Scenario: the store cannot purge; the run goes on and the line holds a code and no text.
    const failing = createFailingStore(new InMemorySubscriptionStore({ logger: () => undefined }))
    failing.fail(
      ['deleteEventsOlderThan'],
      new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    )
    const { reconciler, lines } = setup(failing)
    await expect(reconciler.run({})).resolves.toMatchObject({ refreshed: 0, failed: 0 })
    expect(lines).toStrictEqual([
      'Processed webhook event identifiers could not be purged: SUBSCRIPTION_SOURCE_UNAVAILABLE.'
    ])
  })

  it("logs a purge failure that is not the library's as unclassified", async () => {
    // Scenario: the store's own error text never reaches the line.
    const failing = createFailingStore(new InMemorySubscriptionStore({ logger: () => undefined }))
    failing.fail(['deleteEventsOlderThan'], new Error('connection string secret'))
    const { reconciler, lines } = setup(failing)
    await reconciler.run({})
    expect(lines).toStrictEqual([
      'Processed webhook event identifiers could not be purged: unclassified.'
    ])
  })
})
