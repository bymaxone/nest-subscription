/**
 * @fileoverview Pins reconciliation: only accounts older than the threshold are refreshed, a run
 * stops at its batch bound and at its rate, the cursor and the remaining count let the host carry
 * on, one account's failure does not end the run, and time and waiting come from the injected
 * clock and the caller's function. No case waits on a timer.
 * @layer core
 */
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { resolveOptions } from '../options/resolve-options'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { Reconciler } from './reconciler'

const T0 = '2026-01-01T00:00:00.000Z'
const DAY = 86_400_000

/** A snapshot of an account fetched at the given instant. */
function fetchedAt(
  account: AccountReference,
  instant: string,
  sourceUpdatedAt: string | null = null
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: instant
    }),
    sourceUpdatedAt
  }
}

/** The account named `acc-<n>`, with its number padded so the keys sort as the numbers do. */
function account(n: number): AccountReference {
  return { accountId: `acc-${String(n).padStart(5, '0')}` }
}

/** A reconciler over a fresh source, store and clock. */
function setup(extra: { multiTenant?: boolean; maxSnapshotAgeMs?: number } = {}): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  reconciler: Reconciler
  reads: number[]
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const options = resolveOptions({ source, store, clock, accountResolver: () => null, ...extra })
  const refresher = new SnapshotRefresher(source, store, clock, null)
  const reads: number[] = []
  const original = source.readAccount.bind(source)
  jest.spyOn(source, 'readAccount').mockImplementation((reference) => {
    reads.push(clock.now().getTime())
    return original(reference)
  })
  return {
    source,
    store,
    clock,
    reconciler: new Reconciler(store, clock, refresher, options),
    reads
  }
}

/** Stores `count` accounts fetched at `instant`. */
async function seed(
  store: SubscriptionStore,
  count: number,
  instant = T0,
  from = 1
): Promise<void> {
  for (let n = from; n < from + count; n += 1) {
    const reference = account(n)
    await store.putSnapshot(encodeAccountKey(reference), fetchedAt(reference, instant), [], instant)
  }
}

/** The store with some methods replaced; the others reach it unchanged. */
function delegating(
  base: SubscriptionStore,
  overrides: Partial<SubscriptionStore>
): SubscriptionStore {
  return {
    getSnapshot: (key) => base.getSnapshot(key),
    putSnapshot: (key, snapshot, changes, at) => base.putSnapshot(key, snapshot, changes, at),
    clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
    listKeysWithPendingChanges: (limit, cursor) => base.listKeysWithPendingChanges(limit, cursor),
    markEventProcessed: (name, id, at) => base.markEventProcessed(name, id, at),
    forgetEvent: (name, id) => base.forgetEvent(name, id),
    deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
    listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor),
    ...overrides
  }
}

/** A wait that moves the manual clock by the time asked, as a host's timer would. */
function advancing(clock: ManualClock): (ms: number) => Promise<void> {
  return (ms) => {
    clock.advance(ms)
    return Promise.resolve()
  }
}

describe('Reconciler', () => {
  it('refreshes only the accounts older than the threshold', async () => {
    // Scenario: three accounts a day and a half old, two an hour old; a threshold of a day.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 3, T0)
    clock.advance(DAY + DAY / 2)
    await seed(store, 2, new Date(clock.now().getTime() - 3_600_000).toISOString(), 4)
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(result).toEqual({ refreshed: 3, failed: 0, remaining: 0, cursor: null })
    expect([1, 2, 3].map((n) => source.readCount(account(n)))).toEqual([1, 1, 1])
    expect([4, 5].map((n) => source.readCount(account(n)))).toEqual([0, 0])
  })

  it('uses the maximum snapshot age as the threshold when none is given', async () => {
    // Scenario: a host that set a one-hour maximum age; accounts two hours and ten minutes old.
    const { source, store, clock, reconciler } = setup({ maxSnapshotAgeMs: 3_600_000 })
    await seed(store, 1, T0)
    await seed(store, 1, new Date(Date.parse(T0) + 2 * 3_600_000).toISOString(), 2)
    clock.advance(2 * 3_600_000 + 600_000)
    const result = await reconciler.run({ wait: advancing(clock) })
    expect(result.refreshed).toBe(1)
    expect(source.readCount(account(1))).toBe(1)
    expect(source.readCount(account(2))).toBe(0)
  })

  it('stops at the batch bound and reports how many remain and where to go on', async () => {
    // Scenario: ten stale accounts, a batch of four; two more runs finish the rest, each account once.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 10)
    clock.advance(2 * DAY)
    const options = { olderThanMs: DAY, batchSize: 4, wait: advancing(clock) }
    const first = await reconciler.run(options)
    expect(first).toMatchObject({ refreshed: 4, failed: 0, remaining: 6 })
    expect(first.cursor).not.toBeNull()
    const second = await reconciler.run({ ...options, cursor: first.cursor })
    expect(second).toMatchObject({ refreshed: 4, failed: 0, remaining: 2 })
    const third = await reconciler.run({ ...options, cursor: second.cursor })
    expect(third).toEqual({ refreshed: 2, failed: 0, remaining: 0, cursor: null })
    expect(Array.from({ length: 10 }, (_, n) => source.readCount(account(n + 1)))).toEqual(
      Array.from({ length: 10 }, () => 1)
    )
  })

  it('refreshes an account at most once in a run, so the next run without a cursor sees only the rest', async () => {
    // Scenario: refreshed accounts are fresh, so a second run from the start meets the others only.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 6)
    clock.advance(2 * DAY)
    const options = { olderThanMs: DAY, batchSize: 4, wait: advancing(clock) }
    await reconciler.run(options)
    const next = await reconciler.run(options)
    expect(next).toEqual({ refreshed: 2, failed: 0, remaining: 0, cursor: null })
    expect(source.totalReads).toBe(6)
  })

  it('pages through the store to the end when the batch is larger than a page', async () => {
    // Scenario: two hundred and fifty stale accounts and a large batch; three pages are read and
    // every account is refreshed once.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 250)
    clock.advance(2 * DAY)
    const listed: number[] = []
    const spying = delegating(store, {
      listStaleKeys: (olderThan, limit, cursor) => {
        listed.push(limit)
        return store.listStaleKeys(olderThan, limit, cursor)
      }
    })
    const refresher = new SnapshotRefresher(source, store, clock, null)
    const options = resolveOptions({ source, store: spying, clock, accountResolver: () => null })
    const result = await new Reconciler(spying, clock, refresher, options).run({
      olderThanMs: DAY,
      batchSize: 1000,
      maxCallsPerSecond: 1000,
      wait: advancing(clock)
    })
    expect(result).toEqual({ refreshed: 250, failed: 0, remaining: 0, cursor: null })
    expect(listed).toEqual([100, 100, 100])
    expect(source.totalReads).toBe(250)
  })

  it('follows a store whose pages are smaller than the limit it was asked for', async () => {
    // Scenario: the store returns one key fewer than asked, which its port allows.
    const { source, store, clock } = setup()
    await seed(store, 30)
    clock.advance(2 * DAY)
    const short = delegating(store, {
      listStaleKeys: (olderThan, limit, cursor) =>
        store.listStaleKeys(olderThan, Math.max(1, limit - 7), cursor)
    })
    const refresher = new SnapshotRefresher(source, store, clock, null)
    const options = resolveOptions({ source, store: short, clock, accountResolver: () => null })
    const result = await new Reconciler(short, clock, refresher, options).run({
      olderThanMs: DAY,
      batchSize: 30,
      maxCallsPerSecond: 1000,
      wait: advancing(clock)
    })
    expect(result).toEqual({ refreshed: 30, failed: 0, remaining: 0, cursor: null })
  })

  it('counts what remains across every page after the batch is spent', async () => {
    // Scenario: two thousand five hundred stale accounts and a batch of one; the count needs three
    // pages of the counting scan and gives the exact number.
    const { store, clock, reconciler } = setup()
    await seed(store, 2500)
    clock.advance(2 * DAY)
    const result = await reconciler.run({ olderThanMs: DAY, batchSize: 1, wait: advancing(clock) })
    expect(result).toMatchObject({ refreshed: 1, failed: 0, remaining: 2499 })
  })

  it('never starts more refreshes in a window than the rate allows, measured on the clock', async () => {
    // Scenario: twelve stale accounts at three a second, with a wait that advances the clock; any
    // four consecutive source reads span at least a second.
    const { store, clock, reconciler, reads } = setup()
    await seed(store, 12)
    clock.advance(2 * DAY)
    const result = await reconciler.run({
      olderThanMs: DAY,
      maxCallsPerSecond: 3,
      wait: advancing(clock)
    })
    expect(result.refreshed).toBe(12)
    expect(reads).toHaveLength(12)
    for (let index = 0; index + 3 < reads.length; index += 1) {
      expect((reads[index + 3] ?? 0) - (reads[index] ?? 0)).toBeGreaterThanOrEqual(1000)
    }
    expect((reads[11] ?? 0) - (reads[0] ?? 0)).toBe(3000)
  })

  it('stops when the rate is spent and no wait is given, and the next run carries on', async () => {
    // Scenario: ten stale accounts at four a second with no wait; the run ends after four, says six
    // remain, and a run after the clock moves a second does the next four.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 10)
    clock.advance(2 * DAY)
    const first = await reconciler.run({ olderThanMs: DAY, maxCallsPerSecond: 4 })
    expect(first).toMatchObject({ refreshed: 4, failed: 0, remaining: 6 })
    expect(source.totalReads).toBe(4)
    clock.advance(1000)
    const second = await reconciler.run({
      olderThanMs: DAY,
      maxCallsPerSecond: 4,
      cursor: first.cursor
    })
    expect(second).toMatchObject({ refreshed: 4, remaining: 2 })
    expect(source.totalReads).toBe(8)
  })

  it('counts the accounts of later pages too when the rate ends a run in the first page', async () => {
    // Scenario: two hundred and fifty stale accounts and four slots; the rest are 246.
    const { store, clock, reconciler } = setup()
    await seed(store, 250)
    clock.advance(2 * DAY)
    const result = await reconciler.run({ olderThanMs: DAY, maxCallsPerSecond: 4 })
    expect(result).toMatchObject({ refreshed: 4, failed: 0, remaining: 246 })
  })

  it('accepts a threshold of zero and refreshes everything fetched before now', async () => {
    // Scenario: a zero threshold is valid; an account fetched a millisecond ago is older than now.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 2)
    clock.advance(1)
    const result = await reconciler.run({ olderThanMs: 0 })
    expect(result.refreshed).toBe(2)
    expect(source.totalReads).toBe(2)
  })

  it('keeps the cursor of the page it stopped in when the rate ends a run part-way through it', async () => {
    // Scenario: after the first run the accounts it did refresh are no longer stale, so the second
    // run from the same cursor meets the six that were left, none twice.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 10)
    clock.advance(2 * DAY)
    const first = await reconciler.run({ olderThanMs: DAY, maxCallsPerSecond: 4 })
    clock.advance(5000)
    const second = await reconciler.run({
      olderThanMs: DAY,
      maxCallsPerSecond: 100,
      cursor: first.cursor,
      wait: advancing(clock)
    })
    expect(second).toEqual({ refreshed: 6, failed: 0, remaining: 0, cursor: null })
    expect(source.totalReads).toBe(10)
  })

  it('does not stop the run for an account whose source read fails', async () => {
    // Scenario: the first of five reads fails; the other four are refreshed, the failed account
    // keeps its stored snapshot, and the source was asked about all five.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 5)
    clock.advance(2 * DAY)
    const key = encodeAccountKey(account(1))
    const before = await store.getSnapshot(key)
    source.failNextRead(new Error('down'))
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(result).toEqual({ refreshed: 4, failed: 1, remaining: 0, cursor: null })
    expect(source.totalReads).toBe(5)
    expect(await store.getSnapshot(key)).toEqual(before)
  })

  it('leaves the stored snapshot of an account whose read failed as it was and keeps it stale', async () => {
    // Scenario: every read fails; every account is failed, none is changed, all are still stale.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 3)
    clock.advance(2 * DAY)
    for (let n = 0; n < 3; n += 1) source.failNextRead(new Error('down'))
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(result).toMatchObject({ refreshed: 0, failed: 3, remaining: 0 })
    const stale = await store.listStaleKeys(
      new Date(clock.now().getTime() - DAY).toISOString(),
      10,
      null
    )
    expect(stale.keys).toHaveLength(3)
  })

  it('keeps the stored snapshot when the source reports an older state', async () => {
    // Scenario: the stored snapshot is as of a later source instant than the source now reports.
    const { source, store, clock, reconciler } = setup()
    const reference = account(1)
    const key = encodeAccountKey(reference)
    await store.putSnapshot(
      key,
      fetchedAt(reference, T0, '2026-01-01T12:00:00.000Z'),
      [],
      '2026-01-01T12:00:00.000Z'
    )
    source.setAccount(reference, fetchedAt(reference, T0, '2026-01-01T06:00:00.000Z'))
    clock.advance(2 * DAY)
    const before = await store.getSnapshot(key)
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(result).toMatchObject({ refreshed: 1, failed: 0 })
    expect(await store.getSnapshot(key)).toEqual(before)
  })

  it('changes nothing but the fetch instant when the source reports the same state', async () => {
    // Scenario: the source reports the state that is stored; only the fetch instant moves.
    const { source, store, clock, reconciler } = setup()
    const reference = account(1)
    const key = encodeAccountKey(reference)
    const sourceInstant = '2026-01-01T06:00:00.000Z'
    await store.putSnapshot(key, fetchedAt(reference, T0, sourceInstant), [], sourceInstant)
    source.setAccount(reference, fetchedAt(reference, T0, sourceInstant))
    clock.advance(2 * DAY)
    await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    const after = (await store.getSnapshot(key))?.snapshot
    expect(after).toEqual({ ...fetchedAt(reference, clock.now().toISOString(), sourceInstant) })
  })

  it('fails a key the library did not write, without calling the source', async () => {
    // Scenario: a store that lists a foreign key beside a real one.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 1)
    await store.putSnapshot('foreign-key', fetchedAt(account(9), T0), [], T0)
    clock.advance(2 * DAY)
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(result).toMatchObject({ refreshed: 1, failed: 1, remaining: 0 })
    expect(source.totalReads).toBe(1)
  })

  it('fails an account with no tenant, without calling the source, when the host is multi-tenant', async () => {
    // Scenario: a multi-tenant host whose store holds an account stored with no tenant.
    const { source, store, clock, reconciler } = setup({ multiTenant: true })
    const withTenant: AccountReference = { tenantId: 'one', accountId: 'acc-1' }
    await store.putSnapshot(encodeAccountKey(withTenant), fetchedAt(withTenant, T0), [], T0)
    await seed(store, 1)
    clock.advance(2 * DAY)
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(result).toMatchObject({ refreshed: 1, failed: 1, remaining: 0 })
    expect(source.readCount(withTenant)).toBe(1)
    expect(source.readCount(account(1))).toBe(0)
  })

  it('reports nothing to do when no account is stale', async () => {
    // Scenario: an empty store.
    const { source, reconciler } = setup()
    expect(await reconciler.run({})).toEqual({
      refreshed: 0,
      failed: 0,
      remaining: 0,
      cursor: null
    })
    expect(source.totalReads).toBe(0)
  })

  it('lets a failure of the store listing reject the run', async () => {
    // Scenario: the store cannot list; the run has nothing to go on and says so.
    const { source, store, clock } = setup()
    const failure = new Error('store down')
    const broken = delegating(store, { listStaleKeys: () => Promise.reject(failure) })
    const refresher = new SnapshotRefresher(source, store, clock, null)
    const options = resolveOptions({ source, store: broken, clock, accountResolver: () => null })
    await expect(new Reconciler(broken, clock, refresher, options).run({})).rejects.toBe(failure)
  })

  it.each([
    ['a batch of zero', { batchSize: 0 }],
    ['a batch that is not whole', { batchSize: 1.5 }],
    ['a rate of zero', { maxCallsPerSecond: 0 }],
    ['a rate that is not whole', { maxCallsPerSecond: 0.5 }],
    ['a negative threshold', { olderThanMs: -1 }],
    ['a threshold that is not a number', { olderThanMs: Number.NaN }],
    ['a threshold that is not finite', { olderThanMs: Number.POSITIVE_INFINITY }],
    ['a threshold older than any instant', { olderThanMs: Number.MAX_VALUE }]
  ])('refuses %s as invalid input before listing or reading anything', async (_name, options) => {
    // Scenario: an option outside its range stops the run at once.
    const { source, store, reconciler } = setup()
    const listing = jest.spyOn(store, 'listStaleKeys')
    const error = await reconciler.run(options).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SubscriptionError)
    expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    expect(listing).not.toHaveBeenCalled()
    expect(source.totalReads).toBe(0)
  })

  it('starts no timer of its own while it runs', async () => {
    // Scenario: a run that stops at its rate, and one that waits through a function it was given;
    // neither calls the runtime's timer functions.
    const { store, clock, reconciler } = setup()
    const timeout = jest.spyOn(globalThis, 'setTimeout')
    const interval = jest.spyOn(globalThis, 'setInterval')
    await seed(store, 6)
    clock.advance(2 * DAY)
    await reconciler.run({ olderThanMs: DAY, maxCallsPerSecond: 2 })
    await reconciler.run({ olderThanMs: DAY, maxCallsPerSecond: 2, wait: advancing(clock) })
    expect(timeout).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
  })

  it('names no account in a failure it counts', async () => {
    // Scenario: the result of a run with a failed account holds counts and a cursor only.
    const { source, store, clock, reconciler } = setup()
    await seed(store, 1)
    clock.advance(2 * DAY)
    source.failNextRead(new Error('down for acc-00001'))
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(Object.keys(result).sort()).toEqual(['cursor', 'failed', 'refreshed', 'remaining'])
    expect(JSON.stringify(result)).not.toContain('acc-00001')
  })
})
