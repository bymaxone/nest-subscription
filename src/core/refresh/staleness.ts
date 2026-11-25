/**
 * @fileoverview The age of a snapshot, as a pure function of the snapshot and the instant the
 * caller passes in, so no clock is read here and a test sets time by hand.
 * @layer core
 */
import { parseInstant, type SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

/**
 * How long ago the snapshot was fetched, in milliseconds, at `now`. A fetch instant ahead of `now`
 * (another host's clock running ahead) gives zero, never a negative age.
 *
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` when `fetchedAt` is not an
 * ISO 8601 instant.
 */
export function ageOf(snapshot: SubscriptionSnapshot, now: Date): number {
  return Math.max(0, now.getTime() - parseInstant(snapshot.fetchedAt))
}
