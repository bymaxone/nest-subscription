/**
 * @fileoverview Builders the management specs share: records, snapshots and a service wired to a
 * fake source, an in-memory store and a manual clock. The file is a spec so that it may import the test doubles; its own cases
 * pin the builders.
 * @layer core
 */
import type { AccountReference } from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  type NonRenewingPurchaseRecord,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import { Reconciler } from '../reconciliation/reconciler'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { SubscriptionService } from '../subscription.service'
import type { AgedSnapshot } from '../snapshot-view'
import type { ManagementContext } from './perform-operation'

/** The account the specs act as. */
export const ACCOUNT: AccountReference = { accountId: 'acc-1' }

/** The instant the manual clock starts at. */
export const T0 = '2026-01-01T00:00:00.000Z'

/** A subscription of a Google Play origin that renews, with the given fields changed. */
export function subscriptionOf(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    subscriptionReference: 'sub-1',
    status: 'active',
    givesAccess: true,
    willRenew: 'yes',
    origin: 'play_store',
    environment: 'production',
    productReference: 'pro_monthly',
    billingInterval: '',
    currentPeriodStart: T0,
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    accessUntil: '2026-02-01T00:00:00.000Z',
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: 'https://manage.example/sub-1',
    ...overrides
  }
}

/** A non-renewing purchase of a Google Play origin, with the given fields changed. */
export function purchaseOf(
  overrides: Partial<NonRenewingPurchaseRecord> = {}
): NonRenewingPurchaseRecord {
  return {
    purchaseReference: 'pur-1',
    entitlementNames: ['pro'],
    givesAccess: true,
    origin: 'play_store',
    environment: 'production',
    productReference: 'lifetime',
    purchasedAt: T0,
    accessUntil: null,
    refundedAt: null,
    ...overrides
  }
}

/** The snapshot of an account holding the given subscriptions and purchases. */
export function snapshotOf(
  account: AccountReference,
  subscriptions: readonly SubscriptionRecord[],
  purchases: readonly NonRenewingPurchaseRecord[] = [],
  sourceUpdatedAt: string | null = T0
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: T0
    }),
    subscriptions,
    nonRenewingPurchases: purchases,
    sourceUpdatedAt
  }
}

/** A service, its parts and a context for the flow, built over fresh doubles. */
export interface Harness {
  /** The scripted source. */
  readonly source: FakeSubscriptionSource
  /** The store the service reads and writes. */
  readonly store: InMemorySubscriptionStore
  /** The manual clock. */
  readonly clock: ManualClock
  /** The service under test. */
  readonly service: SubscriptionService
  /** The context the flow takes, over the same parts. */
  readonly context: ManagementContext
  /** Stores a snapshot as the account's stored state, through the refresher. */
  readonly seed: (account: AccountReference, snapshot: SubscriptionSnapshot) => Promise<void>
}

/** Builds the harness; `multiTenant` makes the service refuse an account without a tenant. */
export function harness(multiTenant = false): Harness {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const options = resolveOptions({
    source,
    store,
    clock,
    accountResolver: () => null,
    ...(multiTenant ? { multiTenant: true } : {})
  })
  const bridge = new ObserverBridge(null, clock)
  const refresher = new SnapshotRefresher(source, store, clock, null, null, bridge)
  const service = new SubscriptionService(
    source,
    store,
    clock,
    options,
    refresher,
    null,
    new Reconciler(store, clock, refresher, options, null),
    bridge
  )
  return {
    source,
    store,
    clock,
    service,
    context: {
      source,
      store,
      refresher,
      view: (snapshot): AgedSnapshot => ({ ...snapshot, ageMs: 0 })
    },
    seed: async (account, snapshot): Promise<void> => {
      source.setAccount(account, snapshot)
      await refresher.refresh(account)
    }
  }
}

describe('management builders', () => {
  it('seeds an account through the refresher so the service reads it back', async () => {
    // Scenario: a seeded snapshot is what the store holds afterwards, tenant included.
    const { service, seed } = harness(true)
    const account = { accountId: 'a', tenantId: 't' }
    await seed(account, snapshotOf(account, [subscriptionOf()], [purchaseOf()]))
    expect((await service.getSnapshot(account)).subscriptions).toStrictEqual([subscriptionOf()])
  })

  it('builds a snapshot without a tenant when the account names none', () => {
    // Scenario: the tenant key is absent, not undefined.
    expect('tenantId' in snapshotOf(ACCOUNT, [])).toBe(false)
  })
})
