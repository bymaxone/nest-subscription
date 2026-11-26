/**
 * @fileoverview The one flow every management operation runs on: the ownership check inside the
 * caller's own snapshot, the adapter's capability answer, one call to the source, a refresh
 * through the refresher, and a result that is the snapshot read back. The flow has no value for
 * "assumed done": an accepted request that the read-back contradicts is reported as such.
 * @layer core
 */
import {
  SubscriptionError,
  type AccountReference,
  type ManagedRecord,
  type ManagementOperation,
  type OperationResult,
  type SourceCapabilities,
  type SubscriptionSource,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { findOwnRecord, locateRecord } from './find-own-record'
import type {
  ManagedRecordKind,
  PersonMustAct,
  ReadBack,
  SubscriptionCapabilities,
  Unconfirmed
} from './management.types'
import type { SnapshotRefresher } from '../refresh/snapshot-refresher'
import type { AgedSnapshot } from '../snapshot-view'

/** What the flow needs from the service. */
export interface ManagementContext {
  /** The adapter. */
  readonly source: SubscriptionSource
  /** The store the ownership check reads. */
  readonly store: SubscriptionStore
  /** The refresher the read-back goes through, so the host's hook is told in the normal way. */
  readonly refresher: SnapshotRefresher
  /** The frozen view of a snapshot with its age, as the service returns it. */
  readonly view: (snapshot: SubscriptionSnapshot) => AgedSnapshot
}

/** One operation: whether the adapter has it, what it asks of the source, and what must show. */
export interface OperationSpec {
  /** The operation, as the capability answer names it. */
  readonly operation: ManagementOperation
  /**
   * Whether the adapter implements the operation for a record of this kind. It is decided before
   * anything is read, so an operation the adapter lacks costs no request.
   */
  readonly applies: (source: SubscriptionSource, kind: ManagedRecordKind) => boolean
  /** Asks the source about the fresh record, in one call. Only asked where `applies` is true. */
  readonly ask: (
    source: SubscriptionSource,
    account: AccountReference,
    target: ManagedRecord
  ) => Promise<OperationResult>
  /** Whether the record as read back shows the effect, given the fresh record before the write. */
  readonly shows: (before: ManagedRecord, after: ManagedRecord | undefined) => boolean
}

/** What an operation answers for a record or an adapter it does not apply to: the person acts. */
export const NOT_APPLICABLE: Promise<OperationResult> = Promise.resolve({
  outcome: 'customer_action_required',
  managementReference: null
})

/** The failure of the source as the library names it; a library error passes unchanged. */
async function guarded<T>(call: Promise<T>): Promise<T> {
  try {
    return await call
  } catch (cause) {
    throw cause instanceof SubscriptionError
      ? cause
      : new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE, { cause })
  }
}

/** Asks the adapter what can be done with a record; a rejection becomes the library's error. */
function askCapabilities(
  context: ManagementContext,
  account: AccountReference,
  target: ManagedRecord
): Promise<SourceCapabilities> {
  return guarded(Promise.resolve().then(() => context.source.capabilities(account, target)))
}

/**
 * What can be done with one record of the account. The record is found in the account's own
 * snapshot first; the adapter is asked each time and the answer is not kept.
 *
 * @throws {SubscriptionError} as {@link findOwnRecord} does, and with
 *   `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the adapter fails.
 */
export async function describeCapabilities(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string
): Promise<SubscriptionCapabilities> {
  const target = await findOwnRecord(context.store, account, recordRef)
  const answer = await askCapabilities(context, account, target)
  return {
    kind: target.kind,
    possible: {
      stop_renewal: answer.operations.includes('stop_renewal'),
      resume: answer.operations.includes('resume'),
      change_product: answer.operations.includes('change_product'),
      extend: answer.operations.includes('extend'),
      refund: answer.operations.includes('refund')
    },
    managementReference: answer.managementReference
  }
}

/** The result of an operation that reached the source, before it is named for its operation. */
export type Performed = PersonMustAct | Unconfirmed | ReadBack<'confirmed' | 'contradicted'>

/** Names a performed operation for its public result type. */
export function named<Done extends string, NotDone extends string>(
  performed: Performed,
  done: Done,
  notDone: NotDone
): PersonMustAct | Unconfirmed | ReadBack<Done | NotDone> {
  return 'snapshot' in performed
    ? {
        outcome: performed.outcome === 'confirmed' ? done : notDone,
        snapshot: performed.snapshot
      }
    : performed
}

/**
 * Reads the account from the source and stores what it reads.
 *
 * @throws {SubscriptionError} with `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the read fails.
 */
async function readFresh(
  context: ManagementContext,
  account: AccountReference
): Promise<SubscriptionSnapshot> {
  const { current, delivery } = await context.refresher.refresh(account)
  await delivery
  return current
}

/**
 * The record as the source reports it now. It is the one the write is asked about and the one the
 * read-back is compared with, so a change that happened by itself is not read as the write's.
 *
 * @throws {SubscriptionError} with `SUBSCRIPTION_ACCOUNT_UNKNOWN` when the source no longer has the
 *   record, and with `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the read fails; nothing was written.
 */
async function freshRecord(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string
): Promise<ManagedRecord> {
  const found = locateRecord(await readFresh(context, account), recordRef)
  if (found === undefined) throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
  return found
}

/** The snapshot read back after an accepted write, or `undefined` when that read fails. */
async function readBack(
  context: ManagementContext,
  account: AccountReference
): Promise<SubscriptionSnapshot | undefined> {
  try {
    return await readFresh(context, account)
  } catch {
    return undefined
  }
}

/**
 * Performs one operation on one record of the authenticated account, in this order: the record is
 * found in the account's own stored snapshot; the adapter says whether a server can do the
 * operation, and where it cannot the result is `person_must_act` with no read and no write; the
 * account is read afresh and the record taken from that read; the source is asked once about that
 * fresh record; the account is read back and the read-back is compared with the fresh record.
 *
 * @param context The adapter, the store, the refresher and the view.
 * @param account The authenticated account and tenant; the record is searched in its snapshot only.
 * @param recordRef The reference of a subscription or a non-renewing purchase of that account.
 * @param spec The operation.
 * @returns `unconfirmed` when the source accepted the request and the read-back failed: the effect
 *   is unknown.
 * @throws {SubscriptionError} with `SUBSCRIPTION_ACCOUNT_UNKNOWN` for a record the account does
 *   not hold, in the stored snapshot or in the fresh read, and with
 *   `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the fresh read fails (nothing was written) or when the
 *   write itself throws, in which case the effect of the write is unknown.
 */
export async function performOperation(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string,
  spec: OperationSpec
): Promise<Performed> {
  const target = await findOwnRecord(context.store, account, recordRef)
  const answer = await askCapabilities(context, account, target)
  if (!answer.operations.includes(spec.operation) || !spec.applies(context.source, target.kind)) {
    return { outcome: 'person_must_act', managementReference: answer.managementReference }
  }
  const before = await freshRecord(context, account, recordRef)
  const result = await guarded(
    Promise.resolve().then(() => spec.ask(context.source, account, before))
  )
  if (result.outcome === 'customer_action_required') {
    return {
      outcome: 'person_must_act',
      managementReference: result.managementReference ?? answer.managementReference
    }
  }
  const current = await readBack(context, account)
  if (current === undefined) return { outcome: 'unconfirmed' }
  const confirmed = spec.shows(before, locateRecord(current, recordRef))
  return { outcome: confirmed ? 'confirmed' : 'contradicted', snapshot: context.view(current) }
}
