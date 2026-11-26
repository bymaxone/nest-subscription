# Reference store over PostgreSQL

The library persists nothing itself. A host implements the store port ([`SubscriptionStore`](../src/internal/store.port.ts)) over its own database, and this guide is a reference implementation for PostgreSQL: the two records of the specification as two tables, and each port method as one statement. The library ships no database client and no migration; the code here is documentation, and nothing in it is exported by the package.

The statements below are the ones of a fixture kept in this repository, [`test/e2e/fixtures/reference-store.ts`](../test/e2e/fixtures/reference-store.ts), and a test fails when the guide and the fixture differ. The fixture talks to a client with one method, `query(text, values)`, which the `Pool` of the `pg` driver has as it is.

## How it was verified

The fixture passes every case of `storeConformanceCases()` (the `testing` subpath) against PostgreSQL 17.12. The maintainer ran it on 2026-11-26 in a local container with the `pg` driver (8.23.1), one case at a time with the tables emptied before each. The continuous integration of this repository has no database, so that run is not part of it: the spec [`test/e2e/reference-store.e2e-spec.ts`](../test/e2e/reference-store.e2e-spec.ts) runs the conformance suite when `REFERENCE_STORE_DATABASE_URL` names a database, and is skipped otherwise. What always runs is the check that this guide shows the fixture's statements word for word, and the checks of the TypeScript around the statements.

A host that adopts the store runs the conformance suite against its own database and its own driver, which is how the cases are written to be used:

```ts
import { storeConformanceCases } from '@bymax-one/nest-subscription/testing'

for (const conformance of storeConformanceCases()) {
  // `createStore` returns a store over empty tables, so every case starts clean.
  await conformance.run(createStore)
}
```

A broken statement is caught. With `<=` changed to `<` in the conditional write, and the event insert changed to update on conflict, cases fail.

## The two records

```sql
CREATE TABLE subscription_snapshot (
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
  ON subscription_processed_event (received_at);
```

- One row per key. The key is the output of `encodeAccountKey` (the tenant and the account, length-prefixed so that no two pairs share a key), and the store treats it as an opaque string. It is `COLLATE "C"` so that "after this key" in a listing means the same thing in the database as in the library: byte order, not the locale's.
- One row per source and event identifier. The primary key is what makes "mark event processed" atomic.
- `snapshot` is the whole normalized document as `jsonb`. The library reads it back as it wrote it, and treats one that does not name the account of the key, or that holds an instant that is not ISO 8601, as absent.
- `pending_changes` holds the changes the host has not been told about, oldest first, in the same row as the snapshot. A snapshot and its changes are written in one statement, so a crash cannot keep one and lose the other.
- `source_updated_at` is the instant the source says the state is as of (the caller passes the fetch instant when the source says none). It orders writes. `fetched_at` is the snapshot's own fetch instant and drives the stale listing.
- The partial index serves "keys that still have changes" without scanning every snapshot; the other two indexes serve the stale listing and the retention delete.

## What the library relies on, and what provides it

Every method may be called concurrently, including for one key and from several instances of the host. Every statement runs in PostgreSQL's default isolation level, `READ COMMITTED`, alone, with no explicit transaction. Each guarantee below holds because of the form of the statement, not because of a stronger isolation level.

| Guarantee of the port                                                  | What provides it                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A write older than the stored one is refused whole                     | The `WHERE` of `ON CONFLICT DO UPDATE`: the row changes only when the held instant is not later than the new one. A refused write changes neither the snapshot nor the changes, and returns no row.                |
| Of two concurrent writes the older never wins, in either order         | `ON CONFLICT DO UPDATE` locks the row. The second statement waits for the first to commit and then evaluates the `WHERE` against the row as the first left it, so the comparison is always against the latest row. |
| An equal instant replaces                                              | The comparison is `<=`.                                                                                                                                                                                            |
| The snapshot and its new changes are written together                  | One statement, one row.                                                                                                                                                                                            |
| A change already pending is not added twice                            | The `NOT EXISTS` over the held changes by `key`. The fixture also sends once a change whose key repeats within one call.                                                                                           |
| Exactly one of any number of concurrent marks of one identifier is new | `INSERT ... ON CONFLICT DO NOTHING RETURNING`: the unique index decides, and only the statement that inserted gets a row back.                                                                                     |
| A cursor stays valid while the listing changes under it                | Keyset paging, `key > cursor ORDER BY key`. A key that stops qualifying is not returned; one that still qualifies and sorts after the cursor is never skipped. No offset is used.                                  |

Without the uniqueness of the second record, an event is processed twice. Without the conditional write, a late webhook can replace newer state with older state. These are the two defects the conformance suite is built to catch.

## Each port method

### `getSnapshot(key)`

```sql
SELECT snapshot, pending_changes
FROM subscription_snapshot
WHERE key = $1
```

No row means `null`. The two columns are the snapshot and its pending changes.

### `putSnapshot(key, snapshot, pendingChanges, sourceUpdatedAt)`

```sql
INSERT INTO subscription_snapshot AS held
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
RETURNING 1 AS written
```

The parameters are the key, the snapshot as JSON, its `fetchedAt`, `sourceUpdatedAt` and the changes as a JSON array. A returned row means the write happened (`true`); no row means a newer snapshot is held (`false`). On a first insert there is nothing to compare and the changes are stored as given. On an update the new changes are appended after the held ones, skipping any whose `key` is already there.

### `clearPendingChanges(key, changeKeys)`

```sql
UPDATE subscription_snapshot
SET pending_changes = COALESCE((
  SELECT jsonb_agg(pending.change ORDER BY pending.ordinal)
  FROM jsonb_array_elements(subscription_snapshot.pending_changes)
       WITH ORDINALITY AS pending(change, ordinal)
  WHERE NOT (pending.change ->> 'key' = ANY ($2::text[]))
), '[]'::jsonb)
WHERE key = $1
```

It removes the named changes and no others. Keys that are not pending are ignored, a key with no row changes nothing, and the snapshot is untouched. The statement locks the row it reads, so it cannot remove a change a concurrent write has just appended.

### `listKeysWithPendingChanges(limit, cursor)`

```sql
SELECT key
FROM subscription_snapshot
WHERE pending_changes <> '[]'::jsonb
  AND ($2::text IS NULL OR key > $2)
ORDER BY key
LIMIT $1
```

The fixture passes `limit + 1`. When one row more than the limit comes back there is another page and the cursor is the last key of this one; otherwise the cursor is `null`. The limit must be a positive whole number, and the fixture refuses anything else with `SUBSCRIPTION_INVALID_INPUT` before it sends a statement.

### `markEventProcessed(source, eventId, receivedAt)`

```sql
INSERT INTO subscription_processed_event (source, event_id, received_at)
VALUES ($1, $2, $3::timestamptz)
ON CONFLICT (source, event_id) DO NOTHING
RETURNING 1 AS recorded
```

A row back means this call recorded the identifier (`true`); none means it was there already (`false`).

### `forgetEvent(source, eventId)`

```sql
DELETE FROM subscription_processed_event
WHERE source = $1 AND event_id = $2
```

After it, a later `markEventProcessed` for the same pair returns `true` again. The library calls it when an event ends in a failure, so that the source's retry is processed.

### `deleteEventsOlderThan(instant)`, the retention delete

```sql
DELETE FROM subscription_processed_event
WHERE received_at < $1::timestamptz
```

Each reconciliation run calls it with the moment the retention (`eventRetentionMs`, 7 days by default) ended. Identifiers older than that are forgotten, so a retry that arrives after the retention is processed again; keep the retention longer than the longest span in which the source can deliver an event again. Nothing else purges them, so a host that never runs reconciliation never purges.

### `listStaleKeys(olderThan, limit, cursor)`

```sql
SELECT key
FROM subscription_snapshot
WHERE fetched_at < $1::timestamptz
  AND ($3::text IS NULL OR key > $3)
ORDER BY key
LIMIT $2
```

The keys whose snapshot was fetched before the instant, paged like the pending listing. The library refreshes the keys of a page before it asks for the next one, and a refreshed key leaves the listing; the cursor is a key and not an offset, so no key that still qualifies is skipped.

## Limits of this reference

- It is a reference, not a hardened product. The statements were run against PostgreSQL 17 with one driver. Run the conformance suite against the database version, the driver and the pool configuration you deploy.
- Several instances of one host share the tables, which is the point of a database store. The in-memory store of the `testing` subpath does not: it is for tests and development only.
- A read replica can lag. Read `getSnapshot` through the primary unless the host accepts a read older than the last write.
- The snapshot and the changes hold account identifiers and entitlement names. The library stores no payment data and no raw webhook payload; keep the tables under the host's own access rules and backups.
- Nothing here migrates an existing table. The statements create new ones; evolve them with the host's own migration tool.
