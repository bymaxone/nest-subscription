/**
 * @fileoverview Pins what sandbox activity contests: only the entitlements of a grantor that is in
 * the sandbox and gives access, matched by identifier and, for a grantor that gave none, by name.
 * @layer revenuecat
 */
import { NOTHING_CONTESTED, contestedBy, isContested, type Grantor } from './contested'

const premium = { id: 'e1', name: 'premium' }
const extra = { id: 'e2', name: 'extra' }

const grantor = (overrides: Partial<Grantor> = {}): Grantor => ({
  environment: 'sandbox',
  givesAccess: true,
  entitlements: [premium],
  ...overrides
})

describe('contestedBy', () => {
  it('holds the identifiers of the grantors that have one and the names of those that have none', () => {
    // Scenario: one entitlement of each kind, from sandbox grantors that give access.
    const contested = contestedBy([
      grantor({ entitlements: [premium, { id: null, name: 'extra' }] })
    ])
    expect([...contested.ids]).toStrictEqual(['e1'])
    expect([...contested.names]).toStrictEqual(['extra'])
  })

  it('holds nothing for no grantor', () => {
    // Scenario: no sandbox activity.
    expect(contestedBy([])).toStrictEqual(NOTHING_CONTESTED)
  })

  it('holds the entitlements of a sandbox grantor that gives access', () => {
    // Scenario: a sandbox subscription whose flag is true, or an owned sandbox purchase.
    expect([...contestedBy([grantor()]).ids]).toStrictEqual(['e1'])
  })

  it('holds nothing for a sandbox grantor that gives no access', () => {
    // Scenario: a subscription whose flag is false, or a refunded purchase: it grants nothing.
    expect(contestedBy([grantor({ givesAccess: false })])).toStrictEqual(NOTHING_CONTESTED)
  })

  it('holds nothing for a production grantor that gives access', () => {
    // Scenario: only sandbox activity contests.
    expect(contestedBy([grantor({ environment: 'production' })])).toStrictEqual(NOTHING_CONTESTED)
  })

  it('holds the entitlements of each grantor that counts and none of those that do not', () => {
    // Scenario: a mix of the four combinations of environment and access.
    const contested = contestedBy([
      grantor(),
      grantor({ givesAccess: false, entitlements: [extra] }),
      grantor({ environment: 'production', entitlements: [{ id: 'e3', name: 'third' }] })
    ])
    expect([...contested.ids]).toStrictEqual(['e1'])
  })
})

describe('isContested', () => {
  const contested = contestedBy([grantor({ entitlements: [premium, { id: null, name: 'extra' }] })])

  it.each([
    ['an identifier a grantor names', { id: 'e1', name: 'something' }, true],
    ['a name a grantor gave without an identifier', { id: 'e9', name: 'extra' }, true],
    ['that name for an entitlement with no identifier', { id: null, name: 'extra' }, true],
    [
      'the name of a grantor that has an identifier, under another identifier',
      { id: 'e9', name: 'premium' },
      false
    ],
    [
      'the name of a grantor that has an identifier, with no identifier',
      { id: null, name: 'premium' },
      false
    ],
    ['an entitlement no grantor names', { id: 'e9', name: 'other' }, false]
  ])('says %s is contested: %s', (_label, entitlement, expected) => {
    // Scenario: each way a match can and cannot be made.
    expect(isContested(contested, entitlement)).toBe(expected)
  })

  it('contests nothing when nothing is contested', () => {
    // Scenario: sandbox access allowed.
    expect(isContested(NOTHING_CONTESTED, premium)).toBe(false)
  })
})
