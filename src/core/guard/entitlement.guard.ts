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

import { ObserverBridge } from '../observer/observer-bridge'
import type { ResolvedSubscriptionOptions } from '../options/subscription-options.types'
import { isStale } from '../refresh/staleness'
import { SubscriptionService } from '../subscription.service'
import { hasTenant } from '../tenant'
import type { ResolvedAccount } from './account-resolver.types'
import { decideAccess } from './decide-access'
import { applyFailPolicy } from './fail-policy'
import { GuardRefusal, ResolverRefusal, fromResolver } from './guard-refusal'
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
    @Inject(SUBSCRIPTION_OPTIONS) private readonly options: GuardOptions,
    @Inject(ObserverBridge) private readonly observer: ObserverBridge
  ) {}

  /**
   * Whether the request may proceed.
   *
   * @throws {HttpException} 401 `SUBSCRIPTION_UNAUTHENTICATED` when no account is resolved, 403
   * `SUBSCRIPTION_ENTITLEMENT_REQUIRED` or `SUBSCRIPTION_NO_ACCESS` when the decision refuses,
   * and 503 `SUBSCRIPTION_SOURCE_UNAVAILABLE` for any failure the guard did not expect. The body
   * is `{ code, message }` and nothing else, except that an HTTP exception with a status from
   * 400 to 599 thrown by the host's resolver leaves unchanged.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.#decide(context)
    } catch (error) {
      throw this.#refused(error)
    }
  }

  /**
   * What to throw for an error of a decision, after the observer is told it was a refusal: the
   * guard's own refusal, the resolver's own HTTP exception, or, for anything else, a refusal as
   * unavailable.
   */
  #refused(error: unknown): unknown {
    if (error instanceof ResolverRefusal) {
      this.observer.guardDecision('refused', null)
      return error.exception
    }
    const refusal =
      error instanceof GuardRefusal
        ? error
        : new GuardRefusal(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    this.observer.guardDecision('refused', refusal.code)
    return refusal
  }

  /** The decision for a request; every refusal is thrown as a `GuardRefusal`. */
  async #decide(context: ExecutionContext): Promise<boolean> {
    const required = readRequiredEntitlement(this.reflector, context)
    if (required === undefined) return true
    if (context.getType() !== 'http') {
      throw new GuardRefusal(SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED)
    }
    const account = await this.#account(context)
    const read = await this.#read(account)
    // Read after the snapshot: an instant the clock gives that is not a finite date makes the
    // staleness test, the fail policy and the access decision all refuse.
    const now = this.options.clock.now()
    const usable = read !== null && !isStale(read, now, this.options.maxSnapshotAgeMs)
    return this.#verdict(usable ? read : this.#underFailure(read, now), required, now)
  }

  /** The snapshot the service answers with; `null` when the store could not be read. */
  async #read(account: AccountReference): Promise<SubscriptionSnapshot | null> {
    try {
      return await this.snapshots.getSnapshot(account)
    } catch {
      return null
    }
  }

  /**
   * The snapshot to decide on when the store could not be read or the stored snapshot is older
   * than the maximum age, which the guard does not wait for the source to refresh. Only the
   * fail policy can hand one back; otherwise the request is refused.
   */
  #underFailure(snapshot: SubscriptionSnapshot | null, now: Date): SubscriptionSnapshot {
    const outcome = applyFailPolicy({
      policy: this.options.failPolicy,
      toleranceMs: this.options.lastKnownStateToleranceMs,
      snapshot,
      now
    })
    if (!outcome.allow) throw new GuardRefusal(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    return outcome.snapshot
  }

  /** What the host's resolver answers; an HTTP refusal of its own is marked to pass through. */
  async #resolve(context: ExecutionContext): Promise<unknown> {
    try {
      return await this.options.accountResolver(context)
    } catch (error) {
      throw fromResolver(error)
    }
  }

  /** The account the host's resolver names, or a refusal as unauthenticated. */
  async #account(context: ExecutionContext): Promise<AccountReference> {
    const resolved = await this.#resolve(context)
    if (!isResolvedAccount(resolved)) {
      throw new GuardRefusal(SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED)
    }
    const { accountId, tenantId } = resolved
    if (this.options.multiTenant && !hasTenant(tenantId)) {
      throw new GuardRefusal(SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED)
    }
    return tenantId === undefined ? { accountId } : { accountId, tenantId }
  }

  /** `true` for an allowed decision; a refusal with the matching code otherwise. */
  #verdict(snapshot: SubscriptionSnapshot, required: string, now: Date): true {
    const decision = decideAccess(snapshot, required, now)
    if (decision === 'allow') {
      this.observer.guardDecision('allowed', null)
      return true
    }
    throw new GuardRefusal(
      decision === 'no_subscription'
        ? SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED
        : SUBSCRIPTION_ERROR_CODES.NO_ACCESS
    )
  }
}
