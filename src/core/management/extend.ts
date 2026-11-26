/**
 * @fileoverview Extend on the shared operation flow. The extension is validated before anything is
 * read or asked, and it counts as made only when the snapshot read back shows the current period
 * ending later than it did (FR36, FR38). By how much is the source's to say, and is not checked.
 * @layer core
 */
import {
  SubscriptionError,
  type AccountReference,
  type ExtendReason,
  type ExtendRequest
} from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES, parseInstant } from '@bymax-one/nest-subscription/shared'

import type { ExtendOutcome } from './management.types'
import {
  named,
  performOperation,
  type ManagementContext,
  type OperationSpec
} from './perform-operation'

/** The reason codes a request may carry. */
const REASONS: readonly ExtendReason[] = [
  'undeclared',
  'customer_satisfaction',
  'other',
  'service_issue_or_outage'
]

/** Whether an extension is well formed: whole days, at least one, and a known reason or none. */
function isValid(extension: ExtendRequest): boolean {
  const { days, reason } = extension
  return (
    typeof days === 'number' &&
    Number.isSafeInteger(days) &&
    days >= 1 &&
    (reason === undefined || REASONS.includes(reason))
  )
}

/** The operation for one extension: one source call, and a read-back whose period ends later. */
export function extendSpec(extension: ExtendRequest): OperationSpec {
  return {
    operation: 'extend',
    ask: (source, account, target) =>
      target.kind === 'subscription'
        ? source.extend?.(account, target.record, extension)
        : undefined,
    shows: (before, after) =>
      before.kind === 'subscription' &&
      after?.kind === 'subscription' &&
      parseInstant(after.record.currentPeriodEnd) > parseInstant(before.record.currentPeriodEnd)
  }
}

/**
 * Extends the current period of a subscription of the account.
 *
 * @param context The adapter, the store, the refresher and the view.
 * @param account The authenticated account.
 * @param recordRef The subscription's reference, found in the account's own snapshot only.
 * @param extension The whole days to add and, where the origin asks for one, the reason.
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for an extension that is not well
 *   formed, before anything is asked; otherwise as {@link performOperation} does.
 */
export async function extend(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string,
  extension: ExtendRequest
): Promise<ExtendOutcome> {
  if (!isValid(extension)) throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  return named(
    await performOperation(context, account, recordRef, extendSpec({ ...extension })),
    'extended',
    'not_extended'
  )
}
