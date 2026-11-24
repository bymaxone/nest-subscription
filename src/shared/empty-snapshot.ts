/**
 * @fileoverview The snapshot of an account the source does not know: a value, never an error.
 * @layer shared
 */
import type { SubscriptionSnapshot } from './snapshot.types'

/** What is known about an account when the source has no record of it. */
export interface EmptySnapshotInput {
  /** The account the snapshot belongs to. */
  readonly accountId: string
  /** The tenant of the account, when the host is multi-tenant. */
  readonly tenantId?: string
  /** The name of the source that was asked. */
  readonly source: string
  /** The instant the source was read, as an ISO 8601 string. */
  readonly fetchedAt: string
}

/**
 * Builds the snapshot of an account the source does not know: no entitlements, no subscriptions,
 * no source customer and no source update instant. It never throws; an unknown account is a state
 * a host can read, not a failure.
 */
export function createEmptySnapshot(input: EmptySnapshotInput): SubscriptionSnapshot {
  return {
    accountId: input.accountId,
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    entitlements: [],
    subscriptions: [],
    source: input.source,
    sourceCustomer: null,
    fetchedAt: input.fetchedAt,
    sourceUpdatedAt: null
  }
}
