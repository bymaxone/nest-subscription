/**
 * @fileoverview The conformance suite for the store port, as framework-neutral cases. A host runs
 * it against its own store from any test runner: each case fails by throwing an assertion error
 * from `node:assert/strict`. The cases reach the store through the port alone and read the time
 * from constants, never from a clock or a timer.
 * @layer testing
 */
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'

import { encodeAccountKey, type SubscriptionStore } from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  type SubscriptionChange,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

/** Gives each case a fresh, empty store. */
export type StoreFactory = () => SubscriptionStore | Promise<SubscriptionStore>

/** One conformance case: a stable name and a function that throws when the store is wrong. */
export interface StoreConformanceCase {
  /** A stable name, so a failure says which guarantee a store breaks. */
  readonly name: string
  /** Runs the case against a store from the factory; rejects when a guarantee does not hold. */
  readonly run: (createStore: StoreFactory) => Promise<void>
}

/** The instant `n` seconds after a fixed origin. */
function at(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()
}

/** A change with the given key. */
function change(key: string): SubscriptionChange {
  return { kind: 'started', key }
}

/** The key of an account, with or without a tenant. */
function keyOf(accountId: string, tenantId?: string): string {
  return encodeAccountKey({ accountId, tenantId })
}

/** A snapshot of an account, fetched at the given instant, as the given source reported it. */
function snapshotOf(
  accountId: string,
  fetchedAt: string,
  source: string = SNAPSHOT_SOURCE
): SubscriptionSnapshot {
  return createEmptySnapshot({ accountId, source, fetchedAt })
}

// The data of the cases is fixed when the module loads, so every case reads the same instants,
// keys and changes, and none of them depends on a clock.
const T1 = at(1)
const T2 = at(2)
const T3 = at(3)
const T5 = at(5)
const T6 = at(6)
const T8 = at(8)
const T9 = at(9)
const T10 = at(10)
const C1 = change('c1')
const C2 = change('c2')
const C3 = change('c3')
const ACC = 'acc'
const SNAPSHOT_SOURCE = 'conformance'
const REPLACEMENT_SOURCE = 'replacement'
const SOURCE_FIRST = 'first'
const SOURCE_SECOND = 'second'
const SOURCE_UNSEEN = 'never-seen'
const ACC_KEY = keyOf(ACC)
const NOBODY_KEY = keyOf('nobody')
const TENANT_A_KEY = keyOf(ACC, 'tenant-a')
const TENANT_B_KEY = keyOf(ACC, 'tenant-b')
const SOURCE = 'src'
const EVENT = 'evt'
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const LETTER_KEYS = LETTERS.map((letter) => keyOf(letter))
const CLEAR_KEYS = ['c1', 'c3', 'unknown']
const PAGE_BUDGET = Array.from({ length: 50 }, (_, page) => page)
const NEVER_ENDS = 'the listing did not end within its page budget'
const OVER_LIMIT = 'a page holds more keys than the limit'
const CHANGE_LOST = 'a pending change was lost when two writes overlapped'
const CLEAR_LOST = 'a clear that overlapped another operation was lost or lost a change'
const CASE_ACCOUNTS = ['Account', 'account', 'account ']
const LONG_ID = 'x'.repeat(200)
const LONG_ACCOUNTS = [`${LONG_ID}a`, `${LONG_ID}b`]
const EVENT_IDS = ['Event', 'event', 'event ', `${LONG_ID}a`, `${LONG_ID}b`]
/** Three instants inside one second, a millisecond apart. */
const MS1 = '2026-01-01T00:00:05.001Z'
const MS2 = '2026-01-01T00:00:05.002Z'
const MS3 = '2026-01-01T00:00:05.003Z'

/** What a store holds for a key: the snapshot and the changes not yet cleared. */
function held(
  snapshot: SubscriptionSnapshot,
  pendingChanges: readonly SubscriptionChange[]
): { snapshot: SubscriptionSnapshot; pendingChanges: readonly SubscriptionChange[] } {
  return { snapshot, pendingChanges }
}

/**
 * Writes an account's snapshot at an instant with changes; the write must be accepted. The
 * snapshot is fetched at the same instant unless another is given.
 */
async function seed(
  store: SubscriptionStore,
  accountId: string,
  instant: string,
  changes: readonly SubscriptionChange[],
  fetchedAt: string = instant
): Promise<void> {
  const written = await store.putSnapshot(
    keyOf(accountId),
    snapshotOf(accountId, fetchedAt),
    changes,
    instant
  )
  assert.equal(written, true)
}

/** The page of a listing from a cursor. */
type Lister = (
  cursor: string | null
) => Promise<{ readonly keys: readonly string[]; readonly nextCursor: string | null }>

/**
 * Reads every key a paged listing returns, checking each page against the limit. The keys come
 * back sorted, because a store may order the keys of a page as it likes.
 */
async function collect(list: Lister, limit: number): Promise<string[]> {
  const all: string[] = []
  let cursor: string | null = null
  for (const _page of PAGE_BUDGET) {
    const page = await list(cursor)
    assert.ok(page.keys.length <= limit, OVER_LIMIT)
    all.push(...page.keys)
    if (page.nextCursor === null) return all.sort()
    cursor = page.nextCursor
  }
  return assert.fail(NEVER_ENDS)
}

/** Starts one write per instant, in the order given, on a fresh store; the newest instant wins. */
async function interleave(createStore: StoreFactory, instants: readonly string[]): Promise<void> {
  const store = await createStore()
  await Promise.all(
    instants.map((instant) => store.putSnapshot(ACC_KEY, snapshotOf(ACC, instant), [], instant))
  )
  assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T8), []))
}

/**
 * Starts two writes of one key at once, in the order given, each at the same instant and with its
 * own change, so the port accepts both whichever the store applies first; every change is then
 * pending.
 */
async function overlapWithChanges(
  createStore: StoreFactory,
  first: SubscriptionChange,
  second: SubscriptionChange
): Promise<void> {
  const store = await createStore()
  const answers = await Promise.all(
    [first, second].map((added) => store.putSnapshot(ACC_KEY, snapshotOf(ACC, T5), [added], T5))
  )
  assert.deepEqual(answers, [true, true])
  // Which write the store applied first is its own choice, so both orders of the changes are valid.
  const stored = await store.getSnapshot(ACC_KEY)
  const valid = [
    held(snapshotOf(ACC, T5), [first, second]),
    held(snapshotOf(ACC, T5), [second, first])
  ]
  assert.ok(
    valid.some((expected) => isDeepStrictEqual(stored, expected)),
    CHANGE_LOST
  )
}

const snapshotCases: readonly StoreConformanceCase[] = [
  {
    name: 'returns null for a key never written',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      assert.equal(await store.getSnapshot(NOBODY_KEY), null)
    }
  },
  {
    name: 'reads back the snapshot and the pending changes it was given',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await store.putSnapshot(ACC_KEY, snapshotOf(ACC, T1), [C1], T1)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T1), [C1]))
    }
  },
  {
    name: 'keeps the snapshots of two accounts apart',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, 'one', T1, [C1])
      await seed(store, 'two', T2, [])
      assert.deepEqual(await store.getSnapshot(keyOf('one')), held(snapshotOf('one', T1), [C1]))
      assert.deepEqual(await store.getSnapshot(keyOf('two')), held(snapshotOf('two', T2), []))
    }
  },
  {
    name: 'keeps the same account of two tenants apart',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await store.putSnapshot(TENANT_A_KEY, snapshotOf(ACC, T1), [C1], T1)
      await store.putSnapshot(TENANT_B_KEY, snapshotOf(ACC, T2), [C2], T2)
      assert.deepEqual(await store.getSnapshot(TENANT_A_KEY), held(snapshotOf(ACC, T1), [C1]))
      assert.deepEqual(await store.getSnapshot(TENANT_B_KEY), held(snapshotOf(ACC, T2), [C2]))
    }
  }
]

const orderingCases: readonly StoreConformanceCase[] = [
  {
    name: 'refuses an older snapshot and keeps the newer one',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T5, [])
      assert.equal(await store.putSnapshot(ACC_KEY, snapshotOf(ACC, T9), [], T2), false)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T5), []))
    }
  },
  {
    name: 'replaces the snapshot when the instant is equal',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T5, [C1])
      const replacement = snapshotOf(ACC, T5, REPLACEMENT_SOURCE)
      assert.equal(await store.putSnapshot(ACC_KEY, replacement, [C2], T5), true)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(replacement, [C1, C2]))
    }
  },
  {
    name: 'replaces the snapshot when the instant is newer',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T5, [C1])
      const replacement = snapshotOf(ACC, T6, REPLACEMENT_SOURCE)
      assert.equal(await store.putSnapshot(ACC_KEY, replacement, [C2], T6), true)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(replacement, [C1, C2]))
    }
  },
  {
    name: 'adds no changes when it refuses an older snapshot',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T5, [C1])
      assert.equal(await store.putSnapshot(ACC_KEY, snapshotOf(ACC, T1), [C2], T1), false)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T5), [C1]))
    }
  },
  {
    name: 'keeps the newer snapshot when two writes interleave, in either order',
    run: async (createStore): Promise<void> => {
      await interleave(createStore, [T8, T3])
      await interleave(createStore, [T3, T8])
    }
  }
]

const pendingCases: readonly StoreConformanceCase[] = [
  {
    name: 'keeps every pending change when overlapping writes carry different changes, in either order',
    run: async (createStore): Promise<void> => {
      await overlapWithChanges(createStore, C1, C2)
      await overlapWithChanges(createStore, C2, C1)
    }
  },
  {
    name: 'accumulates pending changes across writes, oldest first, without repeating a key',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T1, [C1, C2])
      await seed(store, ACC, T2, [C2, C3])
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T2), [C1, C2, C3]))
    }
  },
  {
    name: 'clears the named pending changes and no others',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T1, [C1, C2, C3])
      await store.clearPendingChanges(ACC_KEY, CLEAR_KEYS)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T1), [C2]))
    }
  },
  {
    name: 'ignores clearing on a key that holds nothing',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await store.clearPendingChanges(NOBODY_KEY, CLEAR_KEYS)
      assert.equal(await store.getSnapshot(NOBODY_KEY), null)
    }
  },
  {
    name: 'lists the keys that still have pending changes in bounded pages, each key once',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      for (const letter of LETTERS) await seed(store, letter, T1, [C1])
      await seed(store, 'none', T1, [])
      const keys = await collect((cursor) => store.listKeysWithPendingChanges(2, cursor), 2)
      assert.deepEqual(keys, LETTER_KEYS)
    }
  },
  {
    name: 'keeps listing every remaining pending key when the keys already listed are cleared',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      for (const letter of LETTERS) await seed(store, letter, T1, [C1])
      const first = await store.listKeysWithPendingChanges(3, null)
      for (const key of first.keys) await store.clearPendingChanges(key, [C1.key])
      const rest: string[] = []
      let cursor = first.nextCursor
      for (const _page of PAGE_BUDGET) {
        if (cursor === null) break
        const page = await store.listKeysWithPendingChanges(3, cursor)
        rest.push(...page.keys)
        cursor = page.nextCursor
      }
      assert.equal(cursor, null, NEVER_ENDS)
      assert.deepEqual(
        rest.sort(),
        LETTER_KEYS.filter((key) => !first.keys.includes(key))
      )
    }
  },
  {
    name: 'stops listing a key once its pending changes are cleared',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, 'a', T1, [C1])
      await seed(store, 'b', T1, [C2])
      const before = await collect((cursor) => store.listKeysWithPendingChanges(5, cursor), 5)
      assert.deepEqual(before, [keyOf('a'), keyOf('b')])
      await store.clearPendingChanges(keyOf('a'), [C1.key])
      const after = await collect((cursor) => store.listKeysWithPendingChanges(5, cursor), 5)
      assert.deepEqual(after, [keyOf('b')])
    }
  }
]

/** The keys of the changes pending under a key, sorted. */
async function pendingKeys(store: SubscriptionStore, key: string): Promise<string[]> {
  const stored = await store.getSnapshot(key)
  assert.ok(stored !== null)
  return stored.pendingChanges.map((one) => one.key).sort()
}

const concurrencyCases: readonly StoreConformanceCase[] = [
  {
    name: 'keeps the pending changes when an accepted write carries none',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T1, [C1])
      await seed(store, ACC, T2, [])
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T2), [C1]))
    }
  },
  {
    name: 'keeps both a clear and the change of a write that overlaps it',
    run: async (createStore): Promise<void> => {
      for (const clearFirst of [true, false]) {
        const store = await createStore()
        await seed(store, ACC, T1, [C1])
        const clear = (): Promise<void> => store.clearPendingChanges(ACC_KEY, [C1.key])
        const write = (): Promise<boolean> =>
          store.putSnapshot(ACC_KEY, snapshotOf(ACC, T2), [C2], T2)
        await Promise.all(clearFirst ? [clear(), write()] : [write(), clear()])
        assert.deepEqual(await pendingKeys(store, ACC_KEY), [C2.key], CLEAR_LOST)
      }
    }
  },
  {
    name: 'keeps both of two clears that overlap',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T1, [C1, C2, C3])
      await Promise.all([C1, C2].map((one) => store.clearPendingChanges(ACC_KEY, [one.key])))
      assert.deepEqual(await pendingKeys(store, ACC_KEY), [C3.key], CLEAR_LOST)
    }
  },
  {
    name: 'keeps every pending change when writes to a key that holds a snapshot overlap',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, T1, [C1])
      await Promise.all(
        [C2, C3].map((one) => store.putSnapshot(ACC_KEY, snapshotOf(ACC, T2), [one], T2))
      )
      assert.deepEqual(await pendingKeys(store, ACC_KEY), [C1.key, C2.key, C3.key], CHANGE_LOST)
    }
  }
]

const exactnessCases: readonly StoreConformanceCase[] = [
  {
    name: 'keeps apart keys that differ by case or by a trailing space',
    run: async (createStore): Promise<void> => {
      await keptApart(await createStore(), CASE_ACCOUNTS)
    }
  },
  {
    name: 'keeps apart long keys that differ only at their end',
    run: async (createStore): Promise<void> => {
      await keptApart(await createStore(), LONG_ACCOUNTS)
    }
  },
  {
    name: 'keeps apart event identifiers that differ by case, by a trailing space or at their end',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      for (const id of EVENT_IDS) {
        assert.equal(await store.markEventProcessed(SOURCE, id, T1), true)
      }
    }
  },
  {
    name: 'orders writes and judges staleness by the millisecond',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, ACC, MS2, [])
      assert.equal(await store.putSnapshot(ACC_KEY, snapshotOf(ACC, MS3), [], MS1), false)
      assert.deepEqual(await store.listStaleKeys(MS2, 10, null), { keys: [], nextCursor: null })
      assert.deepEqual((await store.listStaleKeys(MS3, 10, null)).keys, [ACC_KEY])
      await store.markEventProcessed(SOURCE, 'before', MS1)
      await store.markEventProcessed(SOURCE, 'at', MS2)
      await store.deleteEventsOlderThan(MS2)
      assert.equal(await store.markEventProcessed(SOURCE, 'before', MS3), true)
      assert.equal(await store.markEventProcessed(SOURCE, 'at', MS3), false)
    }
  }
]

/** Writes one snapshot per account and reads each back as its own. */
async function keptApart(store: SubscriptionStore, accounts: readonly string[]): Promise<void> {
  for (const account of accounts) await seed(store, account, T1, [])
  for (const account of accounts) {
    assert.deepEqual(await store.getSnapshot(keyOf(account)), held(snapshotOf(account, T1), []))
  }
}

/** The conditional write of a store, or `null` for a store that offers none: its cases pass. */
function conditionalWrite(
  store: SubscriptionStore
): NonNullable<SubscriptionStore['replaceSnapshot']> | null {
  return store.replaceSnapshot?.bind(store) ?? null
}

const conditionalCases: readonly StoreConformanceCase[] = [
  {
    name: 'replaceSnapshot writes only over the fetch instant it expects',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      const replace = conditionalWrite(store)
      if (replace === null) return
      assert.equal(await replace(ACC_KEY, T1, snapshotOf(ACC, T2), [C2], T2), false)
      assert.equal(await store.getSnapshot(ACC_KEY), null)
      assert.equal(await replace(ACC_KEY, null, snapshotOf(ACC, T1), [C1], T1), true)
      assert.equal(await replace(ACC_KEY, null, snapshotOf(ACC, T2), [C2], T2), false)
      assert.equal(await replace(ACC_KEY, T2, snapshotOf(ACC, T3), [C3], T3), false)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T1), [C1]))
      assert.equal(await replace(ACC_KEY, T1, snapshotOf(ACC, T2), [C2], T2), true)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T2), [C1, C2]))
    }
  },
  {
    name: 'replaceSnapshot refuses an older instant',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      const replace = conditionalWrite(store)
      if (replace === null) return
      await seed(store, ACC, T5, [C1])
      assert.equal(await replace(ACC_KEY, T5, snapshotOf(ACC, T6), [C2], T2), false)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, T5), [C1]))
    }
  },
  {
    name: 'replaceSnapshot lets exactly one of two overlapping writes of one state through',
    run: async (createStore): Promise<void> => {
      for (const stored of [null, T1]) {
        const store = await createStore()
        const replace = conditionalWrite(store)
        if (replace === null) return
        if (stored !== null) await seed(store, ACC, stored, [])
        const answers = await Promise.all(
          [T2, T3].map((instant) => replace(ACC_KEY, stored, snapshotOf(ACC, instant), [], instant))
        )
        assert.equal(answers.filter(Boolean).length, 1, 'two writes replaced one state')
      }
    }
  },
  {
    name: 'replaceSnapshot tells apart two states fetched one millisecond apart',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      const replace = conditionalWrite(store)
      if (replace === null) return
      await seed(store, ACC, MS1, [])
      assert.equal(await replace(ACC_KEY, MS1, snapshotOf(ACC, MS2), [C1], MS2), true)
      assert.equal(await replace(ACC_KEY, MS1, snapshotOf(ACC, MS3), [C2], MS3), false)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, MS2), [C1]))
      assert.equal(await replace(ACC_KEY, MS2, snapshotOf(ACC, MS3), [C3], MS3), true)
      assert.deepEqual(await store.getSnapshot(ACC_KEY), held(snapshotOf(ACC, MS3), [C1, C3]))
    }
  }
]

const eventCases: readonly StoreConformanceCase[] = [
  {
    name: 'reports an event identifier as new once and as seen afterwards',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      assert.equal(await store.markEventProcessed(SOURCE, EVENT, T1), true)
      assert.equal(await store.markEventProcessed(SOURCE, EVENT, T2), false)
    }
  },
  {
    name: 'treats the same identifier from two sources as two events',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      assert.equal(await store.markEventProcessed(SOURCE_FIRST, EVENT, T1), true)
      assert.equal(await store.markEventProcessed(SOURCE_SECOND, EVENT, T1), true)
    }
  },
  {
    name: 'keeps a source and identifier apart whatever characters they hold',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      assert.equal(await store.markEventProcessed('a:b', 'c', T1), true)
      assert.equal(await store.markEventProcessed('a', 'b:c', T1), true)
    }
  },
  {
    name: 'answers exactly one concurrent mark of one identifier as new',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      const answers = await Promise.all(
        LETTERS.map(() => store.markEventProcessed(SOURCE, EVENT, T1))
      )
      assert.equal(answers.filter(Boolean).length, 1)
    }
  },
  {
    name: 'makes a forgotten event identifier new again',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await store.markEventProcessed(SOURCE, EVENT, T1)
      await store.forgetEvent(SOURCE, EVENT)
      assert.equal(await store.markEventProcessed(SOURCE, EVENT, T2), true)
    }
  },
  {
    name: 'forgets nothing but the named event identifier',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await store.markEventProcessed(SOURCE, 'kept', T1)
      await store.markEventProcessed(SOURCE, EVENT, T1)
      await store.forgetEvent(SOURCE, EVENT)
      await store.forgetEvent(SOURCE_UNSEEN, EVENT)
      assert.equal(await store.markEventProcessed(SOURCE, 'kept', T2), false)
    }
  },
  {
    name: 'deletes the event identifiers recorded before an instant and keeps the others',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await store.markEventProcessed(SOURCE, 'old', T1)
      await store.markEventProcessed(SOURCE, 'edge', T5)
      await store.markEventProcessed(SOURCE, 'new', T9)
      await store.deleteEventsOlderThan(T5)
      assert.equal(await store.markEventProcessed(SOURCE, 'old', T10), true)
      assert.equal(await store.markEventProcessed(SOURCE, 'edge', T10), false)
      assert.equal(await store.markEventProcessed(SOURCE, 'new', T10), false)
    }
  }
]

const staleCases: readonly StoreConformanceCase[] = [
  {
    name: 'lists only the keys fetched before the threshold',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, 'old', T1, [])
      await seed(store, 'edge', T5, [])
      await seed(store, 'fresh', T9, [])
      const keys = await collect((cursor) => store.listStaleKeys(T5, 10, cursor), 10)
      assert.deepEqual(keys, [keyOf('old')])
    }
  },
  {
    name: 'judges a key stale by the fetch instant of its snapshot',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, 'early', T9, [], T1)
      await seed(store, 'late', T1, [], T9)
      const keys = await collect((cursor) => store.listStaleKeys(T5, 10, cursor), 10)
      assert.deepEqual(keys, [keyOf('early')])
    }
  },
  {
    name: 'lists stale keys in bounded pages by cursor, each key once',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      for (const letter of LETTERS) await seed(store, letter, T1, [])
      const first = await store.listStaleKeys(T5, 3, null)
      assert.notEqual(first.nextCursor, null)
      const keys = await collect((cursor) => store.listStaleKeys(T5, 3, cursor), 3)
      assert.deepEqual(keys, LETTER_KEYS)
    }
  },
  {
    name: 'keeps listing every remaining stale key when the keys already listed stop being stale',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      for (const letter of LETTERS) await seed(store, letter, T1, [])
      const first = await store.listStaleKeys(T5, 3, null)
      for (const key of first.keys) {
        const letter = LETTERS.find((candidate) => keyOf(candidate) === key)
        assert.ok(letter !== undefined)
        await seed(store, letter, T9, [])
      }
      const rest: string[] = []
      let cursor = first.nextCursor
      for (const _page of PAGE_BUDGET) {
        if (cursor === null) break
        const page = await store.listStaleKeys(T5, 3, cursor)
        rest.push(...page.keys)
        cursor = page.nextCursor
      }
      assert.equal(cursor, null, NEVER_ENDS)
      assert.deepEqual(
        rest.sort(),
        LETTER_KEYS.filter((key) => !first.keys.includes(key))
      )
    }
  },
  {
    name: 'lists nothing when no key is stale',
    run: async (createStore): Promise<void> => {
      const store = await createStore()
      await seed(store, 'fresh', T9, [])
      assert.deepEqual(await store.listStaleKeys(T5, 10, null), { keys: [], nextCursor: null })
    }
  }
]

/**
 * Returns the conformance cases for a store implementation. Each case takes a factory that gives
 * it a fresh, empty store, so no case depends on another. Run them from any test runner and
 * treat a rejection as a failure of the guarantee the case's name states.
 */
export function storeConformanceCases(): readonly StoreConformanceCase[] {
  return [
    ...snapshotCases,
    ...orderingCases,
    ...pendingCases,
    ...concurrencyCases,
    ...exactnessCases,
    ...conditionalCases,
    ...eventCases,
    ...staleCases
  ]
}
