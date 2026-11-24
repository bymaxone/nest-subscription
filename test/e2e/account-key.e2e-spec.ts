/**
 * @fileoverview Exercises the account key through the root, the way a host reaches it.
 * @layer e2e
 */
import { SubscriptionError, encodeAccountKey } from '@bymax-one/nest-subscription'

describe('account key through the root', () => {
  it('keeps the pairs that a delimited join would merge apart', () => {
    // Scenario: ("a:b", "c") and ("a", "b:c") are one string under a colon join.
    const left = encodeAccountKey({ tenantId: 'a:b', accountId: 'c' })
    const right = encodeAccountKey({ tenantId: 'a', accountId: 'b:c' })
    expect(left).not.toBe(right)
  })

  it('keeps an account with no tenant apart from one with an empty tenant', () => {
    // Scenario: the absence of a tenant is not the empty string.
    expect(encodeAccountKey({ accountId: 'x' })).not.toBe(
      encodeAccountKey({ tenantId: '', accountId: 'x' })
    )
  })

  it('refuses a blank account with the library error', () => {
    // Scenario: a blank account identifier reaches the encoder.
    expect(() => encodeAccountKey({ accountId: ' ' })).toThrow(SubscriptionError)
  })
})
