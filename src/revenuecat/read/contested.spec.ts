/**
 * @fileoverview Pins what sandbox grantors contest: an entitlement is matched by its identifier,
 * and by its name only when the sandbox grantor gave no identifier.
 * @layer revenuecat
 */
import { NOTHING_CONTESTED, contestedBy, isContested } from './contested'

describe('contestedBy', () => {
  it('holds the identifiers of the grantors that have one and the names of those that have none', () => {
    // Scenario: one grantor of each kind.
    const contested = contestedBy([
      { id: 'e1', name: 'premium' },
      { id: null, name: 'extra' }
    ])
    expect([...contested.ids]).toStrictEqual(['e1'])
    expect([...contested.names]).toStrictEqual(['extra'])
  })

  it('holds nothing for no grantor', () => {
    // Scenario: no sandbox activity.
    expect(contestedBy([])).toStrictEqual(NOTHING_CONTESTED)
  })
})

describe('isContested', () => {
  const contested = contestedBy([
    { id: 'e1', name: 'premium' },
    { id: null, name: 'extra' }
  ])

  it.each([
    ['an identifier a grantor names', { id: 'e1', name: 'something' }, true],
    ['a name a grantor gave without an identifier', { id: 'e9', name: 'extra' }, true],
    ['that name for an entitlement with no identifier', { id: null, name: 'extra' }, true],
    [
      'the name of a grantor that has an identifier, under another identifier',
      { id: 'e9', name: 'premium' },
      false
    ],
    ['that name for an entitlement with no identifier', { id: null, name: 'premium' }, false],
    ['an entitlement no grantor names', { id: 'e9', name: 'other' }, false]
  ])('says %s is contested: %s', (_label, entitlement, expected) => {
    // Scenario: each way a match can and cannot be made.
    expect(isContested(contested, entitlement)).toBe(expected)
  })

  it('contests nothing when nothing is contested', () => {
    // Scenario: sandbox access allowed.
    expect(isContested(NOTHING_CONTESTED, { id: 'e1', name: 'premium' })).toBe(false)
  })
})
