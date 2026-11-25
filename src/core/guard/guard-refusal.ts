/**
 * @fileoverview The one exception the guard throws: an HTTP exception whose body is the catalogue's
 * code and fixed message and nothing else. The status of each refusal is fixed here, so a client
 * can branch on both.
 * @layer core
 */
import { HttpException } from '@nestjs/common'

import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

/** A code the guard can refuse with. */
export type GuardRefusalCode =
  | typeof SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED
  | typeof SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED
  | typeof SUBSCRIPTION_ERROR_CODES.NO_ACCESS
  | typeof SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE

/** The HTTP status a refusal with the code is answered with. */
function statusOf(code: GuardRefusalCode): number {
  switch (code) {
    case SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED:
      return 401
    case SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE:
      return 503
    default:
      return 403
  }
}

/** Whether an error is an HTTP exception with a status a host can mean as a refusal: 400 to 599. */
function isHostRefusal(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false
  const status = error.getStatus()
  return Number.isInteger(status) && status >= 400 && status <= 599
}

/** An HTTP exception of the host's resolver that leaves the guard unchanged. */
export class ResolverRefusal {
  /** @param exception The exception the resolver threw or rejected with. */
  constructor(readonly exception: HttpException) {}
}

/**
 * What to throw for an error of the host's resolver: a {@link ResolverRefusal} for an HTTP
 * exception with a status from 400 to 599, and the error itself for anything else.
 */
export function fromResolver(error: unknown): unknown {
  return isHostRefusal(error) ? new ResolverRefusal(error) : error
}

/**
 * A refusal by the guard. Its response is `{ code, message }` taken from the catalogue: no
 * account, tenant, entitlement name or error text of the host can reach it.
 */
export class GuardRefusal extends HttpException {
  /** @param code The catalogue code the refusal carries; its status is fixed. */
  constructor(code: GuardRefusalCode) {
    super(new SubscriptionError(code).toJSON(), statusOf(code))
  }
}
