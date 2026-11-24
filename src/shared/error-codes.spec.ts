/**
 * @fileoverview Pins the error-code catalogue: closed, prefixed, unique and with one fixed message
 * per code.
 * @layer shared
 */
import { SUBSCRIPTION_ERROR_CODES, SUBSCRIPTION_ERROR_MESSAGES } from './error-codes'

describe('SUBSCRIPTION_ERROR_CODES', () => {
  const codes = Object.values(SUBSCRIPTION_ERROR_CODES)

  it('covers each case the specification names, and no other', () => {
    // Scenario: refused webhook, unknown account, entitlement required, no access, source
    // unavailable, operation not possible and the configuration errors, plus invalid input.
    expect(SUBSCRIPTION_ERROR_CODES).toEqual({
      WEBHOOK_REFUSED: 'SUBSCRIPTION_WEBHOOK_REFUSED',
      ACCOUNT_UNKNOWN: 'SUBSCRIPTION_ACCOUNT_UNKNOWN',
      ENTITLEMENT_REQUIRED: 'SUBSCRIPTION_ENTITLEMENT_REQUIRED',
      NO_ACCESS: 'SUBSCRIPTION_NO_ACCESS',
      SOURCE_UNAVAILABLE: 'SUBSCRIPTION_SOURCE_UNAVAILABLE',
      OPERATION_NOT_POSSIBLE: 'SUBSCRIPTION_OPERATION_NOT_POSSIBLE',
      CONFIG_MISSING: 'SUBSCRIPTION_CONFIG_MISSING',
      CONFIG_INVALID: 'SUBSCRIPTION_CONFIG_INVALID',
      INVALID_INPUT: 'SUBSCRIPTION_INVALID_INPUT'
    })
  })

  it('starts every code with the one prefix', () => {
    // Scenario: a code without the prefix could collide with a host's own codes.
    expect(codes.every((code) => code.startsWith('SUBSCRIPTION_'))).toBe(true)
  })

  it('gives no two entries the same value', () => {
    // Scenario: two names sharing a value would make a host's branch on the code ambiguous.
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('is frozen', () => {
    // Scenario: a host cannot add or replace a code for every other caller.
    expect(Object.isFrozen(SUBSCRIPTION_ERROR_CODES)).toBe(true)
  })
})

describe('SUBSCRIPTION_ERROR_MESSAGES', () => {
  it('holds one non-empty message for every code and for no other', () => {
    // Scenario: the message map is keyed by exactly the catalogue's values.
    const codes = Object.values(SUBSCRIPTION_ERROR_CODES).sort()
    expect(Object.keys(SUBSCRIPTION_ERROR_MESSAGES).sort()).toEqual(codes)
    for (const code of codes) {
      expect(SUBSCRIPTION_ERROR_MESSAGES[code].length).toBeGreaterThan(0)
    }
  })

  it('holds a different message for every code', () => {
    // Scenario: two codes sharing a message would hide which case a log line describes.
    const messages = Object.values(SUBSCRIPTION_ERROR_MESSAGES)
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('is frozen', () => {
    // Scenario: a host cannot rewrite a message for every other caller.
    expect(Object.isFrozen(SUBSCRIPTION_ERROR_MESSAGES)).toBe(true)
  })
})
