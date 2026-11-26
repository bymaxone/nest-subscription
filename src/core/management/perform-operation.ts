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
import type { PersonMustAct, ReadBack, SubscriptionCapabilities } from './management.types'
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

/** One operation: what it asks of the source and what the read-back must show. */
export interface OperationSpec {
  /** The operation, as the capability answer names it. */
  readonly operation: ManagementOperation
  /**
   * Asks the source, or answers `undefined` when the adapter does not implement the operation or
   * the record is not one the operation applies to. It makes at most one call.
   */
  readonly ask: (
    source: SubscriptionSource,
    account: AccountReference,
    target: ManagedRecord
  ) => Promise<OperationResult> | undefined
  /** Whether the record as read back shows the effect, given the record as it was before. */
  readonly shows: (before: ManagedRecord, after: ManagedRecord | undefined) => boolean
}

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

/** Asks the source once; a throw from the adapter, even a synchronous one, is a source failure. */
function askSource(
  context: ManagementContext,
  spec: OperationSpec,
  account: AccountReference,
  target: ManagedRecord
): Promise<OperationResult> | undefined {
  try {
    const asked = spec.ask(context.source, account, target)
    return asked === undefined ? undefined : guarded(asked)
  } catch (cause) {
    return guarded(Promise.reject(cause))
  }
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
export type Performed = PersonMustAct | ReadBack<'confirmed' | 'contradicted'>

/** Names a performed operation for its public result type. */
export function named<Done extends string, NotDone extends string>(
  performed: Performed,
  done: Done,
  notDone: NotDone
): PersonMustAct | ReadBack<Done | NotDone> {
  return performed.outcome === 'person_must_act'
    ? performed
    : { outcome: performed.outcome === 'confirmed' ? done : notDone, snapshot: performed.snapshot }
}

/**
 * Performs one operation on one record of the authenticated account.
 *
 * @param context The adapter, the store, the refresher and the view.
 * @param account The authenticated account and tenant; the record is searched in its snapshot only.
 * @param recordRef The reference of a subscription or a non-renewing purchase of that account.
 * @param spec The operation.
 * @throws {SubscriptionError} with `SUBSCRIPTION_ACCOUNT_UNKNOWN` for a record the account does
 *   not hold (no source is asked), and with `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the source
 *   fails, in which case the stored snapshot is as it was.
 */
export async function performOperation(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string,
  spec: OperationSpec
): Promise<Performed> {
  const target = await findOwnRecord(context.store, account, recordRef)
  const answer = await askCapabilities(context, account, target)
  const asked = answer.operations.includes(spec.operation)
    ? askSource(context, spec, account, target)
    : undefined
  const result = asked === undefined ? undefined : await asked
  if (result === undefined || result.outcome === 'customer_action_required') {
    return {
      outcome: 'person_must_act',
      managementReference: result?.managementReference ?? answer.managementReference
    }
  }
  const { current, delivery } = await context.refresher.refresh(account)
  await delivery
  const confirmed = spec.shows(target, locateRecord(current, recordRef))
  return { outcome: confirmed ? 'confirmed' : 'contradicted', snapshot: context.view(current) }
}
