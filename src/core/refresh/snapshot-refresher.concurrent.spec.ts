/**
 * @fileoverview Pins what the host's hook hears when several writers refresh one account over one
 * store: whatever the interleaving, the last thing it hears agrees with what the store ends with.
 * @layer core
 */
import { encodeAccountKey, type SubscriptionStore } from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import type { SubscriptionChangeNotification } from '../options/subscription-options.types'
import { SnapshotRefresher } from './snapshot-refresher'

const ACCOUNT = { accountId: 'acc-1' }
const KEY = encodeAccountKey(ACCOUNT)
const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:00:01.000Z'
const T9 = '2026-01-01T00:00:09.000Z'
const RECORD: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'product-1',
  billingInterval: 'P1M',
  currentPeriodStart: T0,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** The account with or without its one subscription. */
function state(isGranted: boolean): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: ACCOUNT.accountId, source: 'fake', fetchedAt: T0 }),
    subscriptions: isGranted ? [RECORD] : []
  }
}

/** Every notification the hook heard, as whether the state it carried gave the subscription. */
function listener(): { heard: boolean[]; hook: (n: SubscriptionChangeNotification) => void } {
  const heard: boolean[] = []
  return { heard, hook: (n) => void heard.push(n.current.subscriptions.length > 0) }
}

/** One writer: a process of its own, reading `isGranted` from the source at the instant `at`. */
function writer(
  store: SubscriptionStore,
  hook: (n: SubscriptionChangeNotification) => void,
  isGranted: boolean,
  at: string
): () => Promise<void> {
  const clock = new ManualClock(at)
  const source = new FakeSubscriptionSource()
  source.setAccount(ACCOUNT, state(isGranted))
  const observer = new ObserverBridge(null, clock)
  const dispatcher = new ChangeDispatcher(hook, store, { warn: () => undefined }, observer)
  const refresher = new SnapshotRefresher(source, store, clock, null, dispatcher, observer)
  return async () => {
    const result = await refresher.refresh(ACCOUNT)
    await result.delivery
  }
}

/** The store, running `between` before the conditional writes it is asked for, one each. */
function interrupted(
  base: InMemorySubscriptionStore,
  between: readonly (() => Promise<void>)[]
): SubscriptionStore {
  const queue = [...between]
  return {
    getSnapshot: (key) => base.getSnapshot(key),
    putSnapshot: (...args) => base.putSnapshot(...args),
    replaceSnapshot: async (...args) => {
      await queue.shift()?.()
      return base.replaceSnapshot(...args)
    },
    clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
    listKeysWithPendingChanges: (limit, cursor) => base.listKeysWithPendingChanges(limit, cursor),
    markEventProcessed: (...args) => base.markEventProcessed(...args),
    forgetEvent: (...args) => base.forgetEvent(...args),
    deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
    listStaleKeys: (...args) => base.listStaleKeys(...args)
  }
}

/** A store where the hook heard a grant and then, from a read at `T1`, its revocation. */
async function afterGrantAndRevocation(): Promise<
  ReturnType<typeof listener> & { store: InMemorySubscriptionStore }
> {
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const heard = listener()
  await writer(store, heard.hook, true, T0)()
  await writer(store, heard.hook, false, T1)()
  return { store, ...heard }
}

/** `count` writers, each a few milliseconds later, that grant and revoke in turn. */
function moving(
  store: SubscriptionStore,
  hook: (n: SubscriptionChangeNotification) => void,
  count: number
): (() => Promise<void>)[] {
  return Array.from({ length: count }, (_, index) =>
    writer(store, hook, index % 2 === 0, new Date(Date.parse(T1) + index * 10).toISOString())
  )
}

/** Whether the stored snapshot gives the subscription. */
async function isGrantedIn(store: SubscriptionStore): Promise<boolean> {
  return ((await store.getSnapshot(KEY))?.snapshot.subscriptions.length ?? 0) > 0
}

describe('what the hook hears under concurrent writers', () => {
  // A stale read that started in the same millisecond as the stored one lands between another
  // writer's comparison and its write.
  it('hears the revocation again after a stale grant of the same instant', async () => {
    const { store, heard, hook } = await afterGrantAndRevocation()
    const stale = writer(store, hook, true, T1)

    await writer(interrupted(store, [stale]), hook, false, T9)()

    expect((await store.getSnapshot(KEY))?.snapshot.subscriptions).toEqual([])
    expect(heard).toEqual([true, false, true, false])
  })

  // Two states stored in succession never share the instant they are told apart by.
  it('stores a read of the same instant one millisecond after the stored one', async () => {
    const { store, hook } = await afterGrantAndRevocation()
    const replace = jest.spyOn(store, 'replaceSnapshot')

    await writer(store, hook, true, T1)()

    const later = '2026-01-01T00:00:01.001Z'
    expect((await store.getSnapshot(KEY))?.snapshot.fetchedAt).toBe(later)
    expect(replace.mock.calls.map((call) => [call[1], call[4]])).toEqual([[T1, later]])
  })

  // The stored state moves before every conditional attempt, so none of them holds.
  it('writes nothing when the stored state moves under every attempt', async () => {
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const { heard, hook } = listener()
    const put = jest.fn(store.putSnapshot.bind(store))
    const slow = { ...interrupted(store, moving(store, hook, 20)), putSnapshot: put }

    await expect(writer(slow, hook, true, T9)()).rejects.toMatchObject({
      code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE'
    })

    expect(put).not.toHaveBeenCalled()
    expect(await isGrantedIn(store)).toBe(false)
    expect(heard).toEqual(Array.from({ length: 20 }, (_, index) => index % 2 === 0))
  })

  // The last attempt the refresh has is still a conditional write that can hold.
  it('writes on the twentieth attempt once the stored state stops moving', async () => {
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const { heard, hook } = listener()

    await writer(interrupted(store, moving(store, hook, 19)), hook, false, T9)()

    expect(await isGrantedIn(store)).toBe(false)
    expect(heard[heard.length - 1]).toBe(false)
  })
})
