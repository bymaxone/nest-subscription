/**
 * @fileoverview The store port: what a host persists for the library. Types only, so a host
 * implements it over any storage with nothing imported beyond these declarations. The conformance
 * suite of the `testing` subpath tests every guarantee stated here, through this port alone.
 * @layer internal
 */
import type { SubscriptionChange, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

/** A stored snapshot with the changes the host has not been told about yet. */
export interface StoredSnapshot {
  /** The normalized state of the account. */
  readonly snapshot: SubscriptionSnapshot
  /** The changes stored with the snapshot and not yet cleared, oldest first. */
  readonly pendingChanges: readonly SubscriptionChange[]
}

/** One page of keys. Pass `nextCursor` back to read the next page; `null` ends the listing. */
export interface KeyPage {
  /** At most the requested number of keys, each once. */
  readonly keys: readonly string[]
  /** An opaque cursor for the next page, or `null` when there is none. */
  readonly nextCursor: string | null
}

/**
 * Persistence for snapshots, their undelivered changes and processed event identifiers. A key is
 * the output of `encodeAccountKey`; the store treats it as an opaque string. Instants are ISO 8601
 * strings in UTC.
 *
 * Every method may be called concurrently, including for one key.
 */
export interface SubscriptionStore {
  /**
   * Reads the snapshot stored under a key with its pending changes, or `null` when none is
   * stored. What was written is what is read back. The library treats a snapshot read back that
   * does not name the account of the key, or holds an instant that is not ISO 8601, as absent.
   */
  getSnapshot(key: string): Promise<StoredSnapshot | null>

  /**
   * Writes a snapshot and its new changes in one atomic step, and returns whether it was written.
   *
   * - `sourceUpdatedAt` is the instant the source says the state is as of; when the source reports
   *   none, the caller passes the fetch instant, which is when its read started. A write whose instant is older than the stored
   *   one is refused whole: it returns `false` and neither the snapshot nor the changes change. An
   *   equal or newer instant replaces the snapshot.
   * - `pendingChanges` are appended to the changes already pending in the same step, never
   *   written separately, so a crash cannot keep the snapshot and lose its changes. A change whose
   *   key is already pending is not added twice.
   * - Writes to one key are ordered: of two concurrent writes the older instant never wins.
   */
  putSnapshot(
    key: string,
    snapshot: SubscriptionSnapshot,
    pendingChanges: readonly SubscriptionChange[],
    sourceUpdatedAt: string
  ): Promise<boolean>

  /**
   * Optional. Writes as {@link SubscriptionStore.putSnapshot} does, in one atomic step, only while
   * the key still holds the state the caller read: `expectedFetchedAt` is the `fetchedAt` of the
   * stored snapshot, or `null` when nothing was stored. It returns `false`, changing nothing, when
   * the stored snapshot is another one or `sourceUpdatedAt` is older than the stored instant.
   *
   * The library compares a read with the stored state to work out the changes. With this method
   * the changes stored are those of the state the write replaced, across processes, unless the
   * stored state keeps moving under one refresh, which then writes with `putSnapshot`. A store
   * without it is written with `putSnapshot`, and a write by another process between the read and
   * the write can then leave changes worked out against a state that was already replaced.
   */
  replaceSnapshot?(
    key: string,
    expectedFetchedAt: string | null,
    snapshot: SubscriptionSnapshot,
    pendingChanges: readonly SubscriptionChange[],
    sourceUpdatedAt: string
  ): Promise<boolean>

  /**
   * Removes the pending changes with the given change keys and no others. Unknown keys are
   * ignored. The snapshot is untouched.
   */
  clearPendingChanges(key: string, changeKeys: readonly string[]): Promise<void>

  /**
   * Lists the keys that still have pending changes, at most `limit` per page and each key once
   * across the pages of one listing. `cursor` is `null` for the first page.
   *
   * A cursor stays valid while the listing changes under it: when keys listed before it stop
   * qualifying (their pending changes were cleared) no key that still qualifies is skipped, and no
   * key is listed twice. A caller may therefore clear the changes of the keys of a page before it
   * asks for the next one.
   */
  listKeysWithPendingChanges(limit: number, cursor: string | null): Promise<KeyPage>

  /**
   * Records an event identifier and returns whether it was new. Of any number of concurrent calls
   * for one `(source, eventId)`, exactly one returns `true`, until the identifier is forgotten.
   */
  markEventProcessed(source: string, eventId: string, receivedAt: string): Promise<boolean>

  /** Forgets one event identifier, so a later `markEventProcessed` for it returns `true` again. */
  forgetEvent(source: string, eventId: string): Promise<void>

  /** Forgets every event identifier recorded before `instant`. Later ones are kept. */
  deleteEventsOlderThan(instant: string): Promise<void>

  /**
   * Lists the keys whose snapshot was fetched before `olderThan`, at most `limit` per page and
   * each key once across the pages of one listing. `cursor` is `null` for the first page.
   *
   * A cursor stays valid while the listing changes under it: when keys listed before it stop
   * qualifying (their snapshot was fetched again) no key that still qualifies is skipped, and no
   * key is listed twice. A caller may therefore refresh the keys of a page before it asks for the
   * next one.
   */
  listStaleKeys(olderThan: string, limit: number, cursor: string | null): Promise<KeyPage>
}
