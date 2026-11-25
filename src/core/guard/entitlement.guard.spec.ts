/**
 * @fileoverview Pins the guard against a stubbed service: a route without the decorator is left
 * alone, a request with no usable account is refused as unauthenticated before anything is read,
 * the three decisions map to their stable codes and statuses, a refusal body holds the code and
 * the message only, and every unexpected failure refuses.
 * @layer core
 */
import { HttpException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  type EntitlementState,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import { ManualClock } from '@bymax-one/nest-subscription/testing'

import type { AccountResolver } from './account-resolver.types'
import { EntitlementGuard, type GuardOptions, type GuardSnapshots } from './entitlement.guard'
import { REQUIRED_ENTITLEMENT_KEY, RequiresEntitlement } from './requires-entitlement.decorator'

const T0 = '2026-01-01T00:00:00.000Z'

/** A controller with one protected handler, one unprotected one and a class-level default. */
class Controller {
  @RequiresEntitlement('premium')
  protectedHandler(): void {}

  openHandler(): void {}
}

/** An execution context of the given type for one handler of `Controller`. */
function contextOf(handler: () => void, type: string = 'http'): ExecutionContext {
  const partial = { getHandler: () => handler, getClass: () => Controller, getType: () => type }
  return partial as unknown as ExecutionContext
}

/** A snapshot of `acc-1` holding the given entitlements, fetched now. */
function snapshotWith(...entitlements: EntitlementState[]): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'acc-1', source: 'fake', fetchedAt: T0 }),
    entitlements
  }
}

/** The held `premium` entitlement, unless another end is given. */
function premium(active = true, until: string | null = null): EntitlementState {
  return { name: 'premium', active, until, grantingSubscriptionReference: active ? 'sub-1' : null }
}

/** What a test arranges: the resolver, the service and the options, built into one guard. */
interface Rig {
  readonly guard: EntitlementGuard
  readonly clock: ManualClock
  readonly resolver: jest.Mock
  readonly getSnapshot: jest.Mock
}

/** Builds a guard whose resolver and service are mocks answering as given. */
function rig(
  resolved: unknown,
  snapshot: SubscriptionSnapshot | Error = snapshotWith(),
  options: Partial<GuardOptions> = {}
): Rig {
  const clock = new ManualClock(T0)
  const resolver = jest.fn((_context: ExecutionContext): unknown => resolved)
  const getSnapshot = jest.fn((): Promise<SubscriptionSnapshot> => {
    return snapshot instanceof Error ? Promise.reject(snapshot) : Promise.resolve(snapshot)
  })
  const snapshots: GuardSnapshots = { getSnapshot }
  const full: GuardOptions = {
    accountResolver: resolver as AccountResolver,
    multiTenant: false,
    failPolicy: 'refuse',
    lastKnownStateToleranceMs: 24 * 3_600_000,
    maxSnapshotAgeMs: 24 * 3_600_000,
    clock,
    ...options
  }
  return {
    guard: new EntitlementGuard(new Reflector(), snapshots, full),
    clock,
    resolver,
    getSnapshot
  }
}

/** Runs the guard on the protected handler and returns what it threw, or `true`/`false`. */
async function outcome(guard: EntitlementGuard, context?: ExecutionContext): Promise<unknown> {
  try {
    return await guard.canActivate(context ?? contextOf(Controller.prototype.protectedHandler))
  } catch (error) {
    return error
  }
}

/** Asserts a refusal with the status and the catalogue code, and a body of exactly those. */
function expectRefusal(result: unknown, status: number, code: string): void {
  expect(result).toBeInstanceOf(HttpException)
  const refusal = result as HttpException
  expect(refusal.getStatus()).toBe(status)
  expect(refusal.getResponse()).toEqual(
    new SubscriptionError(code as SubscriptionError['code']).toJSON()
  )
}

describe('EntitlementGuard', () => {
  describe('a route without the decorator', () => {
    it('is allowed without resolving an account or reading a snapshot', async () => {
      // Scenario: the handler names no entitlement; the guard returns true and calls neither the
      // resolver nor the service, so a global guard costs an unprotected route nothing.
      const { guard, resolver, getSnapshot } = rig(null)
      await expect(guard.canActivate(contextOf(Controller.prototype.openHandler))).resolves.toBe(
        true
      )
      expect(resolver).not.toHaveBeenCalled()
      expect(getSnapshot).not.toHaveBeenCalled()
    })
  })

  describe('a request with no usable account', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'acc-1'],
      ['a number', 42],
      ['an empty object', {}],
      ['an empty identifier', { accountId: '' }],
      ['a blank identifier', { accountId: '   ' }],
      ['a numeric identifier', { accountId: 7 }],
      ['a numeric tenant', { accountId: 'acc-1', tenantId: 3 }],
      ['a blank tenant', { accountId: 'acc-1', tenantId: '  ' }],
      ['a null tenant', { accountId: 'acc-1', tenantId: null }]
    ])('is refused as unauthenticated for %s', async (_title, resolved) => {
      // Scenario: the resolver answers with something that is not an account; the guard answers
      // 401 with the catalogue's account code before the service is asked anything.
      const { guard, getSnapshot } = rig(resolved, snapshotWith(premium()))
      expectRefusal(await outcome(guard), 401, SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
      expect(getSnapshot).not.toHaveBeenCalled()
    })

    it('is refused as unauthenticated when the resolver answers with a promise of null', async () => {
      // Scenario: the resolver is asynchronous and finds no account.
      const { guard } = rig(Promise.resolve(null), snapshotWith(premium()))
      expectRefusal(await outcome(guard), 401, SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
    })

    it('is refused as unauthenticated when a multi-tenant host resolves no tenant', async () => {
      // Scenario: the host is multi-tenant and the resolver names an account without a tenant;
      // the guard does not guess a tenant and does not let the service throw for it.
      const { guard, getSnapshot } = rig({ accountId: 'acc-1' }, snapshotWith(premium()), {
        multiTenant: true
      })
      expectRefusal(await outcome(guard), 401, SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
      expect(getSnapshot).not.toHaveBeenCalled()
    })

    it('is refused as unauthenticated outside an HTTP context, without calling the resolver', async () => {
      // Scenario: a protected handler is reached through another transport; the guard resolves
      // nothing there and refuses.
      const { guard, resolver } = rig({ accountId: 'acc-1' }, snapshotWith(premium()))
      const result = await outcome(guard, contextOf(Controller.prototype.protectedHandler, 'rpc'))
      expectRefusal(result, 401, SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
      expect(resolver).not.toHaveBeenCalled()
    })
  })

  describe('a request with an account', () => {
    it('is allowed when the entitlement is held', async () => {
      // Scenario: the snapshot holds `premium` with no end.
      const { guard } = rig({ accountId: 'acc-1' }, snapshotWith(premium()))
      expect(await outcome(guard)).toBe(true)
    })

    it('asks the service for exactly the account and tenant the resolver named', async () => {
      // Scenario: the resolver result carries extra properties; only the account and the tenant
      // reach the service, so nothing else of the result decides what is read.
      const resolved = { accountId: 'acc-1', tenantId: 't-1', role: 'admin' }
      const { guard, getSnapshot } = rig(resolved, snapshotWith(premium()), { multiTenant: true })
      expect(await outcome(guard)).toBe(true)
      expect(getSnapshot).toHaveBeenCalledTimes(1)
      expect(getSnapshot).toHaveBeenCalledWith({ accountId: 'acc-1', tenantId: 't-1' })
    })

    it('passes an account without a tenant property when the resolver named no tenant', async () => {
      // Scenario: a single-tenant resolver answers with an identifier only; the service gets an
      // object with exactly that one property, not one carrying an undefined tenant.
      const { guard, getSnapshot } = rig({ accountId: 'acc-1' }, snapshotWith(premium()))
      expect(await outcome(guard)).toBe(true)
      expect(getSnapshot.mock.calls).toStrictEqual([[{ accountId: 'acc-1' }]])
    })

    it('hands the resolver the execution context of the request', async () => {
      // Scenario: the resolver is the host's way to reach the request, so it gets the context.
      const { guard, resolver } = rig({ accountId: 'acc-1' }, snapshotWith(premium()))
      const context = contextOf(Controller.prototype.protectedHandler)
      await outcome(guard, context)
      expect(resolver).toHaveBeenCalledWith(context)
    })

    it('is refused as entitlement required when the account has no such entitlement', async () => {
      // Scenario: an account with nothing stored; 403 with the "required" code, which is not the
      // "gives no access" code.
      const { guard } = rig({ accountId: 'acc-1' }, snapshotWith())
      expectRefusal(await outcome(guard), 403, SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED)
    })

    it('is refused as no access when a subscription grants it and gives no access', async () => {
      // Scenario: the entitlement is listed and inactive, for example on hold; 403 with the
      // "gives no access" code.
      const { guard } = rig({ accountId: 'acc-1' }, snapshotWith(premium(false)))
      expectRefusal(await outcome(guard), 403, SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
    })

    it('decides by the injected clock: held before the end instant, refused from it on', async () => {
      // Scenario: `until` is one minute after the clock's now; the same snapshot allows, then
      // refuses once the manual clock reaches the end. Only the clock moves.
      const until = '2026-01-01T00:01:00.000Z'
      const { guard, clock } = rig({ accountId: 'acc-1' }, snapshotWith(premium(true, until)))
      expect(await outcome(guard)).toBe(true)
      clock.set(until)
      expectRefusal(await outcome(guard), 403, SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
    })

    it('never puts an identifier in the body of a refusal', async () => {
      // Scenario: both 403 refusals and the 401, serialized: none holds the account, the tenant or
      // the entitlement name.
      const secretive = { accountId: 'acc-secret-9', tenantId: 'tenant-secret-9' }
      const held = snapshotWith(premium(false))
      const bodies = await Promise.all([
        outcome(rig(secretive, held, { multiTenant: true }).guard),
        outcome(rig(secretive, snapshotWith(), { multiTenant: true }).guard),
        outcome(rig(null).guard)
      ])
      for (const refusal of bodies) {
        const text = JSON.stringify((refusal as HttpException).getResponse())
        expect(text).not.toMatch(/secret-9|premium/)
        expect(Object.keys((refusal as HttpException).getResponse())).toEqual(['code', 'message'])
      }
    })
  })

  describe('an unexpected failure', () => {
    it.each([
      [
        'a resolver that throws',
        (): never => {
          throw new Error('resolver broke')
        }
      ],
      [
        'a resolver that rejects',
        (): Promise<never> => Promise.reject(new Error('resolver broke'))
      ],
      [
        'a resolver that throws an HTTP exception of its own',
        (): never => {
          throw new HttpException({ detail: 'acc-secret-9 is banned' }, 418)
        }
      ]
    ])('refuses as source unavailable for %s', async (_title, resolver) => {
      // Scenario: whatever the resolver throws, the guard answers 503 with the catalogue body; the
      // host's own exception and its detail never reach the response.
      const { guard, getSnapshot } = rig(null, snapshotWith(premium()), {
        accountResolver: resolver
      })
      const result = await outcome(guard)
      expectRefusal(result, 503, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
      expect(JSON.stringify((result as HttpException).getResponse())).not.toMatch(/secret-9/)
      expect(getSnapshot).not.toHaveBeenCalled()
    })

    it('refuses as source unavailable when the service throws', async () => {
      // Scenario: the read of the snapshot fails; the guard does not allow and does not leak the error.
      const { guard } = rig({ accountId: 'acc-1' }, new Error('store exploded with acc-secret-9'))
      const result = await outcome(guard)
      expectRefusal(result, 503, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    })

    it('refuses as source unavailable when the metadata under the key is not a name', async () => {
      // Scenario: something that is not an entitlement name sits at the decorator's key; the
      // guard cannot know what the route needs and refuses.
      class Odd {
        handler(): void {}
      }
      Reflect.defineMetadata(REQUIRED_ENTITLEMENT_KEY, 7, Odd.prototype.handler)
      const { guard, resolver } = rig({ accountId: 'acc-1' }, snapshotWith(premium()))
      const partial = {
        getHandler: () => Odd.prototype.handler,
        getClass: () => Odd,
        getType: () => 'http'
      }
      const result = await outcome(guard, partial as unknown as ExecutionContext)
      expectRefusal(result, 503, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
      expect(resolver).not.toHaveBeenCalled()
    })
  })
})
