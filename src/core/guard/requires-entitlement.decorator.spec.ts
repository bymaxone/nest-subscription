/**
 * @fileoverview Pins the route decorator: it stores one entitlement name under a symbol key on a
 * handler or a controller, the handler wins over the controller, and a blank name is refused when
 * the decorator is applied.
 * @layer core
 */
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import {
  REQUIRED_ENTITLEMENT_KEY,
  RequiresEntitlement,
  readRequiredEntitlement
} from './requires-entitlement.decorator'

/** A controller whose class names one entitlement and whose handlers name none, or another. */
@RequiresEntitlement('class-level')
class Guarded {
  inherits(): void {}

  @RequiresEntitlement('handler-level')
  overrides(): void {}
}

/** A controller with no decorator anywhere. */
class Bare {
  plain(): void {}
}

/** An execution context that names a handler and a controller class and nothing else. */
function contextOf(controller: new () => object, handler: () => void): ExecutionContext {
  const partial = { getHandler: () => handler, getClass: () => controller }
  return partial as unknown as ExecutionContext
}

describe('RequiresEntitlement', () => {
  const reflector = new Reflector()

  it('stores the name on a handler under a symbol key', () => {
    // Scenario: a handler decorated with a name is read back through the key, which is a Symbol.
    expect(typeof REQUIRED_ENTITLEMENT_KEY).toBe('symbol')
    expect(Reflect.getMetadata(REQUIRED_ENTITLEMENT_KEY, Guarded.prototype.overrides)).toBe(
      'handler-level'
    )
  })

  it('stores the name on a controller class', () => {
    // Scenario: a class decorated with a name carries it on the class itself.
    expect(Reflect.getMetadata(REQUIRED_ENTITLEMENT_KEY, Guarded)).toBe('class-level')
  })

  it('reads the controller name for a handler with none of its own', () => {
    // Scenario: a handler without its own name falls back to the controller's.
    const context = contextOf(Guarded, Guarded.prototype.inherits)
    expect(readRequiredEntitlement(reflector, context)).toBe('class-level')
  })

  it('reads the handler name over the controller name', () => {
    // Scenario: both levels name an entitlement and the handler's is the one returned.
    const context = contextOf(Guarded, Guarded.prototype.overrides)
    expect(readRequiredEntitlement(reflector, context)).toBe('handler-level')
  })

  it('reads nothing for a route that names no entitlement', () => {
    // Scenario: neither level is decorated, so the route is not one the guard protects.
    const context = contextOf(Bare, Bare.prototype.plain)
    expect(readRequiredEntitlement(reflector, context)).toBeUndefined()
  })

  it.each(['', '   ', '\t\n'])('refuses the blank name %j when applied', (name) => {
    // Scenario: an empty or whitespace-only name would protect a route with an entitlement nobody
    // holds, or none; the decorator refuses it with the invalid-input code before it is applied.
    expect(() => RequiresEntitlement(name)).toThrow(SubscriptionError)
    expect(() => RequiresEntitlement(name)).toThrow(
      expect.objectContaining({ code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT })
    )
  })

  it('refuses a name that is not a string when applied', () => {
    // Scenario: a plain JavaScript caller passes a number; it is refused like a blank name.
    const loose = RequiresEntitlement as (name: unknown) => unknown
    expect(() => loose(42)).toThrow(SubscriptionError)
  })

  it('refuses metadata another party stored under the key when it is read', () => {
    // Scenario: a value that is not a name reaches the key by other means; reading it throws, so
    // a guard built on it refuses rather than guessing what the route needs.
    class Tampered {
      handler(): void {}
    }
    Reflect.defineMetadata(REQUIRED_ENTITLEMENT_KEY, 7, Tampered.prototype.handler)
    const context = contextOf(Tampered, Tampered.prototype.handler)
    expect(() => readRequiredEntitlement(reflector, context)).toThrow(SubscriptionError)
  })

  it('refuses blank metadata stored under the key when it is read', () => {
    // Scenario: a blank string at the key is as unusable as a number.
    class Blank {
      handler(): void {}
    }
    Reflect.defineMetadata(REQUIRED_ENTITLEMENT_KEY, '  ', Blank.prototype.handler)
    const context = contextOf(Blank, Blank.prototype.handler)
    expect(() => readRequiredEntitlement(reflector, context)).toThrow(SubscriptionError)
  })
})
