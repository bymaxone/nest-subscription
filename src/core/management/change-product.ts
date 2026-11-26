/**
 * @fileoverview Change product on the shared operation flow. The target product is validated as a
 * non-blank string before anything is read or asked, and the change counts as made only when the
 * snapshot read back shows the subscription on that product (FR36, FR38).
 * @layer core
 */
import { SubscriptionError, type AccountReference } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import type { ChangeProductOutcome } from './management.types'
import {
  named,
  performOperation,
  type ManagementContext,
  type OperationSpec
} from './perform-operation'

/** The operation for one target product: one source call, and a read-back on that product. */
export function changeProductSpec(productReference: string): OperationSpec {
  return {
    operation: 'change_product',
    ask: (source, account, target) =>
      target.kind === 'subscription'
        ? source.changeProduct?.(account, target.record, productReference)
        : undefined,
    shows: (_before, after) => after?.record.productReference === productReference
  }
}

/**
 * Changes the product of a subscription of the account.
 *
 * @param context The adapter, the store, the refresher and the view.
 * @param account The authenticated account.
 * @param recordRef The subscription's reference, found in the account's own snapshot only.
 * @param productReference The product to change to, as the source names it.
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a product that is not a
 *   non-blank string, before anything is asked; otherwise as {@link performOperation} does.
 */
export async function changeProduct(
  context: ManagementContext,
  account: AccountReference,
  recordRef: string,
  productReference: string
): Promise<ChangeProductOutcome> {
  if (typeof productReference !== 'string' || productReference.trim().length === 0) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  }
  return named(
    await performOperation(context, account, recordRef, changeProductSpec(productReference)),
    'product_changed',
    'product_not_changed'
  )
}
