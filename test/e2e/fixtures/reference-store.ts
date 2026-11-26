/**
 * @fileoverview The reference implementation of the store port over two PostgreSQL tables, as the
 * guide `docs/reference-store.md` presents it. It is a fixture and ships in no package: the library
 * holds no database client and no migration. The store talks to a one-method client that any
 * PostgreSQL driver satisfies, and the statements are exported constants so that the guide can be
 * checked against them word for word.
 * @layer e2e
 */
import {
  SubscriptionError,
  type KeyPage,
  type StoredSnapshot,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  parseInstant,
  type SubscriptionChange,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

/** What the store needs from a PostgreSQL driver: a parameterized query that returns its rows. */
export interface SqlClient {
  /** Runs one statement with positional parameters and returns the rows it produced. */
  query(
    text: string,
    values: unknown[]
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>
}

/** The two tables and their indexes. */
export const SCHEMA_SQL = `CREATE TABLE subscription_snapshot (
  key               text COLLATE "C" PRIMARY KEY,
  snapshot          jsonb       NOT NULL,
  fetched_at        timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  pending_changes   jsonb       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX subscription_snapshot_fetched_at ON subscription_snapshot (fetched_at);

CREATE INDEX subscription_snapshot_pending ON subscription_snapshot (key)
  WHERE pending_changes <> '[]'::jsonb;

CREATE TABLE subscription_processed_event (
  source      text        NOT NULL,
  event_id    text        NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (source, event_id)
);

CREATE INDEX subscription_processed_event_received_at
  ON subscription_processed_event (received_at);`

/** Reads one snapshot with its pending changes. */
export const GET_SNAPSHOT_SQL = `SELECT snapshot, pending_changes
FROM subscription_snapshot
WHERE key = $1`

/** Writes a snapshot unless a newer one is held, and appends the new changes in the same row. */
export const PUT_SNAPSHOT_SQL = `INSERT INTO subscription_snapshot AS held
  (key, snapshot, fetched_at, source_updated_at, pending_changes)
VALUES ($1, $2::jsonb, $3::timestamptz, $4::timestamptz, $5::jsonb)
ON CONFLICT (key) DO UPDATE SET
  snapshot          = EXCLUDED.snapshot,
  fetched_at        = EXCLUDED.fetched_at,
  source_updated_at = EXCLUDED.source_updated_at,
  pending_changes   = held.pending_changes || COALESCE((
    SELECT jsonb_agg(incoming.change ORDER BY incoming.ordinal)
    FROM jsonb_array_elements(EXCLUDED.pending_changes)
         WITH ORDINALITY AS incoming(change, ordinal)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(held.pending_changes) AS kept(change)
      WHERE kept.change ->> 'key' = incoming.change ->> 'key'
    )
  ), '[]'::jsonb)
WHERE held.source_updated_at <= EXCLUDED.source_updated_at
RETURNING 1 AS written`

/** Removes the named pending changes of one key and no others. */
export const CLEAR_PENDING_SQL = `UPDATE subscription_snapshot
SET pending_changes = COALESCE((
  SELECT jsonb_agg(pending.change ORDER BY pending.ordinal)
  FROM jsonb_array_elements(subscription_snapshot.pending_changes)
       WITH ORDINALITY AS pending(change, ordinal)
  WHERE NOT (pending.change ->> 'key' = ANY ($2::text[]))
), '[]'::jsonb)
WHERE key = $1`

/** Lists one page of the keys that still have pending changes, after a cursor. */
export const LIST_PENDING_SQL = `SELECT key
FROM subscription_snapshot
WHERE pending_changes <> '[]'::jsonb
  AND ($2::text IS NULL OR key > $2)
ORDER BY key
LIMIT $1`

/** Records an event identifier; a row comes back only for the call that recorded it. */
export const MARK_EVENT_SQL = `INSERT INTO subscription_processed_event (source, event_id, received_at)
VALUES ($1, $2, $3::timestamptz)
ON CONFLICT (source, event_id) DO NOTHING
RETURNING 1 AS recorded`

/** Forgets one event identifier. */
export const FORGET_EVENT_SQL = `DELETE FROM subscription_processed_event
WHERE source = $1 AND event_id = $2`

/** Forgets every event identifier recorded before an instant. */
export const DELETE_EVENTS_SQL = `DELETE FROM subscription_processed_event
WHERE received_at < $1::timestamptz`

/** Lists one page of the keys whose snapshot was fetched before an instant, after a cursor. */
export const LIST_STALE_SQL = `SELECT key
FROM subscription_snapshot
WHERE fetched_at < $1::timestamptz
  AND ($3::text IS NULL OR key > $3)
ORDER BY key
LIMIT $2`

/** Every statement the store runs, for the guide's check. */
export const REFERENCE_STATEMENTS: readonly string[] = [
  SCHEMA_SQL,
  GET_SNAPSHOT_SQL,
  PUT_SNAPSHOT_SQL,
  CLEAR_PENDING_SQL,
  LIST_PENDING_SQL,
  MARK_EVENT_SQL,
  FORGET_EVENT_SQL,
  DELETE_EVENTS_SQL,
  LIST_STALE_SQL
]

/** A page limit is a positive whole number. */
function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  }
}

/** The changes with a repeated key left out, the first of each kept. */
function distinctChanges(changes: readonly SubscriptionChange[]): SubscriptionChange[] {
  const seen = new Set<string>()
  return changes.filter((change) => !seen.has(change.key) && Boolean(seen.add(change.key)))
}

/** A page from the rows of a query that asked for one more than the limit. */
function pageOf(rows: readonly Record<string, unknown>[], limit: number): KeyPage {
  const keys = rows.map((row) => String(row['key']))
  const page = keys.slice(0, limit)
  return { keys: page, nextCursor: keys.length > limit ? (page.at(-1) ?? null) : null }
}

/** The store port over PostgreSQL. */
export class ReferencePostgresStore implements SubscriptionStore {
  /** @param client A PostgreSQL client; each call is one statement and one round trip. */
  constructor(private readonly client: SqlClient) {}

  /** Reads one snapshot with its pending changes, or `null` when none is stored. */
  async getSnapshot(key: string): Promise<StoredSnapshot | null> {
    const { rows } = await this.client.query(GET_SNAPSHOT_SQL, [key])
    const row = rows[0]
    if (row === undefined) return null
    const snapshot = row['snapshot'] as SubscriptionSnapshot
    const pendingChanges = row['pending_changes'] as readonly SubscriptionChange[]
    return { snapshot, pendingChanges }
  }

  /** Writes unless a newer snapshot is held; returns whether it wrote. */
  async putSnapshot(
    key: string,
    snapshot: SubscriptionSnapshot,
    pendingChanges: readonly SubscriptionChange[],
    sourceUpdatedAt: string
  ): Promise<boolean> {
    parseInstant(sourceUpdatedAt)
    parseInstant(snapshot.fetchedAt)
    const { rows } = await this.client.query(PUT_SNAPSHOT_SQL, [
      key,
      JSON.stringify(snapshot),
      snapshot.fetchedAt,
      sourceUpdatedAt,
      JSON.stringify(distinctChanges(pendingChanges))
    ])
    return rows.length === 1
  }

  /** Removes the named pending changes of one key. */
  async clearPendingChanges(key: string, changeKeys: readonly string[]): Promise<void> {
    await this.client.query(CLEAR_PENDING_SQL, [key, [...changeKeys]])
  }

  /** Lists the keys that still have pending changes, one page. */
  async listKeysWithPendingChanges(limit: number, cursor: string | null): Promise<KeyPage> {
    checkLimit(limit)
    const { rows } = await this.client.query(LIST_PENDING_SQL, [limit + 1, cursor])
    return pageOf(rows, limit)
  }

  /** Records an event identifier; returns whether this call recorded it. */
  async markEventProcessed(source: string, eventId: string, receivedAt: string): Promise<boolean> {
    parseInstant(receivedAt)
    const { rows } = await this.client.query(MARK_EVENT_SQL, [source, eventId, receivedAt])
    return rows.length === 1
  }

  /** Forgets one event identifier. */
  async forgetEvent(source: string, eventId: string): Promise<void> {
    await this.client.query(FORGET_EVENT_SQL, [source, eventId])
  }

  /** Forgets every event identifier recorded before the instant. */
  async deleteEventsOlderThan(instant: string): Promise<void> {
    parseInstant(instant)
    await this.client.query(DELETE_EVENTS_SQL, [instant])
  }

  /** Lists the keys whose snapshot was fetched before the instant, one page. */
  async listStaleKeys(olderThan: string, limit: number, cursor: string | null): Promise<KeyPage> {
    parseInstant(olderThan)
    checkLimit(limit)
    const { rows } = await this.client.query(LIST_STALE_SQL, [olderThan, limit + 1, cursor])
    return pageOf(rows, limit)
  }
}
