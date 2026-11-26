/**
 * @fileoverview Pins the sandbox filter for non-renewing purchases: a sandbox purchase gives no
 * access and grants nothing unless sandbox access is enabled, a production purchase is untouched
 * and no input is changed.
 * @layer revenuecat
 */
import type { NonRenewingPurchaseRecord } from '@bymax-one/nest-subscription/shared'

import { filterSandboxPurchases } from './sandbox-filter'

function held(reference: string, environment: 'production' | 'sandbox'): NonRenewingPurchaseRecord {
  return {
    purchaseReference: reference,
    entitlementNames: ['pro'],
    givesAccess: true,
    origin: 'app_store',
    environment,
    productReference: 'lifetime',
    purchasedAt: '2026-11-01T00:00:00.000Z',
    accessUntil: null,
    refundedAt: null
  }
}

describe('filterSandboxPurchases', () => {
  it('removes the access and the grants of a sandbox purchase and keeps the production purchase', () => {
    // Scenario: the default configuration; RevenueCat reports both as giving access.
    const given = [held('prod', 'production'), held('sbx', 'sandbox')]
    expect(filterSandboxPurchases(given, false)).toStrictEqual([
      held('prod', 'production'),
      { ...held('sbx', 'sandbox'), givesAccess: false, entitlementNames: [] }
    ])
  })

  it('returns the purchases as they are when sandbox access is enabled', () => {
    // Scenario: the host turned sandbox access on.
    const given = [held('sbx', 'sandbox')]
    expect(filterSandboxPurchases(given, true)).toBe(given)
  })

  it('changes none of the purchases it was given', () => {
    // Scenario: the filter is pure.
    const given = [held('sbx', 'sandbox')]
    const before = structuredClone(given)
    filterSandboxPurchases(given, false)
    expect(given).toStrictEqual(before)
  })
})
