/**
 * @fileoverview The shape of one reported change to a subscription snapshot.
 * @layer shared
 */
import type { ChangeKind } from './values'

/**
 * One change between two snapshots of an account: its kind, and a key that is the same every time
 * the same change is reported, so a host can make its reaction idempotent.
 */
export interface SubscriptionChange {
  /** What kind of change this is. */
  readonly kind: ChangeKind
  /**
   * Stable for one occurrence of a change, however often it is delivered. A change that is undone
   * and happens again gets another key.
   */
  readonly key: string
}
