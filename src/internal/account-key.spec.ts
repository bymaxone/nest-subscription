/**
 * @fileoverview Pins that `encodeAccountKey` is injective over (tenant, account) pairs, including
 * pairs whose text holds the delimiter, an empty tenant and unicode, and that a blank account is
 * refused.
 * @layer internal
 */
import { SubscriptionError } from './subscription.error'
import { encodeAccountKey } from './account-key'

/** Every string of up to two characters over an alphabet chosen to hurt a naive join. */
function strings(): string[] {
  const alphabet = [':', 't', 'a', '1', 'é', '😀', '\ud800']
  const out = ['']
  for (const first of alphabet) {
    out.push(first)
    for (const second of alphabet) out.push(first + second)
  }
  return out
}

/** All (tenant, account) pairs over those strings; the tenant may be absent, the account is not blank. */
function pairs(): Array<{ tenantId: string | undefined; accountId: string }> {
  const all = strings()
  const tenants: Array<string | undefined> = [undefined, ...all]
  return tenants.flatMap((tenantId) =>
    all.filter((id) => id !== '').map((accountId) => ({ tenantId, accountId }))
  )
}

describe('encodeAccountKey', () => {
  it('writes each field with its length so the boundary is readable', () => {
    // Scenario: a pair with a tenant, and one without, pin the exact construction.
    expect(encodeAccountKey({ tenantId: 'acme', accountId: 'acc_1' })).toBe('t4:acme:a5:acc_1')
    expect(encodeAccountKey({ accountId: 'acc_1' })).toBe('a5:acc_1')
  })

  it.each([
    [
      { tenantId: 'a:b', accountId: 'c' },
      { tenantId: 'a', accountId: 'b:c' }
    ],
    [
      { tenantId: 'a', accountId: 'b' },
      { tenantId: 'a:b', accountId: 'b' }
    ],
    [
      { tenantId: undefined, accountId: 'x' },
      { tenantId: '', accountId: 'x' }
    ],
    [
      { tenantId: undefined, accountId: 't1:a:a1:x' },
      { tenantId: 'a', accountId: 'x' }
    ],
    [
      { tenantId: '1:a', accountId: 'b' },
      { tenantId: '1', accountId: 'a:b' }
    ],
    [
      { tenantId: 'é', accountId: 'a' },
      { tenantId: 'e', accountId: 'a' }
    ]
  ])('gives two different pairs different keys: %j against %j', (left, right) => {
    // Scenario: the known collision shapes of a delimited join, a missing tenant against an empty
    // one, and a field that imitates the encoding of another.
    expect(encodeAccountKey(left)).not.toBe(encodeAccountKey(right))
  })

  it('gives every pair of a generated set a key no other pair has', () => {
    // Scenario: every pair over strings that hold the delimiter, the markers, digits, accents,
    // an astral character and a lone surrogate; a key shared by two pairs fails the case.
    const seen = new Map<string, string>()
    for (const pair of pairs()) {
      const key = encodeAccountKey(pair)
      const identity = JSON.stringify([
        pair.tenantId ?? null,
        pair.accountId,
        pair.tenantId === undefined
      ])
      expect(seen.get(key) ?? identity).toBe(identity)
      seen.set(key, identity)
    }
    expect(seen.size).toBe(pairs().length)
  })

  it('would be caught by this set if it joined with a delimiter', () => {
    // Scenario: the same set run through a naive join collides, so the property above can fail.
    const naive = new Set(
      pairs().map(({ tenantId, accountId }) => `${tenantId ?? ''}:${accountId}`)
    )
    expect(naive.size).toBeLessThan(pairs().length)
  })

  it.each(['', ' ', '\t\n '])(
    'refuses the blank account %j with a SubscriptionError',
    (accountId) => {
      // Scenario: an empty or whitespace-only account identifier.
      expect(() => encodeAccountKey({ accountId })).toThrow(SubscriptionError)
      expect(() => encodeAccountKey({ tenantId: 't', accountId })).toThrow(
        expect.objectContaining({ code: 'SUBSCRIPTION_INVALID_INPUT' })
      )
    }
  )

  it('names neither identifier in the refusal', () => {
    // Scenario: the message is the fixed text of the code, so it holds no identifier.
    const failure = (() => {
      try {
        encodeAccountKey({ tenantId: 'tenant-sentinel', accountId: ' ' })
      } catch (error) {
        return error as SubscriptionError
      }
      return undefined
    })()
    expect(failure?.message).not.toContain('tenant-sentinel')
  })
})
