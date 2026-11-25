/**
 * @fileoverview The guard that enforces `RequiresEntitlement`. It takes the account from the
 * host's resolver only, reads the snapshot through the service, and decides with the pure
 * `decideAccess`. Refusal is the default: whatever is not an allowed decision, including every
 * unexpected failure, is a refusal with a catalogue code and no detail of any account.
 * @layer core
 */
import type { CanActivate } from '@nestjs/common'
import { Inject, Injectable, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { SUBSCRIPTION_OPTIONS, type AccountReference } from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import type { ResolvedSubscriptionOptions } from '../options/subscription-options.types'
import { SubscriptionService } from '../subscription.service'
import { hasTenant } from '../tenant'
import type { ResolvedAccount } from './account-resolver.types'
import { decideAccess } from './decide-access'
import { GuardRefusal } from './guard-refusal'
import { readRequiredEntitlement } from './requires-entitlement.decorator'

/** The options the guard reads. */
export type GuardOptions = Pick<
  ResolvedSubscriptionOptions,
  | 'accountResolver'
  | 'multiTenant'
  | 'failPolicy'
  | 'lastKnownStateToleranceMs'
  | 'maxSnapshotAgeMs'
  | 'clock'
>

/** The one thing the guard needs of the service: the snapshot of an account. */
export interface GuardSnapshots {
  /** The snapshot of an account, as `SubscriptionService.getSnapshot` answers it. */
  getSnapshot(account: AccountReference): Promise<SubscriptionSnapshot>
}

/** Whether a value is a non-blank string. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Whether a resolver's answer is an account: an identifier and, when present, a tenant. */
function isResolvedAccount(value: unknown): value is ResolvedAccount {
  if (typeof value !== 'object' || value === null) return false
  const tenantId: unknown = Reflect.get(value, 'tenantId')
  return isFilled(Reflect.get(value, 'accountId')) && (tenantId === undefined || isFilled(tenantId))
}

/**
 * Protects the routes that carry `RequiresEntitlement`. Register it with `@UseGuards` or as an
 * `APP_GUARD`; the module of the route must import `SubscriptionModule`. A route without the
 * decorator is not touched.
 *
 * The guard works for HTTP contexts. For any other context type a decorated route is refused
 * as unauthenticated and the resolver is not called.
 *
 * The decision never waits for the billing source: it reads the snapshot through the service,
 * which answers from the store and starts a refresh of a stale snapshot in the background.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SubscriptionService) private readonly snapshots: GuardSnapshots,
    @Inject(SUBSCRIPTION_OPTIONS) private readonly options: GuardOptions
  ) {}

  /**
   * Whether the request may proceed.
   *
   * @throws {HttpException} 401 `SUBSCRIPTION_ACCOUNT_UNKNOWN` when no account is resolved, 403
   * `SUBSCRIPTION_ENTITLEMENT_REQUIRED` or `SUBSCRIPTION_NO_ACCESS` when the decision refuses,
   * and 503 `SUBSCRIPTION_SOURCE_UNAVAILABLE` for any failure the guard did not expect. The body
   * is `{ code, message }` and nothing else.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.#decide(context)
    } catch (error) {
      throw error instanceof GuardRefusal
        ? error
        : new GuardRefusal(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    }
  }

  /** The decision for a request; every refusal is thrown as a `GuardRefusal`. */
  async #decide(context: ExecutionContext): Promise<boolean> {
    const required = readRequiredEntitlement(this.reflector, context)
    if (required === undefined) return true
    if (context.getType() !== 'http') {
      throw new GuardRefusal(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
    }
    const account = await this.#account(context)
    const snapshot = await this.snapshots.getSnapshot(account)
    return this.#verdict(snapshot, required)
  }

  /** The account the host's resolver names, or a refusal as unauthenticated. */
  async #account(context: ExecutionContext): Promise<AccountReference> {
    const resolved: unknown = await this.options.accountResolver(context)
    if (!isResolvedAccount(resolved)) {
      throw new GuardRefusal(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
    }
    const { accountId, tenantId } = resolved
    if (this.options.multiTenant && !hasTenant(tenantId)) {
      throw new GuardRefusal(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
    }
    return tenantId === undefined ? { accountId } : { accountId, tenantId }
  }

  /** `true` for an allowed decision; a refusal with the matching code otherwise. */
  #verdict(snapshot: SubscriptionSnapshot, required: string): true {
    const decision = decideAccess(snapshot, required, this.options.clock.now())
    if (decision === 'allow') return true
    throw new GuardRefusal(
      decision === 'no_subscription'
        ? SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED
        : SUBSCRIPTION_ERROR_CODES.NO_ACCESS
    )
  }
}
