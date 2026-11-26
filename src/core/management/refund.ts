/**
 * @fileoverview Refund on the shared operation flow, for a subscription or a non-renewing purchase
 * found in the account's own snapshot. A refund counts as made only when the snapshot read back
 * shows a refund instant, or access that was given before and no longer is (FR36, FR38).
 * @layer core
 */
import type { AccountReference } from '@bymax-one/nest-subscription/internal'

import type { RefundOutcome } from './management.types'
import {
  named,
  performOperation,
  type ManagementContext,
  type OperationSpec
} from './perform-operation'

/** The operation: one source call, and a read-back that shows the refund. */
export const REFUND: OperationSpec = {
  operation: 'refund',
  ask: (source, account, target) => source.refund?.(account, target),
  shows: (before, after) =>
    after !== undefined &&
    (after.record.refundedAt !== null || (before.record.givesAccess && !after.record.givesAccess))
}

/**
 * Refunds a subscription or a non-renewing purchase of the account.
 *
 * @param context The adapter, the store, the refresher and the view.
 * @param account The authenticated account.
 * @param recordRef The record's reference, found in the account's own snapshot only.
 * @throws {SubscriptionError} as {@link performOperation} does.
 */
export async function refund(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string
): Promise<RefundOutcome> {
  return named(
    await performOperation(context, account, recordRef, REFUND),
    'refunded',
    'not_refunded'
  )
}
