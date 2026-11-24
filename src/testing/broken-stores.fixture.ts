/**
 * @fileoverview Deliberately broken stores, each with one defect, used to prove the conformance
 * suite fails on the guarantee the defect breaks. Test-only: it is not exported from the subpath.
 * @layer testing
 */
import type {
  KeyPage,
  StoredSnapshot,
  SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  parseInstant,
  type SubscriptionChange
} from '@bymax-one/nest-subscription/shared'

import { InMemorySubscriptionStore } from './in-memory.store'

/** An instant later than any a test uses, so a write carrying it is never refused as older. */
const FAR_FUTURE = '9999-12-31T00:00:00.000Z'

/** The one key every account shares in the store whose keys collapse. */
const SHARED_KEY = 'shared'

/** The width of the key column in the store that truncates keys. */
const KEY_COLUMN_WIDTH = 5

/** A cursor the store that never ends its listing always returns. */
const NEVER_ENDING_CURSOR = 'more'

/** The page size the stores that ignore their limit return instead. */
const UNBOUNDED = 1000

/** The snapshot the store that invents one answers with for a key nobody wrote. */
const INVENTED = createEmptySnapshot({ accountId: 'x', source: 's', fetchedAt: FAR_FUTURE })

/** The failure of the store that cannot clear changes of a key it holds nothing for. */
const UNKNOWN_KEY = 'unknown key'

/** The options of a store built for a test: it stays quiet. */
const QUIET = { logger: (): void => undefined }

/** A fresh in-memory store that stays quiet. */
function good(): InMemorySubscriptionStore {
  return new InMemorySubscriptionStore(QUIET)
}

/** The instant one millisecond after an ISO 8601 instant. */
function justAfter(instant: string): string {
  return new Date(parseInstant(instant) + 1).toISOString()
}

/** The store with some of its methods replaced; the others reach it unchanged. */
function withDefect(
  base: SubscriptionStore,
  defect: Partial<SubscriptionStore>
): SubscriptionStore {
  return {
    getSnapshot: (key) => base.getSnapshot(key),
    putSnapshot: (key, snapshot, changes, at) => base.putSnapshot(key, snapshot, changes, at),
    clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
    listKeysWithPendingChanges: (limit, cursor) => base.listKeysWithPendingChanges(limit, cursor),
    markEventProcessed: (source, id, at) => base.markEventProcessed(source, id, at),
    forgetEvent: (source, id) => base.forgetEvent(source, id),
    deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
    listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor),
    ...defect
  }
}

/** The change keys a stored key holds. */
async function heldChangeKeys(base: SubscriptionStore, key: string): Promise<string[]> {
  return ((await base.getSnapshot(key))?.pendingChanges ?? []).map((held) => held.key)
}

/**
 * A store that checks whether an identifier is known, waits, and only then records it, so two
 * marks that overlap both find it unknown and both answer `true`.
 */
function eventCheckedThenRecorded(): SubscriptionStore {
  const events = new Map<string, number>()
  const keyOfEvent = (source: string, id: string): string => JSON.stringify([source, id])
  return withDefect(good(), {
    markEventProcessed: async (source, id, at) => {
      const known = events.has(keyOfEvent(source, id))
      await Promise.resolve()
      events.set(keyOfEvent(source, id), parseInstant(at))
      return !known
    },
    forgetEvent: async (source, id) => {
      events.delete(keyOfEvent(source, id))
    },
    deleteEventsOlderThan: async (instant) => {
      for (const [event, received] of events) {
        if (received < parseInstant(instant)) events.delete(event)
      }
    }
  })
}

/** The stores whose events or retention are mishandled. */
const eventDefects: Readonly<Record<string, () => SubscriptionStore>> = {
  noEventUniqueness: () => withDefect(good(), { markEventProcessed: () => Promise.resolve(true) }),
  eventSourceIgnored: () => {
    const base = good()
    return withDefect(base, {
      markEventProcessed: (_source, id, at) => base.markEventProcessed(SHARED_KEY, id, at)
    })
  },
  eventKeyJoinedWithDelimiter: () => {
    const base = good()
    return withDefect(base, {
      markEventProcessed: (source, id, at) =>
        base.markEventProcessed(SHARED_KEY, `${source}:${id}`, at),
      forgetEvent: (source, id) => base.forgetEvent(SHARED_KEY, `${source}:${id}`)
    })
  },
  markAlwaysSeen: () => withDefect(good(), { markEventProcessed: () => Promise.resolve(false) }),
  eventCheckedThenRecorded,
  forgetEventDoesNothing: () => withDefect(good(), { forgetEvent: () => Promise.resolve() }),
  forgetEventForgetsEverything: () => {
    const base = good()
    return withDefect(base, { forgetEvent: () => base.deleteEventsOlderThan(FAR_FUTURE) })
  },
  retentionDeletesNothing: () =>
    withDefect(good(), { deleteEventsOlderThan: () => Promise.resolve() }),
  retentionDeletesEverything: () => {
    const base = good()
    return withDefect(base, {
      deleteEventsOlderThan: () => base.deleteEventsOlderThan(FAR_FUTURE)
    })
  },
  retentionDeletesTheBoundary: () => {
    const base = good()
    return withDefect(base, {
      deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(justAfter(instant))
    })
  }
}

/**
 * A store that keeps the snapshot it holds, and still appends the changes and answers `true`, when
 * the instant of a write stands in the given relation to the instant of the previous write to the key.
 */
function keepingTheStoredSnapshot(
  keeps: (last: number | undefined, instant: number) => boolean
): SubscriptionStore {
  const base = good()
  const last = new Map<string, number>()
  return withDefect(base, {
    putSnapshot: async (key, snapshot, changes, at) => {
      const instant = parseInstant(at)
      const keep = keeps(last.get(key), instant)
      last.set(key, instant)
      const held = keep ? await base.getSnapshot(key) : null
      return base.putSnapshot(key, held?.snapshot ?? snapshot, changes, at)
    }
  })
}

/** The stores whose snapshots, keys or ordering are mishandled. */
const snapshotDefects: Readonly<Record<string, () => SubscriptionStore>> = {
  noOrdering: () => {
    const base = good()
    return withDefect(base, {
      putSnapshot: (key, snapshot, changes) => base.putSnapshot(key, snapshot, changes, FAR_FUTURE)
    })
  },
  refusesAnEqualInstant: () => {
    const base = good()
    const last = new Map<string, number>()
    return withDefect(base, {
      putSnapshot: async (key, snapshot, changes, at) => {
        const instant = parseInstant(at)
        if (instant <= (last.get(key) ?? Number.NEGATIVE_INFINITY)) return false
        last.set(key, instant)
        return base.putSnapshot(key, snapshot, changes, at)
      }
    })
  },
  keepsTheStoredSnapshotOnAnEqualInstant: () =>
    keepingTheStoredSnapshot((last, instant) => last === instant),
  keepsTheStoredSnapshotOnANewerInstant: () =>
    keepingTheStoredSnapshot((last, instant) => last !== undefined && instant > last),
  refusedWriteReportsTrue: () => {
    const base = good()
    return withDefect(base, {
      putSnapshot: async (key, snapshot, changes, at) => {
        await base.putSnapshot(key, snapshot, changes, at)
        return true
      }
    })
  },
  staleUsesTheWriteInstant: () => {
    const base = good()
    return withDefect(base, {
      putSnapshot: (key, snapshot, changes, at) =>
        base.putSnapshot(key, { ...snapshot, fetchedAt: at }, changes, at)
    })
  },
  inventsAnUnknownSnapshot: () => {
    const base = good()
    return withDefect(base, {
      getSnapshot: async (key) =>
        (await base.getSnapshot(key)) ?? { snapshot: INVENTED, pendingChanges: [] }
    })
  },
  dropsPendingChangesOnRead: () => {
    const base = good()
    return withDefect(base, {
      getSnapshot: async (key) => {
        const held = await base.getSnapshot(key)
        return held === null ? null : { snapshot: held.snapshot, pendingChanges: [] }
      }
    })
  },
  allKeysCollide: () => {
    const base = good()
    return withDefect(base, {
      getSnapshot: () => base.getSnapshot(SHARED_KEY),
      putSnapshot: (_key, snapshot, changes, at) =>
        base.putSnapshot(SHARED_KEY, snapshot, changes, at),
      clearPendingChanges: (_key, keys) => base.clearPendingChanges(SHARED_KEY, keys)
    })
  },
  tenantsCollide: () => {
    const base = good()
    const truncated = (key: string): string => key.slice(0, KEY_COLUMN_WIDTH)
    return withDefect(base, {
      getSnapshot: (key) => base.getSnapshot(truncated(key)),
      putSnapshot: (key, snapshot, changes, at) =>
        base.putSnapshot(truncated(key), snapshot, changes, at),
      clearPendingChanges: (key, keys) => base.clearPendingChanges(truncated(key), keys)
    })
  }
}

/** The stores whose pending changes are mishandled. */
const pendingDefects: Readonly<Record<string, () => SubscriptionStore>> = {
  pendingOverwrittenByLaterWrite: () => {
    const base = good()
    return withDefect(base, {
      putSnapshot: async (key, snapshot, changes, at) => {
        await base.clearPendingChanges(key, await heldChangeKeys(base, key))
        return base.putSnapshot(key, snapshot, changes, at)
      }
    })
  },
  pendingNotClearedByKey: () => {
    const base = good()
    return withDefect(base, {
      clearPendingChanges: async (key) =>
        base.clearPendingChanges(key, await heldChangeKeys(base, key))
    })
  },
  clearingAnUnknownKeyFails: () => {
    const base = good()
    return withDefect(base, {
      clearPendingChanges: async (key, keys) => {
        if ((await base.getSnapshot(key)) === null) throw new Error(UNKNOWN_KEY)
        return base.clearPendingChanges(key, keys)
      }
    })
  },
  lostUpdateWhenWritesOverlap: () => pendingKeptApart({ racy: true, dedupe: true }),
  pendingChangeAddedTwice: () => pendingKeptApart({ racy: false, dedupe: false }),
  pendingNewestFirst: () => {
    const base = good()
    return withDefect(base, {
      putSnapshot: (key, snapshot, changes, at) =>
        base.putSnapshot(key, snapshot, [...changes].reverse(), at)
    })
  },
  clearingDoesNothing: () => withDefect(good(), { clearPendingChanges: () => Promise.resolve() }),
  clearingAnUnknownChangeKeyFails: () => {
    const base = good()
    return withDefect(base, {
      clearPendingChanges: async (key, keys) => {
        const held = await heldChangeKeys(base, key)
        if (keys.some((changeKey) => !held.includes(changeKey))) throw new Error(UNKNOWN_KEY)
        return base.clearPendingChanges(key, keys)
      }
    })
  },
  clearingResetsTheSnapshot: () => {
    const base = good()
    return withDefect(base, {
      clearPendingChanges: async (key, keys) => {
        await base.clearPendingChanges(key, keys)
        if ((await base.getSnapshot(key)) !== null) {
          await base.putSnapshot(key, INVENTED, [], FAR_FUTURE)
        }
      }
    })
  },
  clearingCreatesAnEntry: () => {
    const base = good()
    return withDefect(base, {
      clearPendingChanges: async (key, keys) => {
        if ((await base.getSnapshot(key)) === null) {
          await base.putSnapshot(key, INVENTED, [], FAR_FUTURE)
        }
        return base.clearPendingChanges(key, keys)
      }
    })
  },
  changesWrittenApartFromTheSnapshot: () => {
    const base = good()
    return withDefect(base, {
      putSnapshot: async (key, snapshot, changes, at) => {
        const written = await base.putSnapshot(key, snapshot, [], at)
        // The snapshot is stored by now, accepted or not, so the read is never empty.
        const held = (await base.getSnapshot(key)) as StoredSnapshot
        await base.putSnapshot(key, held.snapshot, changes, held.snapshot.fetchedAt)
        return written
      }
    })
  }
}

/**
 * A store that keeps the pending changes itself and writes them back as read-then-write. With
 * `racy`, it reads the list before it waits for the snapshot write, so two overlapping writes both
 * read the same list and the later one overwrites the earlier one's changes. Without `dedupe`, it
 * adds a change whose key is already pending.
 */
function pendingKeptApart(options: {
  readonly racy: boolean
  readonly dedupe: boolean
}): SubscriptionStore {
  const base = good()
  const pending = new Map<string, readonly SubscriptionChange[]>()
  const pendingOf = (key: string): readonly SubscriptionChange[] => pending.get(key) ?? []
  const added = (
    read: readonly SubscriptionChange[],
    changes: readonly SubscriptionChange[]
  ): readonly SubscriptionChange[] =>
    options.dedupe ? changes.filter((c) => !read.some((r) => r.key === c.key)) : changes
  return withDefect(base, {
    getSnapshot: async (key) => {
      const held = await base.getSnapshot(key)
      return held === null ? null : { snapshot: held.snapshot, pendingChanges: pendingOf(key) }
    },
    putSnapshot: async (key, snapshot, changes, at) => {
      const early = pendingOf(key)
      const written = await base.putSnapshot(key, snapshot, [], at)
      const read = options.racy ? early : pendingOf(key)
      if (written) pending.set(key, [...read, ...added(read, changes)])
      return written
    },
    clearPendingChanges: async (key, keys) => {
      pending.set(
        key,
        pendingOf(key).filter((change) => !keys.includes(change.key))
      )
    },
    listKeysWithPendingChanges: async (limit, cursor) => {
      // A store that lists what it holds: the listing is the in-memory store's over the same keys.
      const listing = good()
      for (const [key, held] of pending) {
        await listing.putSnapshot(key, INVENTED, held, FAR_FUTURE)
      }
      return listing.listKeysWithPendingChanges(limit, cursor)
    }
  })
}

/** A paged listing with the limit and the cursor already bound. */
type Listing = (limit: number, cursor: string | null) => Promise<KeyPage>

/**
 * A listing that opens each page after the first with the key the cursor names, which the previous
 * page already returned. The cursor of the in-memory store is the last key of the page before it.
 */
function repeatingTheCursorKey(list: Listing): Listing {
  return async (limit, cursor) => {
    if (cursor === null) return list(limit, cursor)
    const page = await list(limit - 1, cursor)
    return { keys: [cursor, ...page.keys], nextCursor: page.nextCursor }
  }
}

/** A listing that leaves out the first key of every page after the first. */
function skippingAKeyPerPage(list: Listing): Listing {
  return async (limit, cursor) => {
    const page = await list(limit, cursor)
    return cursor === null ? page : { keys: page.keys.slice(1), nextCursor: page.nextCursor }
  }
}

/** The stores whose paged listings are mishandled. */
const listingDefects: Readonly<Record<string, () => SubscriptionStore>> = {
  staleListingIgnoresLimit: () => {
    const base = good()
    return withDefect(base, {
      listStaleKeys: (olderThan, _limit, cursor) => base.listStaleKeys(olderThan, UNBOUNDED, cursor)
    })
  },
  pendingListingIgnoresLimit: () => {
    const base = good()
    return withDefect(base, {
      listKeysWithPendingChanges: (_limit, cursor) =>
        base.listKeysWithPendingChanges(UNBOUNDED, cursor)
    })
  },
  pendingListingIncludesEveryKey: () => {
    const base = good()
    return withDefect(base, {
      listKeysWithPendingChanges: (limit, cursor) => base.listStaleKeys(FAR_FUTURE, limit, cursor)
    })
  },
  pendingListingNeverEnds: () => {
    const base = good()
    return withDefect(base, {
      listKeysWithPendingChanges: async (limit, cursor): Promise<KeyPage> => ({
        keys: (await base.listKeysWithPendingChanges(limit, cursor)).keys,
        nextCursor: NEVER_ENDING_CURSOR
      })
    })
  },
  pendingListingRepeatsAKey: () => {
    const base = good()
    return withDefect(base, {
      listKeysWithPendingChanges: repeatingTheCursorKey((limit, cursor) =>
        base.listKeysWithPendingChanges(limit, cursor)
      )
    })
  },
  staleListingRepeatsAKey: () => {
    const base = good()
    return withDefect(base, {
      listStaleKeys: (olderThan, limit, cursor) =>
        repeatingTheCursorKey((l, c) => base.listStaleKeys(olderThan, l, c))(limit, cursor)
    })
  },
  pendingListingSkipsAKey: () => {
    const base = good()
    return withDefect(base, {
      listKeysWithPendingChanges: skippingAKeyPerPage((limit, cursor) =>
        base.listKeysWithPendingChanges(limit, cursor)
      )
    })
  },
  staleListingSkipsAKey: () => {
    const base = good()
    return withDefect(base, {
      listStaleKeys: (olderThan, limit, cursor) =>
        skippingAKeyPerPage((l, c) => base.listStaleKeys(olderThan, l, c))(limit, cursor)
    })
  },
  staleListingIgnoresTheThreshold: () => {
    const base = good()
    return withDefect(base, {
      listStaleKeys: (_olderThan, limit, cursor) => base.listStaleKeys(FAR_FUTURE, limit, cursor)
    })
  },
  staleListingNeverEnds: () => {
    const base = good()
    return withDefect(base, {
      listStaleKeys: async (olderThan, limit, cursor): Promise<KeyPage> => ({
        keys: (await base.listStaleKeys(olderThan, limit, cursor)).keys,
        nextCursor: NEVER_ENDING_CURSOR
      })
    })
  },
  staleListingIncludesTheThreshold: () => {
    const base = good()
    return withDefect(base, {
      listStaleKeys: (olderThan, limit, cursor) =>
        base.listStaleKeys(justAfter(olderThan), limit, cursor)
    })
  }
}

/**
 * Stores that differ from the in-memory store in ways the port allows, so the conformance suite
 * must pass them: the keys of a page come back in any order.
 */
export const VALID_VARIANTS: Readonly<Record<string, () => SubscriptionStore>> = {
  reversesTheKeysOfEachPage: () => {
    const base = good()
    const reversed = (page: KeyPage): KeyPage => ({
      keys: [...page.keys].reverse(),
      nextCursor: page.nextCursor
    })
    return withDefect(base, {
      listStaleKeys: async (olderThan, limit, cursor) =>
        reversed(await base.listStaleKeys(olderThan, limit, cursor)),
      listKeysWithPendingChanges: async (limit, cursor) =>
        reversed(await base.listKeysWithPendingChanges(limit, cursor))
    })
  }
}

/** Every broken store, by the defect it has. */
export const BROKEN_STORES: Readonly<Record<string, () => SubscriptionStore>> = {
  ...eventDefects,
  ...snapshotDefects,
  ...pendingDefects,
  ...listingDefects
}
