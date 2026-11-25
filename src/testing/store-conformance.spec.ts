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
  staleNone: 'lists nothing when no key is stale'
}

// The cases each broken store fails, by the defect it has. A defect that touches the keys or the
// pages also fails the cases that read them back, so a list names every consequence.
const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  noEventUniqueness: [CASE.eventNew, CASE.eventConcurrent, CASE.forgetOnlyNamed, CASE.retention],
  eventSourceIgnored: [CASE.twoSources, CASE.eventForgotten],
  eventKeyJoinedWithDelimiter: [CASE.eventBoundary],
  forgetEventDoesNothing: [CASE.eventForgotten],
  forgetEventForgetsEverything: [CASE.forgetOnlyNamed],
  retentionDeletesNothing: [CASE.retention],
  retentionDeletesTheBoundary: [CASE.retention],
  noOrdering: [CASE.olderRefused, CASE.olderAddsNoChanges, CASE.interleaved],
  refusesAnEqualInstant: [CASE.equalReplaces, CASE.overlapKeepsChanges],
  keepsTheStoredSnapshotOnAnEqualInstant: [CASE.equalReplaces],
  keepsTheStoredSnapshotOnANewerInstant: [CASE.newerReplaces, CASE.interleaved, CASE.accumulates],
  refusedWriteReportsTrue: [CASE.olderRefused, CASE.olderAddsNoChanges],
  staleUsesTheWriteInstant: [CASE.staleByFetch],
  pendingChangeAddedTwice: [CASE.accumulates],
  pendingNewestFirst: [CASE.accumulates],
  clearingDoesNothing: [CASE.clearsNamed, CASE.pendingUnlisted],
  clearingAnUnknownChangeKeyFails: [CASE.clearsNamed, CASE.clearUnknown],
  clearingResetsTheSnapshot: [CASE.clearsNamed],
  clearingCreatesAnEntry: [CASE.clearUnknown],
  pendingListingNeverEnds: [CASE.pendingPaged, CASE.pendingUnlisted],
  pendingListingRepeatsAKey: [CASE.pendingPaged],
  staleListingRepeatsAKey: [CASE.stalePaged],
  pendingListingSkipsAKey: [CASE.pendingPaged],
  staleListingSkipsAKey: [CASE.stalePaged],
  staleListingIgnoresTheThreshold: [CASE.staleOnly, CASE.staleByFetch, CASE.staleNone],
  markAlwaysSeen: [
    CASE.eventNew,
    CASE.twoSources,
    CASE.eventBoundary,
    CASE.eventConcurrent,
    CASE.eventForgotten,
    CASE.retention
  ],
  eventCheckedThenRecorded: [CASE.eventConcurrent],
  retentionDeletesEverything: [CASE.retention],
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
    CASE.clearsNamed
  ],
  allKeysCollide: [
    CASE.accountsApart,
    CASE.tenantsApart,
    CASE.pendingPaged,
    CASE.pendingUnlisted,
    CASE.staleOnly,
    CASE.staleByFetch,
    CASE.stalePaged
  ],
  tenantsCollide: [CASE.tenantsApart, CASE.staleOnly, CASE.staleByFetch],
  pendingOverwrittenByLaterWrite: [
    CASE.equalReplaces,
    CASE.newerReplaces,
    CASE.olderAddsNoChanges,
    CASE.accumulates
  ],
  pendingNotClearedByKey: [CASE.clearsNamed],
  clearingAnUnknownKeyFails: [CASE.clearUnknown],
  lostUpdateWhenWritesOverlap: [CASE.overlapKeepsChanges],
  changesWrittenApartFromTheSnapshot: [CASE.olderAddsNoChanges],
  staleListingIgnoresLimit: [CASE.stalePaged],
  pendingListingIgnoresLimit: [CASE.pendingPaged],
  pendingListingIncludesEveryKey: [CASE.pendingPaged, CASE.pendingUnlisted],
  staleListingNeverEnds: [CASE.staleOnly, CASE.staleByFetch, CASE.stalePaged, CASE.staleNone],
  staleListingIncludesTheThreshold: [CASE.staleOnly]
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
