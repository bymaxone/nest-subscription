/**
 * @fileoverview Pins how the purchases and active-entitlements lists are narrowed: a field of the
 * wrong type is absent, an item that cannot be named is refused, and a malformed expiry is never
 * read as no expiry.
 * @layer revenuecat
 */
import { parseActiveEntitlements, parsePurchase } from './parse-purchases'

describe('parsePurchase', () => {
  it('reads every field of a complete item', () => {
    // Scenario: the fields the adapter uses, with the nested entitlements by identifier and name.
    expect(
      parsePurchase({
        id: 'p1',
        status: 'owned',
        store: 'app_store',
        environment: 'production',
        product_id: 'prod',
        purchased_at: 5,
        entitlements: {
          items: [{ id: 'e1', lookup_key: 'premium' }, { lookup_key: 'no-id' }, { id: 'e3' }],
          next_page: null
        }
      })
    ).toStrictEqual({
      id: 'p1',
      status: 'owned',
      store: 'app_store',
      environment: 'production',
      productId: 'prod',
      purchasedAt: 5,
      entitlements: [
        { id: 'e1', name: 'premium' },
        { id: null, name: 'no-id' }
      ],
      entitlementsIncomplete: false
    })
  })

  it('marks the entitlements incomplete when the nested list has a next page or is absent', () => {
    // Scenario: both cases send the adapter to the per-purchase endpoint.
    expect(
      parsePurchase({ id: 'p1', entitlements: { items: [], next_page: 'n' } })
        ?.entitlementsIncomplete
    ).toBe(true)
    const absent = parsePurchase({ id: 'p1' })
    expect([absent?.entitlementsIncomplete, absent?.entitlements]).toStrictEqual([true, []])
  })

  it.each([null, 'x', [], {}, { id: '' }, { id: 1 }])(
    'refuses %j, which cannot be named',
    (value) => {
      // Scenario: an item with no usable id cannot be referred to.
      expect(parsePurchase(value)).toBeNull()
    }
  )
})

describe('parseActiveEntitlements', () => {
  it('maps each entitlement identifier to its expiry, with null for none', () => {
    // Scenario: a lifetime grant and a dated one.
    expect([
      ...parseActiveEntitlements([
        { entitlement_id: 'e1', expires_at: null },
        { entitlement_id: 'e2', expires_at: 7 }
      ])
    ]).toStrictEqual([
      ['e1', null],
      ['e2', 7]
    ])
  })

  it.each([
    ['an item that is not an object', 'x'],
    ['an item with no entitlement identifier', { expires_at: 7 }],
    ['an item with an empty entitlement identifier', { entitlement_id: '', expires_at: 7 }],
    ['an item with no expiry field', { entitlement_id: 'e1' }],
    ['an item whose expiry is text', { entitlement_id: 'e1', expires_at: 'never' }],
    [
      'an item whose expiry is not finite',
      { entitlement_id: 'e1', expires_at: Number.POSITIVE_INFINITY }
    ]
  ])('drops %s, so a malformed end never becomes a lifetime grant', (_label, item) => {
    // Scenario: fail closed.
    expect(parseActiveEntitlements([item]).size).toBe(0)
  })
})
