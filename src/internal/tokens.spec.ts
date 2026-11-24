/**
 * @fileoverview Pins the injection tokens: each is a distinct symbol described by its own name.
 * @layer internal
 */
import * as tokens from './tokens'

describe('injection tokens', () => {
  const entries = Object.entries(tokens)

  it('holds exactly the six tokens of the module', () => {
    // Scenario: a token added or renamed without its own test would show here.
    expect(entries.map(([name]) => name).sort()).toEqual([
      'SUBSCRIPTION_CACHE',
      'SUBSCRIPTION_CLOCK',
      'SUBSCRIPTION_OBSERVER',
      'SUBSCRIPTION_OPTIONS',
      'SUBSCRIPTION_SOURCE',
      'SUBSCRIPTION_STORE'
    ])
  })

  it.each(entries)('%s is a symbol described by its own name', (name, token) => {
    // Scenario: a symbol with a description reads clearly in a Nest resolution error.
    expect(typeof token).toBe('symbol')
    expect((token as symbol).description).toBe(name)
  })

  it('gives no two tokens the same symbol', () => {
    // Scenario: two tokens sharing a value would resolve one provider for both.
    expect(new Set(entries.map(([, token]) => token)).size).toBe(entries.length)
  })
})
