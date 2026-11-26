/**
 * @fileoverview Stop renewal on the shared operation flow: the request goes to the source for a
 * subscription only, and the renewal counts as stopped only when the snapshot read back says the
 * subscription will not renew (FR36, FR38).
 * @layer core
 */
import type { AccountReference } from '@bymax-one/nest-subscription/internal'

import type { StopRenewalOutcome } from './management.types'
import {
  NOT_APPLICABLE,
  named,
  performOperation,
  type ManagementContext,
  type OperationSpec
} from './perform-operation'

/** The operation: one source call, and a read-back whose renewal intent is `no`. */
export const STOP_RENEWAL: OperationSpec = {
  operation: 'stop_renewal',
  applies: (_source, kind) => kind === 'subscription',
  ask: (source, account, target) =>
    target.kind === 'subscription' ? source.stopRenewal(account, target.record) : NOT_APPLICABLE,
  shows: (_before, after) =>
    after !== undefined && after.kind === 'subscription' && after.record.willRenew === 'no'
}

/**
 * Stops the renewal of a subscription of the account. Where a server cannot, the result says the
 * person must, with the management reference; where it can, the result is the snapshot read back.
 *
 * @param context The adapter, the store, the refresher and the view.
 * @param account The authenticated account.
 * @param recordRef The subscription's reference, found in the account's own snapshot only.
 * @throws {SubscriptionError} as {@link performOperation} does.
 */
export async function stopRenewal(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string
): Promise<StopRenewalOutcome> {
  return named(
    await performOperation(context, account, recordRef, STOP_RENEWAL),
    'stopped',
    'not_stopped'
  )
}
