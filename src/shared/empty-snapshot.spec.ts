/**
 * @fileoverview Pins the snapshot of an account the source does not know.
 * @layer shared
 */
import { createEmptySnapshot } from './empty-snapshot'

describe('createEmptySnapshot', () => {
  it('returns no entitlements and no subscriptions for an unknown account', () => {
    // Scenario: the source has no record of the account; the result is a value a host can read.
    const snapshot = createEmptySnapshot({
      accountId: 'acc_1',
      source: 'fake',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(snapshot).toEqual({
      accountId: 'acc_1',
      entitlements: [],
      subscriptions: [],
      source: 'fake',
      sourceCustomer: null,
      fetchedAt: '2026-01-01T00:00:00.000Z',
      sourceUpdatedAt: null
    })
  })

  it('carries the tenant when one is given', () => {
    // Scenario: a multi-tenant host asks for an unknown account of one tenant.
    const snapshot = createEmptySnapshot({
      accountId: 'acc_1',
      tenantId: 'tenant_1',
      source: 'fake',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(snapshot.tenantId).toBe('tenant_1')
  })

  it('leaves the tenant key out when none is given', () => {
    // Scenario: a single-tenant host; the key is absent, not present as undefined.
    const snapshot = createEmptySnapshot({
      accountId: 'acc_1',
      source: 'fake',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    })
    expect('tenantId' in snapshot).toBe(false)
  })

  it('returns a new value on every call', () => {
    // Scenario: a caller that mutates one result cannot change another; the lists are not shared.
    const input = { accountId: 'a', source: 's', fetchedAt: '2026-01-01T00:00:00.000Z' }
    const first = createEmptySnapshot(input)
    const second = createEmptySnapshot(input)
    expect(first).not.toBe(second)
    expect(first.entitlements).not.toBe(second.entitlements)
    expect(first.subscriptions).not.toBe(second.subscriptions)
  })
})
