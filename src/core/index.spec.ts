/**
 * @fileoverview Pins the names the `core` entry point exports.
 * @layer core
 */
import * as internal from '@bymax-one/nest-subscription/internal'
import { resolveEntitlements } from '@bymax-one/nest-subscription/shared'
import * as entry from './index'
import { resolveOptions } from './options/resolve-options'
import { validateOptions } from './options/validate-options'
import { SubscriptionModule } from './subscription.module'
import { EntitlementGuard } from './guard/entitlement.guard'
import { RequiresEntitlement } from './guard/requires-entitlement.decorator'
import { SubscriptionService } from './subscription.service'
import { diffSnapshots } from './notifications/diff-snapshots'
import { toHttpAnswer } from './webhook/webhook-outcome'
import { WebhookProcessor } from './webhook/webhook.processor'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

describe('core entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case.
    expect(Object.keys(entry).sort()).toEqual([
      'EntitlementGuard',
      'RequiresEntitlement',
      'SECRET_PLACEHOLDER',
      'SUBSCRIPTION_CACHE',
      'SUBSCRIPTION_CLOCK',
      'SUBSCRIPTION_ERROR_CODES',
      'SUBSCRIPTION_OBSERVER',
      'SUBSCRIPTION_OPTIONS',
      'SUBSCRIPTION_SOURCE',
      'SUBSCRIPTION_STORE',
      'Secret',
      'SubscriptionError',
      'SubscriptionModule',
      'SubscriptionService',
      'WebhookProcessor',
      'decodeAccountKey',
      'diffSnapshots',
      'encodeAccountKey',
      'hashAccountKey',
      'resolveOptions',
      'toHttpAnswer',
      'validateOptions'
    ])
  })

  it('re-exports the values of their origin, not copies', () => {
    // Scenario: each name the root takes from the internal bundle or from `shared` is the very
    // value of its origin, so one constructor and one set of symbols serve every entry point.
    expect(entry.SUBSCRIPTION_ERROR_CODES).toBe(SUBSCRIPTION_ERROR_CODES)
    expect(entry.resolveOptions).toBe(resolveOptions)
    expect(entry.validateOptions).toBe(validateOptions)
    expect(entry.SubscriptionModule).toBe(SubscriptionModule)
    expect(entry.SubscriptionService).toBe(SubscriptionService)
    expect(entry.RequiresEntitlement).toBe(RequiresEntitlement)
    expect(entry.EntitlementGuard).toBe(EntitlementGuard)
    expect(entry.diffSnapshots).toBe(diffSnapshots)
    expect(entry.WebhookProcessor).toBe(WebhookProcessor)
    expect(entry.toHttpAnswer).toBe(toHttpAnswer)
    for (const [name, value] of Object.entries(internal)) {
      expect(entry[name as keyof typeof entry]).toBe(value)
    }
  })

  it('raises one error class from the model, the internal bundle and the root', () => {
    // Scenario: the model refuses an invalid instant; the error is an instance of the class the
    // root exports and of the class the internal bundle exports, which are one class.
    const subscription = {
      subscriptionReference: 's1',
      status: 'active',
      givesAccess: true,
      willRenew: 'yes',
      origin: 'web',
      environment: 'production',
      productReference: 'pro',
      billingInterval: 'month',
      currentPeriodStart: '2026-01-01T00:00:00.000Z',
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
      accessUntil: 'not a date',
      billingIssueSince: null,
      cancelledAt: null,
      refundedAt: null,
      managementReference: null
    } as const
    let failure: unknown
    try {
      resolveEntitlements([subscription], new Map([['s1', ['pro']]]))
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(entry.SubscriptionError)
    expect(failure).toBeInstanceOf(internal.SubscriptionError)
    expect(entry.SubscriptionError).toBe(internal.SubscriptionError)
  })
})
