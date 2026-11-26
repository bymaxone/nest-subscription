/**
 * @fileoverview The public result types of the management operations. Every operation answers a
 * closed union with no "assumed done" value: success is the snapshot read back from the source,
 * and a request the read-back contradicts is reported as not done (FR38).
 * @layer core
 */
import type { ManagementOperation } from '@bymax-one/nest-subscription/internal'

import type { AgedSnapshot } from '../snapshot-view'

/** What kind of record an operation can act on. */
export type ManagedRecordKind = 'subscription' | 'purchase'

/** What can be done with one record of an account, as the adapter answers for its origin. */
export interface SubscriptionCapabilities {
  /** Whether the record is a subscription or a non-renewing purchase. */
  readonly kind: ManagedRecordKind
  /** For each operation, whether a server can do it. */
  readonly possible: Readonly<Record<ManagementOperation, boolean>>
  /** Where the person manages the record, when the source provides one. */
  readonly managementReference: string | null
}

/**
 * The result where a server cannot do the operation: the person must, and the management
 * reference says where. It is a value, never an error.
 */
export interface PersonMustAct {
  /** Discriminant: nothing was asked of the source. */
  readonly outcome: 'person_must_act'
  /** Where the person manages the record; `null` when the source gives none. */
  readonly managementReference: string | null
}

/**
 * The result of an operation that reached the source: the snapshot read back afterwards, under
 * the name that says whether the read-back shows the effect.
 */
export interface ReadBack<Outcome extends string> {
  /** Whether the read-back shows what was asked. */
  readonly outcome: Outcome
  /** The snapshot read back from the source after the operation. */
  readonly snapshot: AgedSnapshot
}

/** The result of stopping a renewal. */
export type StopRenewalOutcome = ReadBack<'stopped' | 'not_stopped'> | PersonMustAct

/** The result of resuming a renewal. */
export type ResumeOutcome = ReadBack<'resumed' | 'not_resumed'> | PersonMustAct

/** The result of changing the product. */
export type ChangeProductOutcome =
  ReadBack<'product_changed' | 'product_not_changed'> | PersonMustAct

/** The result of extending the current period. */
export type ExtendOutcome = ReadBack<'extended' | 'not_extended'> | PersonMustAct

/** The result of a refund. */
export type RefundOutcome = ReadBack<'refunded' | 'not_refunded'> | PersonMustAct
