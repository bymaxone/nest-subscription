/**
 * @fileoverview Type-level expectations for the snapshot model: a renamed or retyped field fails
 * to compile here.
 * @layer shared
 */
import type { SubscriptionChange } from './change.types'
import type {
  EntitlementState,
  SourceCustomerReference,
  SubscriptionRecord,
  SubscriptionSnapshot
} from './snapshot.types'

const record: SubscriptionRecord = {
  subscriptionReference: 'sub_1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'web',
  environment: 'production',
  productReference: 'pro',
  billingInterval: 'month',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: null,
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

const entitlement: EntitlementState = {
  name: 'pro',
  active: true,
  until: null,
  grantingSubscriptionReference: 'sub_1',
  grantingSubscriptionReferences: ['sub_1']
}

const customer: SourceCustomerReference = { id: 'cus_1' }

const snapshot: SubscriptionSnapshot = {
  accountId: 'acc_1',
  entitlements: [entitlement],
  subscriptions: [record],
  source: 'fake',
  sourceCustomer: customer,
  fetchedAt: '2026-01-15T00:00:00.000Z',
  sourceUpdatedAt: null
}

const change: SubscriptionChange = { kind: 'started', key: 'k' }

describe('snapshot model types', () => {
  it('lets a complete snapshot be built from the documented fields', () => {
    // Scenario: every documented field is set; omitting or renaming one fails to compile, and the
    // values read back are the ones written.
    expect(snapshot.subscriptions[0]).toBe(record)
    expect(snapshot.entitlements[0]).toBe(entitlement)
    expect(snapshot.sourceCustomer).toBe(customer)
    expect(snapshot.tenantId).toBeUndefined()
    expect(change).toEqual({ kind: 'started', key: 'k' })
  })

  it('keeps access in the flag, separate from the status', () => {
    // Scenario: a record can carry a status that reads as access-less with the flag set, so the
    // flag is data and not derived.
    const flagged: SubscriptionRecord = { ...record, status: 'unknown', givesAccess: true }
    expect(flagged.givesAccess).toBe(true)
    expect(flagged.status).toBe('unknown')
  })
})
