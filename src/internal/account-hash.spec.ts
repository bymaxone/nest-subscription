/**
 * @fileoverview Pins the account hash: short, hexadecimal, stable for one key and salt, different
 * for another key or salt, defaulting to a salt that holds for the process, and never holding the
 * key it was made from.
 * @layer internal
 */
import { hashAccountKey } from './account-hash'

describe('hashAccountKey', () => {
  it('gives 12 lowercase hexadecimal characters', () => {
    // Scenario: the hash is short and fixed in width whatever the key.
    expect(hashAccountKey('a24:sentinel-account-key', 'salt')).toMatch(/^[0-9a-f]{12}$/)
  })

  it('gives the same hash for the same key and salt', () => {
    // Scenario: correlation needs the hash of one account to repeat.
    expect(hashAccountKey('key', 'salt')).toBe(hashAccountKey('key', 'salt'))
  })

  it('gives another hash for another key', () => {
    // Scenario: two accounts under one salt.
    expect(hashAccountKey('key-one', 'salt')).not.toBe(hashAccountKey('key-two', 'salt'))
  })

  it('gives another hash under another salt', () => {
    // Scenario: one account under two salts cannot be matched across them.
    expect(hashAccountKey('key', 'salt-one')).not.toBe(hashAccountKey('key', 'salt-two'))
  })

  it('uses one salt for the whole process when none is given', () => {
    // Scenario: two calls with no salt agree, so a log of one run correlates.
    expect(hashAccountKey('key')).toBe(hashAccountKey('key'))
  })

  it('does not use the empty string as its default salt', () => {
    // Scenario: the default salt is a real secret of the process, not an absent one.
    expect(hashAccountKey('key')).not.toBe(hashAccountKey('key', ''))
  })

  it('does not hold the key it was made from', () => {
    // Scenario: a recognizable key cannot be read from its hash.
    expect(hashAccountKey('sentinel-account', 'salt')).not.toMatch(/sentinel/)
  })

  it('matches the HMAC-SHA256 digest truncated to 12 characters', () => {
    // Scenario: a known vector fixes the construction: HMAC-SHA256 with the salt as the key.
    expect(hashAccountKey('key', 'salt')).toBe('95a47c9b4fdb')
  })
})
