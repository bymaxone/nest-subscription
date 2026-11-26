/**
 * @fileoverview Pins how an unknown response is narrowed: a field of the wrong type is absent, an
 * item that cannot be named is refused, and nothing is cast.
 * @layer revenuecat
 */
import {
  isRecord,
  parseEntitlements,
  parseList,
  parseSubscription,
  readBoolean,
  readMillis,
  readString
} from './parse-customer'

describe('isRecord', () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ['text', false],
    [1, false],
    [undefined, false]
  ])('says %j is a record: %s', (value, expected) => {
    // Scenario: only a plain JSON object counts; arrays and null do not.
    expect(isRecord(value)).toBe(expected)
  })
})

describe('field readers', () => {
  it('reads a string only when it is not empty', () => {
    // Scenario: an empty string is as good as absent.
    expect(readString({ a: 'x' }, 'a')).toBe('x')
    expect(readString({ a: '' }, 'a')).toBeNull()
    expect(readString({ a: 1 }, 'a')).toBeNull()
    expect(readString({}, 'a')).toBeNull()
  })

  it('reads a boolean only when it is one', () => {
    // Scenario: "true" and 1 are not booleans.
    expect(readBoolean({ a: true }, 'a')).toBe(true)
    expect(readBoolean({ a: false }, 'a')).toBe(false)
    expect(readBoolean({ a: 'true' }, 'a')).toBeNull()
    expect(readBoolean({ a: 1 }, 'a')).toBeNull()
  })

  it('reads a number of milliseconds only when it is finite', () => {
    // Scenario: NaN and infinity, which JSON cannot carry but a double can, and text, are absent.
    expect(readMillis({ a: 0 }, 'a')).toBe(0)
    expect(readMillis({ a: 5 }, 'a')).toBe(5)
    expect(readMillis({ a: Number.NaN }, 'a')).toBeNull()
    expect(readMillis({ a: Number.POSITIVE_INFINITY }, 'a')).toBeNull()
    expect(readMillis({ a: '5' }, 'a')).toBeNull()
  })

  it.each(['__proto__', 'constructor', 'toString'])(
    'does not read the inherited member %s',
    (key) => {
      // Scenario: a response cannot make an inherited member look like a field.
      expect(readString({}, key)).toBeNull()
    }
  )
})

describe('parseList', () => {
  it('reads the items and whether a next page is named', () => {
    // Scenario: the envelope has `next_page` as a string, `null`, or nothing.
    expect(parseList({ items: [1, 2], next_page: 'https://x/y' })).toStrictEqual({
      items: [1, 2],
      hasMore: true
    })
    expect(parseList({ items: [], next_page: null })).toStrictEqual({ items: [], hasMore: false })
    expect(parseList({ items: [] })).toStrictEqual({ items: [], hasMore: false })
    expect(parseList({ items: [], next_page: '' })).toStrictEqual({ items: [], hasMore: false })
  })

  it.each([null, 'x', [], {}, { items: 'x' }, { items: {} }])('refuses %j as a list', (value) => {
    // Scenario: anything without an array of items is not a list.
    expect(parseList(value)).toBeNull()
  })
})

describe('parseEntitlements', () => {
  it('reads the identifier and the lookup key of each item and drops an item without a key', () => {
    // Scenario: the name of an entitlement is its lookup key; its identifier is kept apart.
    expect(
      parseEntitlements([
        { id: 'e1', lookup_key: 'premium' },
        { id: 'e2' },
        'x',
        { lookup_key: '' },
        { lookup_key: 'extra' }
      ])
    ).toStrictEqual([
      { id: 'e1', name: 'premium' },
      { id: null, name: 'extra' }
    ])
  })
})

describe('parseSubscription', () => {
  it('reads every field of a complete item', () => {
    // Scenario: the fields the adapter uses, with the nested entitlements as names.
    expect(
      parseSubscription({
        id: 's1',
        status: 'active',
        gives_access: true,
        auto_renewal_status: 'will_renew',
        store: 'app_store',
        environment: 'production',
        product_id: 'p1',
        starts_at: 1,
        current_period_starts_at: 2,
        current_period_ends_at: 3,
        ends_at: 4,
        management_url: 'https://m',
        entitlements: { object: 'list', items: [{ lookup_key: 'premium' }], next_page: null }
      })
    ).toStrictEqual({
      id: 's1',
      status: 'active',
      givesAccess: true,
      autoRenewalStatus: 'will_renew',
      store: 'app_store',
      environment: 'production',
      productId: 'p1',
      startsAt: 1,
      currentPeriodStartsAt: 2,
      currentPeriodEndsAt: 3,
      endsAt: 4,
      managementUrl: 'https://m',
      entitlements: [{ id: null, name: 'premium' }],
      entitlementsIncomplete: false
    })
  })

  it('marks the entitlements incomplete when the nested list has a next page or is absent', () => {
    // Scenario: both cases send the adapter to the per-subscription endpoint.
    const withNext = parseSubscription({ id: 's1', entitlements: { items: [], next_page: 'n' } })
    const absent = parseSubscription({ id: 's1' })
    const malformed = parseSubscription({ id: 's1', entitlements: 'x' })
    expect([absent?.entitlements, malformed?.entitlements]).toStrictEqual([[], []])
    expect([
      withNext?.entitlementsIncomplete,
      absent?.entitlementsIncomplete,
      malformed?.entitlementsIncomplete
    ]).toStrictEqual([true, true, true])
  })

  it.each([null, 'x', [], {}, { id: '' }, { id: 1 }])(
    'refuses %j, which cannot be named',
    (value) => {
      // Scenario: an item with no usable id cannot be referred to.
      expect(parseSubscription(value)).toBeNull()
    }
  )
})
