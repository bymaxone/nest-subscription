/**
 * @fileoverview The reference store of the guide `docs/reference-store.md`. Three things are held
 * here. The statements the guide shows are the statements the fixture runs, word for word. The
 * fixture's own code around the statements (paging, limits, duplicate changes) is exercised against
 * a recording client. And, when `REFERENCE_STORE_DATABASE_URL` names a PostgreSQL database, the
 * whole conformance suite runs against the real tables; without it that part is skipped, because
 * the continuous integration of this repository has no database. The module that provides the
 * driver is named by `REFERENCE_STORE_PG_MODULE` and defaults to `pg`, which the repository does
 * not depend on.
 * @layer e2e
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { SubscriptionError } from '@bymax-one/nest-subscription'
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import { storeConformanceCases } from '@bymax-one/nest-subscription/testing'

import {
  LIST_PENDING_SQL,
  LIST_STALE_SQL,
  PUT_SNAPSHOT_SQL,
  REFERENCE_STATEMENTS,
  ReferencePostgresStore,
  SCHEMA_SQL,
  type SqlClient
} from './fixtures/reference-store'

const AT = '2026-01-01T00:00:00.000Z'

/** A client that records each statement and answers with the rows it was given. */
function recording(rows: Record<string, unknown>[] = []): {
  readonly client: SqlClient
  readonly calls: { text: string; values: unknown[] }[]
} {
  const calls: { text: string; values: unknown[] }[] = []
  return {
    calls,
    client: {
      query: (text, values) => {
        calls.push({ text, values })
        return Promise.resolve({ rows })
      }
    }
  }
}

describe('reference store: the guide and the fixture', () => {
  it('shows every statement of the fixture in the guide, word for word', () => {
    // Scenario: the guide is documentation of the fixture, so a statement edited in one place
    // and not the other fails here.
    const guide = readFileSync(join(__dirname, '..', '..', 'docs', 'reference-store.md'), 'utf8')
    for (const statement of REFERENCE_STATEMENTS) {
      expect(guide).toContain(statement)
    }
  })

  it('creates the two records of the specification with the uniqueness the library relies on', () => {
    // Scenario: one row per key, and one row per source and event identifier.
    expect(SCHEMA_SQL).toContain('key               text COLLATE "C" PRIMARY KEY')
    expect(SCHEMA_SQL).toContain('PRIMARY KEY (source, event_id)')
  })
})

describe('reference store: the code around the statements', () => {
  it('sends a page one row longer than asked and returns the cursor only when more remain', async () => {
    // Scenario: three keys come back for a limit of two, so the page holds two and a cursor; two
    // keys for a limit of two end the listing.
    const more = recording([{ key: 'a' }, { key: 'b' }, { key: 'c' }])
    const first = await new ReferencePostgresStore(more.client).listKeysWithPendingChanges(2, null)
    expect(first).toStrictEqual({ keys: ['a', 'b'], nextCursor: 'b' })
    expect(more.calls[0]).toStrictEqual({ text: LIST_PENDING_SQL, values: [3, null] })
    const last = recording([{ key: 'c' }, { key: 'd' }])
    const done = await new ReferencePostgresStore(last.client).listStaleKeys(AT, 2, 'b')
    expect(done).toStrictEqual({ keys: ['c', 'd'], nextCursor: null })
    expect(last.calls[0]).toStrictEqual({ text: LIST_STALE_SQL, values: [AT, 3, 'b'] })
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses the page limit %s as invalid input', async (limit) => {
    // Scenario: a limit that is not a positive whole number reaches no statement.
    const { client, calls } = recording()
    const store = new ReferencePostgresStore(client)
    await expect(store.listKeysWithPendingChanges(limit, null)).rejects.toBeInstanceOf(
      SubscriptionError
    )
    await expect(store.listStaleKeys(AT, limit, null)).rejects.toBeInstanceOf(SubscriptionError)
    expect(calls).toHaveLength(0)
  })

  it('sends a change whose key repeats once, and reports whether a row was written', async () => {
    // Scenario: two changes with one key become one in the parameter; a row back means written.
    const written = recording([{ written: 1 }])
    const snapshot = createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: AT })
    const changes = [
      { kind: 'started' as const, key: 'k' },
      { kind: 'renewed' as const, key: 'k' }
    ]
    const store = new ReferencePostgresStore(written.client)
    expect(await store.putSnapshot('key', snapshot, changes, AT)).toBe(true)
    expect(written.calls[0]?.text).toBe(PUT_SNAPSHOT_SQL)
    expect(written.calls[0]?.values[4]).toBe(JSON.stringify([changes[0]]))
    const refused = recording([])
    expect(
      await new ReferencePostgresStore(refused.client).putSnapshot('key', snapshot, [], AT)
    ).toBe(false)
  })

  it('refuses an instant that is not ISO 8601 before any statement', async () => {
    // Scenario: the library treats a bad instant as invalid input, and so does the store.
    const { client, calls } = recording()
    const store = new ReferencePostgresStore(client)
    const snapshot = createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: AT })
    await expect(store.putSnapshot('key', snapshot, [], 'yesterday')).rejects.toBeInstanceOf(
      SubscriptionError
    )
    await expect(store.markEventProcessed('s', 'e', 'yesterday')).rejects.toBeInstanceOf(
      SubscriptionError
    )
    await expect(store.deleteEventsOlderThan('yesterday')).rejects.toBeInstanceOf(SubscriptionError)
    await expect(store.listStaleKeys('yesterday', 1, null)).rejects.toBeInstanceOf(
      SubscriptionError
    )
    expect(calls).toHaveLength(0)
  })

  it('returns null for a key with no row and the stored document for one with a row', async () => {
    // Scenario: the row's two columns become the stored snapshot and its pending changes.
    const snapshot = createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: AT })
    const none = new ReferencePostgresStore(recording().client)
    expect(await none.getSnapshot('key')).toBeNull()
    const held = recording([{ snapshot, pending_changes: [{ kind: 'started', key: 'k' }] }])
    expect(await new ReferencePostgresStore(held.client).getSnapshot('key')).toStrictEqual({
      snapshot,
      pendingChanges: [{ kind: 'started', key: 'k' }]
    })
  })
})

/** The connection string of the database to run against, when one is named. */
const DATABASE_URL = process.env['REFERENCE_STORE_DATABASE_URL']

/** The part that needs a database: skipped, with the reason in the file header, without one. */
const withDatabase = DATABASE_URL === undefined ? describe.skip : describe

withDatabase('reference store: the conformance suite against PostgreSQL', () => {
  /** What the driver's pool offers that this suite uses. */
  interface Pool extends SqlClient {
    end(): Promise<void>
  }
  let pool: Pool

  beforeAll(async () => {
    const driver: unknown = createRequire(__filename)(
      process.env['REFERENCE_STORE_PG_MODULE'] ?? 'pg'
    )
    const PoolClass: new (config: { connectionString: string | undefined }) => Pool = Reflect.get(
      Object(driver),
      'Pool'
    )
    pool = new PoolClass({ connectionString: DATABASE_URL })
    await pool.query('DROP TABLE IF EXISTS subscription_snapshot, subscription_processed_event', [])
    for (const statement of SCHEMA_SQL.split(';\n\n')) {
      await pool.query(statement.replace(/;$/, ''), [])
    }
  })

  afterAll(async () => {
    await pool.end()
  })

  it.each(storeConformanceCases().map((conformance) => [conformance.name, conformance] as const))(
    'passes: %s',
    async (_name, conformance) => {
      // Scenario: each case gets the tables emptied, so it sees a fresh store, as the suite asks.
      await conformance.run(async () => {
        await pool.query('TRUNCATE subscription_snapshot, subscription_processed_event', [])
        return new ReferencePostgresStore(pool)
      })
    }
  )
})
