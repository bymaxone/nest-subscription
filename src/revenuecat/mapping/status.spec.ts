/**
 * @fileoverview Pins how a billing issue is mapped: the model status follows the source's own
 * access flag, and the table decides only when the source gave no flag.
 * @layer revenuecat
 */
import { mapStatus } from './status'

describe('mapStatus of a billing issue', () => {
  it.each([
    ['in_grace_period', true, 'in_grace'],
    ['in_grace_period', false, 'on_hold'],
    ['in_billing_retry', true, 'in_grace'],
    ['in_billing_retry', false, 'on_hold']
  ])('maps %s with gives_access %s to %s', (status, flag, expected) => {
    // Scenario: a billing issue is in grace when the source says access continues, and on hold
    // when it says access is suspended (FR14), whichever status name the source used.
    expect(mapStatus(status, flag)).toBe(expected)
  })

  it.each([
    ['in_grace_period', 'in_grace'],
    ['in_billing_retry', 'on_hold']
  ])('falls back to the table for %s when the flag is not a boolean', (status, expected) => {
    // Scenario: a response without the flag, or with a malformed one, uses the table's mapping.
    for (const flag of [undefined, null, 'true', 1]) {
      expect(mapStatus(status, flag)).toBe(expected)
    }
  })
})
