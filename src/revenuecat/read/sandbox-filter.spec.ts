/**
 * @fileoverview Pins the sandbox filter: it removes access and grants of sandbox records unless the
 * host enabled sandbox access, leaves production records alone and changes no input.
 * @layer revenuecat
 */
import type { SubscriptionRecord } from '@bymax-one/nest-subscription/shared'

import { applySandboxFilter, type GrantedRecords } from './sandbox-filter'

function record(reference: string, environment: 'production' | 'sandbox'): SubscriptionRecord {
  return {
    subscriptionReference: reference,
    status: 'active',
    givesAccess: true,
    willRenew: 'yes',
    origin: 'other',
    environment,
    productReference: 'p',
    billingInterval: '',
    currentPeriodStart: '2026-11-01T00:00:00.000Z',
    currentPeriodEnd: '2026-12-01T00:00:00.000Z',
    accessUntil: '2026-12-01T00:00:00.000Z',
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: null
  }
}

function input(): GrantedRecords {
  return {
    records: [record('prod', 'production'), record('sbx', 'sandbox')],
    grants: new Map([
      ['prod', ['premium']],
      ['sbx', ['premium', 'extra']]
    ])
  }
}

describe('applySandboxFilter', () => {
  it('removes the access and the grants of a sandbox record and keeps the production record', () => {
    // Scenario: the default configuration; RevenueCat reports both as giving access.
    const result = applySandboxFilter(input(), false)
    expect(result.records.map((r) => [r.subscriptionReference, r.givesAccess])).toStrictEqual([
      ['prod', true],
      ['sbx', false]
    ])
    expect([...result.grants.entries()]).toStrictEqual([['prod', ['premium']]])
  })

  it('returns the input as it is when sandbox access is enabled', () => {
    // Scenario: the host turned sandbox access on; nothing is removed.
    const given = input()
    expect(applySandboxFilter(given, true)).toBe(given)
  })

  it('changes neither the records nor the grants it was given', () => {
    // Scenario: the filter is pure; a copy taken before is equal to the input after.
    const given = input()
    const before = structuredClone({ records: given.records, grants: [...given.grants] })
    applySandboxFilter(given, false)
    expect({ records: given.records, grants: [...given.grants] }).toStrictEqual(before)
  })

  it('keeps the rest of a sandbox record as it was', () => {
    // Scenario: only the access flag changes, so the host can still see the purchase.
    const result = applySandboxFilter(input(), false)
    expect(result.records[1]).toStrictEqual({ ...record('sbx', 'sandbox'), givesAccess: false })
  })
})
