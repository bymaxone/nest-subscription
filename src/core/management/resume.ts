/**
 * @fileoverview Resume on the shared operation flow: the request goes to the source for a
 * subscription only, and the renewal counts as resumed only when the snapshot read back says the
 * subscription will renew (FR36, FR38). An adapter that does not implement it answers that the
 * person must act.
 * @layer core
 */
import type { AccountReference } from '@bymax-one/nest-subscription/internal'

import type { ResumeOutcome } from './management.types'
import {
  named,
  performOperation,
  type ManagementContext,
  type OperationSpec
} from './perform-operation'

/** The operation: one source call, and a read-back whose renewal intent is `yes`. */
export const RESUME: OperationSpec = {
  operation: 'resume',
  ask: (source, account, target) =>
    target.kind === 'subscription' ? source.resume?.(account, target.record) : undefined,
  shows: (_before, after) =>
    after !== undefined && after.kind === 'subscription' && after.record.willRenew === 'yes'
}

/**
 * Resumes the renewal of a subscription of the account.
 *
 * @param context The adapter, the store, the refresher and the view.
 * @param account The authenticated account.
 * @param recordRef The subscription's reference, found in the account's own snapshot only.
 * @throws {SubscriptionError} as {@link performOperation} does.
 */
export async function resume(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string
): Promise<ResumeOutcome> {
  return named(
    await performOperation(context, account, recordRef, RESUME),
    'resumed',
    'not_resumed'
  )
}
