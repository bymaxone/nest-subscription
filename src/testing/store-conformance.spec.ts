/**
 * @fileoverview Proves the conformance suite both ways: the in-memory store passes every case, and
 * each deliberately broken store fails on the named cases that state the guarantee it breaks.
 * @layer testing
 */
import type { KeyPage } from '@bymax-one/nest-subscription/internal'
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import { BROKEN_STORES, VALID_VARIANTS } from './broken-stores.fixture'
import { InMemorySubscriptionStore } from './in-memory.store'
import {
  storeConformanceCases,
  type StoreConformanceCase,
  type StoreFactory
} from './store-conformance'

/** The names of the cases a store factory fails. */
async function failures(
  cases: readonly StoreConformanceCase[],
  factory: StoreFactory
): Promise<string[]> {
  const failed: string[] = []
  for (const conformance of cases) {
    try {
      await conformance.run(factory)
    } catch {
      failed.push(conformance.name)
    }
  }
  return failed
}

const CASE = {
  unknownIsNull: 'returns null for a key never written',
  readsBack: 'reads back the snapshot and the pending changes it was given',
  accountsApart: 'keeps the snapshots of two accounts apart',
  tenantsApart: 'keeps the same account of two tenants apart',
  olderRefused: 'refuses an older snapshot and keeps the newer one',
  equalReplaces: 'replaces the snapshot when the instant is equal',
  newerReplaces: 'replaces the snapshot when the instant is newer',
  olderAddsNoChanges: 'adds no changes when it refuses an older snapshot',
  interleaved: 'keeps the newer snapshot when two writes interleave, in either order',
  overlapKeepsChanges:
    'keeps every pending change when overlapping writes carry different changes, in either order',
  accumulates: 'accumulates pending changes across writes, oldest first, without repeating a key',
  clearsNamed: 'clears the named pending changes and no others',
  clearUnknown: 'ignores clearing on a key that holds nothing',
  pendingPaged: 'lists the keys that still have pending changes in bounded pages, each key once',
  pendingUnlisted: 'stops listing a key once its pending changes are cleared',
  eventNew: 'reports an event identifier as new once and as seen afterwards',
  twoSources: 'treats the same identifier from two sources as two events',
  eventBoundary: 'keeps a source and identifier apart whatever characters they hold',
  eventConcurrent: 'answers exactly one concurrent mark of one identifier as new',
  eventForgotten: 'makes a forgotten event identifier new again',
  forgetOnlyNamed: 'forgets nothing but the named event identifier',
  retention: 'deletes the event identifiers recorded before an instant and keeps the others',
  staleOnly: 'lists only the keys fetched before the threshold',
  staleByFetch: 'judges a key stale by the fetch instant of its snapshot',
  stalePaged: 'lists stale keys in bounded pages by cursor, each key once',
  staleNone: 'lists nothing when no key is stale',
  staleCursorStable:
    'keeps listing every remaining stale key when the keys already listed stop being stale',
  pendingCursorStable:
    'keeps listing every remaining pending key when the keys already listed are cleared',
  emptyWriteKeeps: 'keeps the pending changes when an accepted write carries none',
  clearAndWrite: 'keeps both a clear and the change of a write that overlaps it',
  twoClears: 'keeps both of two clears that overlap',
  overlapOnStored: 'keeps every pending change when writes to a key that holds a snapshot overlap',
  caseKeys: 'keeps apart keys that differ by case or by a trailing space',
  longKeys: 'keeps apart long keys that differ only at their end',
  exactEventIds:
    'keeps apart event identifiers that differ by case, by a trailing space or at their end',
  milliseconds: 'orders writes and judges staleness by the millisecond',
  replaceExpected: 'replaceSnapshot writes only over the fetch instant it expects',
  replaceOlder: 'replaceSnapshot refuses an older instant',
  replaceOnce: 'replaceSnapshot lets exactly one of two overlapping writes of one state through',
  replaceMillisecond: 'replaceSnapshot tells apart two states fetched one millisecond apart'
}

// The cases each broken store fails, by the defect it has. A defect that touches the keys or the
// pages also fails the cases that read them back, so a list names every consequence.
const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  noEventUniqueness: [
    CASE.milliseconds,
    CASE.eventNew,
    CASE.eventConcurrent,
    CASE.forgetOnlyNamed,
    CASE.retention
  ],
  eventSourceIgnored: [CASE.twoSources, CASE.eventForgotten],
  eventKeyJoinedWithDelimiter: [CASE.eventBoundary],
  forgetEventDoesNothing: [CASE.eventForgotten],
  forgetEventForgetsEverything: [CASE.forgetOnlyNamed],
  retentionDeletesNothing: [CASE.milliseconds, CASE.retention],
  retentionDeletesTheBoundary: [CASE.milliseconds, CASE.retention],
  noOrdering: [CASE.olderRefused, CASE.olderAddsNoChanges, CASE.interleaved, CASE.milliseconds],
  refusesAnEqualInstant: [CASE.equalReplaces, CASE.overlapKeepsChanges, CASE.overlapOnStored],
  keepsTheStoredSnapshotOnAnEqualInstant: [CASE.equalReplaces],
  keepsTheStoredSnapshotOnANewerInstant: [
    CASE.newerReplaces,
    CASE.interleaved,
    CASE.accumulates,
    CASE.emptyWriteKeeps
  ],
  refusedWriteReportsTrue: [CASE.olderRefused, CASE.olderAddsNoChanges, CASE.milliseconds],
  staleUsesTheWriteInstant: [CASE.staleByFetch],
  pendingChangeAddedTwice: [CASE.accumulates],
  pendingNewestFirst: [CASE.accumulates],
  clearingDoesNothing: [CASE.clearsNamed, CASE.pendingUnlisted, CASE.clearAndWrite, CASE.twoClears],
  clearingAnUnknownChangeKeyFails: [CASE.clearsNamed, CASE.clearUnknown],
  clearingResetsTheSnapshot: [CASE.clearsNamed],
  clearingCreatesAnEntry: [CASE.clearUnknown],
  pendingListingNeverEnds: [CASE.pendingPaged, CASE.pendingCursorStable, CASE.pendingUnlisted],
  pendingListingRepeatsAKey: [CASE.pendingPaged, CASE.pendingCursorStable],
  staleListingRepeatsAKey: [CASE.stalePaged, CASE.staleCursorStable],
  pendingListingSkipsAKey: [CASE.pendingPaged, CASE.pendingCursorStable],
  staleListingSkipsAKey: [CASE.stalePaged, CASE.staleCursorStable],
  staleListingUsesAnOffsetCursor: [CASE.staleCursorStable],
  pendingListingUsesAnOffsetCursor: [CASE.pendingCursorStable],
  staleListingIgnoresTheThreshold: [
    CASE.milliseconds,
    CASE.staleOnly,
    CASE.staleByFetch,
    CASE.staleNone
  ],
  markAlwaysSeen: [
    CASE.exactEventIds,
    CASE.milliseconds,
    CASE.eventNew,
    CASE.twoSources,
    CASE.eventBoundary,
    CASE.eventConcurrent,
    CASE.eventForgotten,
    CASE.retention
  ],
  eventCheckedThenRecorded: [CASE.eventConcurrent],
  retentionDeletesEverything: [CASE.milliseconds, CASE.retention],
  inventsAnUnknownSnapshot: [CASE.unknownIsNull, CASE.clearUnknown],
  dropsPendingChangesOnRead: [
    CASE.readsBack,
    CASE.accountsApart,
    CASE.tenantsApart,
    CASE.equalReplaces,
    CASE.newerReplaces,
    CASE.olderAddsNoChanges,
    CASE.overlapKeepsChanges,
    CASE.accumulates,
    CASE.clearsNamed,
    CASE.emptyWriteKeeps,
    CASE.clearAndWrite,
    CASE.twoClears,
    CASE.overlapOnStored
  ],
  allKeysCollide: [
    CASE.accountsApart,
    CASE.tenantsApart,
    CASE.pendingPaged,
    CASE.pendingCursorStable,
    CASE.pendingUnlisted,
    CASE.caseKeys,
    CASE.longKeys,
    CASE.milliseconds,
    CASE.staleOnly,
    CASE.staleByFetch,
    CASE.stalePaged,
    CASE.staleCursorStable
  ],
  tenantsCollide: [
    CASE.tenantsApart,
    CASE.longKeys,
    CASE.milliseconds,
    CASE.staleOnly,
    CASE.staleByFetch
  ],
  pendingOverwrittenByLaterWrite: [
    CASE.equalReplaces,
    CASE.newerReplaces,
    CASE.olderAddsNoChanges,
    CASE.accumulates,
    CASE.emptyWriteKeeps,
    CASE.overlapOnStored
  ],
  pendingNotClearedByKey: [CASE.clearsNamed, CASE.clearAndWrite, CASE.twoClears],
  clearingAnUnknownKeyFails: [CASE.clearUnknown],
  lostUpdateWhenWritesOverlap: [CASE.overlapKeepsChanges, CASE.clearAndWrite, CASE.overlapOnStored],
  changesWrittenApartFromTheSnapshot: [CASE.olderAddsNoChanges],
  staleListingIgnoresLimit: [CASE.stalePaged],
  pendingListingIgnoresLimit: [CASE.pendingPaged],
  pendingListingIncludesEveryKey: [CASE.pendingPaged, CASE.pendingUnlisted],
  staleListingNeverEnds: [
    CASE.milliseconds,
    CASE.staleOnly,
    CASE.staleByFetch,
    CASE.stalePaged,
    CASE.staleCursorStable,
    CASE.staleNone
  ],
  emptyWriteErasesPending: [CASE.emptyWriteKeeps],
  clearReadThenWritten: [CASE.pendingUnlisted, CASE.twoClears],
  updateReadThenWritten: [CASE.olderAddsNoChanges, CASE.clearAndWrite],
  keysIgnoreCase: [CASE.caseKeys],
  longKeysCut: [CASE.longKeys],
  eventIdsFolded: [CASE.exactEventIds],
  wholeSecondOrdering: [CASE.milliseconds],
  replaceIgnoresTheExpectation: [CASE.replaceExpected, CASE.replaceOnce, CASE.replaceMillisecond],
  replaceIgnoresOrdering: [CASE.replaceOlder],
  replaceCheckedThenWritten: [CASE.replaceOnce],
  replaceExpectsByTheSecond: [CASE.replaceMillisecond],
  staleListingIncludesTheThreshold: [CASE.milliseconds, CASE.staleOnly]
}

describe('storeConformanceCases', () => {
  const cases = storeConformanceCases()

  it('gives every case a distinct, non-empty name that this suite knows', () => {
    // Scenario: a failure is reported by name, so the names identify the guarantee uniquely.
    const names = cases.map((conformance) => conformance.name)
    expect(names.every((name) => name.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(Object.values(CASE).sort())
  })

  it('passes every case with the in-memory store', async () => {
    // Scenario: the shipped store is the reference implementation of the port.
    const factory = (): InMemorySubscriptionStore =>
      new InMemorySubscriptionStore({ logger: () => undefined })
    expect(await failures(cases, factory)).toEqual([])
  })

  it('passes every case with a store that offers no conditional write', async () => {
    // Scenario: `replaceSnapshot` is optional, so its cases hold nothing against a store without it.
    const factory = (): InMemorySubscriptionStore =>
      Object.assign(new InMemorySubscriptionStore({ logger: () => undefined }), {
        replaceSnapshot: undefined
      })
    expect(await failures(cases, factory)).toEqual([])
  })

  it('has an expectation for every broken store and for no other', () => {
    // Scenario: a broken store added without its expected failures would go unproven.
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(BROKEN_STORES).sort())
  })

  it('fails every case with at least one broken store', () => {
    // Scenario: a case no defect can fail would pass whatever the store did.
    const failed = new Set(Object.values(EXPECTED).flat())
    expect(Object.values(CASE).filter((name) => !failed.has(name))).toEqual([])
  })

  it.each(Object.entries(VALID_VARIANTS))(
    'passes every case with the %s store, which the port allows',
    async (_variant, create) => {
      // Scenario: a store that differs from the in-memory one only where the port leaves room,
      // such as the order of the keys inside a page, passes every case.
      expect(await failures(cases, create)).toEqual([])
    }
  )

  it('keeps the short-page variant different from the in-memory store, so its pass proves something', async () => {
    // Scenario: five stale keys listed three at a time; the variant's first page holds two keys
    // and a cursor, where the reference store's holds three.
    const create = VALID_VARIANTS['pagesOneKeyShort']
    const variant = create?.() ?? new InMemorySubscriptionStore()
    const reference = new InMemorySubscriptionStore({ logger: () => undefined })
    for (const store of [variant, reference]) {
      for (const key of ['a', 'b', 'c', 'd', 'e']) {
        const fetchedAt = '2026-01-01T00:00:00.000Z'
        const snapshot = createEmptySnapshot({ accountId: key, source: 's', fetchedAt })
        await store.putSnapshot(key, snapshot, [], fetchedAt)
      }
    }
    const later = '2026-06-01T00:00:00.000Z'
    expect((await reference.listStaleKeys(later, 3, null)).keys).toEqual(['a', 'b', 'c'])
    const short = await variant.listStaleKeys(later, 3, null)
    expect(short.keys).toEqual(['a', 'b'])
    expect(short.nextCursor).not.toBeNull()
  })

  it('pages the offset-cursor store by position and ends its listing with no cursor', async () => {
    // Scenario: six stale keys, three a page; the cursor is an offset and the last page has none.
    const store =
      BROKEN_STORES['staleListingUsesAnOffsetCursor']?.() ?? new InMemorySubscriptionStore()
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const fetchedAt = '2026-01-01T00:00:00.000Z'
      const snapshot = createEmptySnapshot({ accountId: key, source: 's', fetchedAt })
      await store.putSnapshot(key, snapshot, [], fetchedAt)
    }
    const later = '2026-06-01T00:00:00.000Z'
    const first = await store.listStaleKeys(later, 3, null)
    expect(first).toEqual({ keys: ['a', 'b', 'c'], nextCursor: '3' })
    expect(await store.listStaleKeys(later, 3, '3')).toEqual({
      keys: ['d', 'e', 'f'],
      nextCursor: null
    })
  })

  it('pages the pending offset-cursor store by position and ends its listing with no cursor', async () => {
    // Scenario: six keys with pending changes, three a page; the cursor is an offset.
    const store =
      BROKEN_STORES['pendingListingUsesAnOffsetCursor']?.() ?? new InMemorySubscriptionStore()
    const change = { kind: 'renewed', key: 'c1' } as const
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const fetchedAt = '2026-01-01T00:00:00.000Z'
      const snapshot = createEmptySnapshot({ accountId: key, source: 's', fetchedAt })
      await store.putSnapshot(key, snapshot, [change], fetchedAt)
    }
    expect(await store.listKeysWithPendingChanges(3, null)).toEqual({
      keys: ['a', 'b', 'c'],
      nextCursor: '3'
    })
    expect(await store.listKeysWithPendingChanges(3, '3')).toEqual({
      keys: ['d', 'e', 'f'],
      nextCursor: null
    })
  })

  it('keeps the variant different from the in-memory store, so its pass proves something', async () => {
    // Scenario: the variant lists a page in the opposite order to the reference store.
    const create = VALID_VARIANTS['reversesTheKeysOfEachPage']
    const variant = create?.() ?? new InMemorySubscriptionStore()
    const reference = new InMemorySubscriptionStore({ logger: () => undefined })
    for (const store of [variant, reference]) {
      await store.putSnapshot(
        'a',
        createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: '2026-01-01T00:00:00.000Z' }),
        [],
        '2026-01-01T00:00:00.000Z'
      )
      await store.putSnapshot(
        'b',
        createEmptySnapshot({ accountId: 'b', source: 's', fetchedAt: '2026-01-01T00:00:00.000Z' }),
        [],
        '2026-01-01T00:00:00.000Z'
      )
    }
    const later = '2026-06-01T00:00:00.000Z'
    expect((await reference.listStaleKeys(later, 2, null)).keys).toEqual(['a', 'b'])
    expect((await variant.listStaleKeys(later, 2, null)).keys).toEqual(['b', 'a'])
    expect((await variant.listKeysWithPendingChanges(2, null)).keys).toEqual([])
  })

  it.each(['pendingListingRepeatsAKey', 'staleListingRepeatsAKey'])(
    'opens the second page of the %s store with the last key of the first',
    async (defect) => {
      // Scenario: five keys listed two at a time; the page after the first starts with the key
      // the first ended with and goes on from there.
      const store = BROKEN_STORES[defect]?.() ?? new InMemorySubscriptionStore()
      const fetchedAt = '2026-01-01T00:00:00.000Z'
      for (const key of ['a', 'b', 'c', 'd', 'e']) {
        const snapshot = createEmptySnapshot({ accountId: key, source: 's', fetchedAt })
        await store.putSnapshot(key, snapshot, [{ kind: 'started', key }], fetchedAt)
      }
      const list = (cursor: string | null): Promise<KeyPage> =>
        defect === 'pendingListingRepeatsAKey'
          ? store.listKeysWithPendingChanges(2, cursor)
          : store.listStaleKeys('2026-06-01T00:00:00.000Z', 2, cursor)
      const first = await list(null)
      expect(first.keys).toEqual(['a', 'b'])
      expect((await list(first.nextCursor))?.keys).toEqual(['b', 'c'])
    }
  )

  it.each(Object.entries(BROKEN_STORES))(
    'fails the named cases with the %s store',
    async (defect, create) => {
      // Scenario: the store has exactly one defect; the cases that state the broken guarantee
      // fail and every other case passes.
      expect(await failures(cases, create)).toEqual(EXPECTED[defect])
    }
  )
})

/** The case of that name, which the suite is known to hold. */
function caseNamed(name: string): StoreConformanceCase {
  const found = storeConformanceCases().find((one) => one.name === name)
  if (found === undefined) throw new Error(`no case named ${name}`)
  return found
}

describe('what the overlap and conditional-write cases put a store through', () => {
  it('overlaps a clear and a write with each of the two started first', async () => {
    // Scenario: a store may lose a change in one order only, so the case has to make both.
    const calls: string[] = []
    await caseNamed('keeps both a clear and the change of a write that overlaps it').run(() => {
      const store = new InMemorySubscriptionStore({ logger: () => undefined })
      const put = store.putSnapshot.bind(store)
      const clear = store.clearPendingChanges.bind(store)
      jest.spyOn(store, 'putSnapshot').mockImplementation((...args) => {
        calls.push('write')
        return put(...args)
      })
      jest.spyOn(store, 'clearPendingChanges').mockImplementation((...args) => {
        calls.push('clear')
        return clear(...args)
      })
      return store
    })
    // Each run seeds with one write, then makes the two overlapping calls.
    expect(calls).toStrictEqual(['write', 'clear', 'write', 'write', 'write', 'clear'])
  })

  it.each([
    ['replaceSnapshot writes only over the fetch instant it expects', ['c2', 'c2', 'c3']],
    ['replaceSnapshot refuses an older instant', ['c2']]
  ])('hands a change to every write refused by "%s"', async (name, expected) => {
    // Scenario: a store that keeps the changes of a write it refuses is caught only when the
    // refused write carries one.
    const refused: string[] = []
    await caseNamed(name).run(() => {
      const store = new InMemorySubscriptionStore({ logger: () => undefined })
      const replace = store.replaceSnapshot.bind(store)
      jest.spyOn(store, 'replaceSnapshot').mockImplementation(async (...args) => {
        const accepted = await replace(...args)
        if (!accepted) refused.push(args[3].map((change) => change.key).join())
        return accepted
      })
      return store
    })
    expect(refused).toStrictEqual(expected)
  })

  it('says that two writes replaced one state when a store lets both through', async () => {
    // Scenario: the host reads this sentence to know which guarantee its store lacks.
    const create = BROKEN_STORES['replaceIgnoresTheExpectation']
    if (create === undefined) throw new Error('the broken store is missing')
    const run = caseNamed(
      'replaceSnapshot lets exactly one of two overlapping writes of one state through'
    ).run(create)
    await expect(run).rejects.toThrow('two writes replaced one state')
  })
})
