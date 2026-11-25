/**
 * @fileoverview The shapes the diff rules share: a change before it has its key, and a pair of
 * records of one subscription. Every rule reads model fields only, never a status name as access.
 * @layer core
 */
import type { ChangeKind, SubscriptionRecord } from '@bymax-one/nest-subscription/shared'

/**
 * One change found between two snapshots, before its key is derived. `facts` are the values that
 * tell this change from another of the same kind on the same subscription, such as the period
 * end of a renewal; they come from snapshots and from nothing else.
 */
export interface RawChange {
  /** What kind of change this is. */
  readonly kind: ChangeKind
  /** The subscription the change concerns; `null` for a change of the whole account. */
  readonly subscriptionReference: string | null
  /** The discriminating facts, each a plain string; an absent instant is the empty string. */
  readonly facts: readonly string[]
}

/** One subscription as the previous snapshot held it and as the current snapshot holds it. */
export interface SubscriptionPair {
  /** The record in the previous snapshot. */
  readonly previous: SubscriptionRecord
  /** The record in the current snapshot. */
  readonly current: SubscriptionRecord
}

/** Builds a change of one kind with its subscription and its discriminating facts. */
export function rawChange(
  kind: ChangeKind,
  subscriptionReference: string | null,
  ...facts: readonly string[]
): RawChange {
  return { kind, subscriptionReference, facts }
}
