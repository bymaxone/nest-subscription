/**
 * @fileoverview Pins the change key: the same inputs give the same key, every input counts, a
 * field's content cannot move the boundary to the next, and no input appears in the key.
 * @layer core
 */
import { changeKey } from './change-key'
import { rawChange } from './diff-rules/raw-change'

const ACCOUNT = 'a7:account'

describe('changeKey', () => {
  it('gives the same key for the same inputs', () => {
    // Scenario: the same change computed twice.
    const first = changeKey(ACCOUNT, rawChange('renewed', 'sub-1', '2026-03-01T00:00:00.000Z'))
    const second = changeKey(ACCOUNT, rawChange('renewed', 'sub-1', '2026-03-01T00:00:00.000Z'))
    expect(second).toBe(first)
  })

  it('gives 64 lowercase hexadecimal characters', () => {
    // Scenario: the key has a fixed width whatever the inputs hold.
    expect(changeKey(ACCOUNT, rawChange('renewed', 'sub-1', 'x'))).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([
    ['the account key', changeKey('other', rawChange('renewed', 'sub-1', 'f'))],
    ['the kind', changeKey(ACCOUNT, rawChange('expired', 'sub-1', 'f'))],
    ['the subscription', changeKey(ACCOUNT, rawChange('renewed', 'sub-2', 'f'))],
    ['a fact', changeKey(ACCOUNT, rawChange('renewed', 'sub-1', 'g'))],
    ['the number of facts', changeKey(ACCOUNT, rawChange('renewed', 'sub-1', 'f', ''))]
  ])('gives another key when %s differs', (_name, other) => {
    // Scenario: each input of the key is changed alone against the same base change.
    expect(other).not.toBe(changeKey(ACCOUNT, rawChange('renewed', 'sub-1', 'f')))
  })

  it('tells a change of the whole account from one of a subscription named like it', () => {
    // Scenario: a null subscription and a subscription whose reference is the word "none".
    expect(changeKey(ACCOUNT, rawChange('transferred', null, 'f'))).not.toBe(
      changeKey(ACCOUNT, rawChange('transferred', 'none', 'f'))
    )
  })

  it('keeps the boundary between two facts whatever their content', () => {
    // Scenario: moving a delimiter character from one fact to the next must change the key.
    expect(changeKey(ACCOUNT, rawChange('product_changed', 'sub-1', 'a:b', 'c'))).not.toBe(
      changeKey(ACCOUNT, rawChange('product_changed', 'sub-1', 'a', 'b:c'))
    )
  })

  it('keeps the boundary between the subscription and the first fact', () => {
    // Scenario: the same joined text split differently between the subscription and the facts.
    expect(changeKey(ACCOUNT, rawChange('renewed', 'a', 'b'))).not.toBe(
      changeKey(ACCOUNT, rawChange('renewed', 'a:b', ''))
    )
  })

  it('does not hold the account key, the subscription or a fact', () => {
    // Scenario: recognizable inputs must not be readable from the key.
    const key = changeKey('sentinel-account', rawChange('renewed', 'sentinel-sub', 'sentinel-fact'))
    expect(key).not.toMatch(/sentinel/)
  })

  it('tells a change of the whole account from a subscription whose reference is the word null', () => {
    // Scenario: the absent subscription must not read as the text "null".
    expect(changeKey(ACCOUNT, rawChange('transferred', null, 'f'))).not.toBe(
      changeKey(ACCOUNT, rawChange('transferred', 'null', 'f'))
    )
  })

  it.each([
    [
      'a subscription change',
      rawChange('renewed', 'sub-1', '2026-03-01T00:00:00.000Z'),
      '7294e4816a7b76e844308f1e02888ee8716b9efa815b00e40060b2e6e032af4d'
    ],
    [
      'an account change',
      rawChange('transferred', null, 'cust-2', 'a'),
      '8c6364fca81e2ee0d7971ddb4d18b7f441fe4e48ea466de606c5eac9c22ff1ad'
    ]
  ])('keeps the key of %s the same across versions', (_name, change, pinned) => {
    // Scenario: a host stores keys to make its reaction idempotent, so the construction (SHA-256
    // of each field, joined by a colon, hashed again) must not change; the digests are pinned.
    expect(changeKey(ACCOUNT, change)).toBe(pinned)
  })
})
