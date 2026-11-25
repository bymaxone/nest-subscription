/**
 * @fileoverview The view of a snapshot that the service hands to a caller: a deeply frozen copy
 * that carries the snapshot's age. A copy, because the object a store or a cache returned may be
 * held by the host and must not be frozen or changed from here.
 * @layer core
 */
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

/** A snapshot with the time since it was fetched (FR25). */
export type AgedSnapshot = SubscriptionSnapshot & {
  /** How long ago the library read the source for this snapshot, in milliseconds. */
  readonly ageMs: number
}

/** Freezes a value and everything it holds. Snapshots are plain data, so there are no cycles. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Copies a snapshot, adds its age and freezes the result. The argument is left as it was.
 *
 * @param snapshot The snapshot as the store or the source gave it.
 * @param ageMs The age to carry, in milliseconds.
 */
export function toSnapshotView(snapshot: SubscriptionSnapshot, ageMs: number): AgedSnapshot {
  return deepFreeze({ ...structuredClone(snapshot), ageMs })
}
