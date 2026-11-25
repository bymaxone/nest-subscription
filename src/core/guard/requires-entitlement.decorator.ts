/**
 * @fileoverview The route decorator that names the entitlement a route needs, and the one reader
 * of that name the guard uses. One name per decorator: combining entitlements is a product rule
 * the host writes.
 * @layer core
 */
import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'

import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

/** The metadata key the decorator writes and the guard reads. */
export const REQUIRED_ENTITLEMENT_KEY: unique symbol = Symbol('subscription:required-entitlement')

/** Whether a value is a usable entitlement name: a string with something in it. */
function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Marks a handler or a controller as needing an entitlement. On a handler it wins over a
 * controller's.
 *
 * @param entitlement The entitlement name the account must hold.
 * @returns A decorator usable on a method or a class.
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a blank or non-string name.
 */
export function RequiresEntitlement(entitlement: string): CustomDecorator<symbol> {
  if (!isName(entitlement)) throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  return SetMetadata(REQUIRED_ENTITLEMENT_KEY, entitlement)
}

/**
 * The entitlement the route of a context needs: the handler's name, else the controller's, else
 * `undefined` when the route names none.
 *
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` when something that is not a
 * usable name was stored under the key by other means.
 */
export function readRequiredEntitlement(
  reflector: Reflector,
  context: ExecutionContext
): string | undefined {
  const found = reflector.getAllAndOverride<unknown>(REQUIRED_ENTITLEMENT_KEY, [
    context.getHandler(),
    context.getClass()
  ])
  if (found === undefined) return undefined
  if (!isName(found)) throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  return found
}
