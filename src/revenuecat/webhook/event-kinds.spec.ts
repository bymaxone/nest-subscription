/**
 * @fileoverview Ties the event table to Appendix A.2: every event type the specification lists has a
 * row, no row names a type it does not list, an unlisted type is the unknown kind, and the types
 * that cannot change a subscription name no account.
 * @layer revenuecat
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CHANGES_NOTHING_KIND, EVENT_KINDS, UNKNOWN_KIND, kindOf } from './event-kinds'

/** The event types Appendix A.2 of the specification lists. */
function specTypes(): string[] {
  const spec = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'spec.md'), 'utf8')
  const start = spec.indexOf('### A.2 ')
  const section = spec.slice(start, spec.indexOf('Rules that are easy to get wrong', start))
  return [...section.matchAll(/`([A-Z_]+)`/g)].map((match) => match[1] ?? '')
}

const CHANGES_NOTHING = ['TEST', 'EXPERIMENT_ENROLLMENT', 'VIRTUAL_CURRENCY_TRANSACTION']

describe('the event table and Appendix A.2', () => {
  const listed = specTypes()

  it('lists twenty-one event types in the specification', () => {
    // Scenario: the twenty kinds and the deprecated alias event; a parse that found none would pass the rest.
    expect(listed).toHaveLength(21)
  })

  it.each(listed)('gives %s a kind of its own', (type) => {
    // Scenario: every listed type is known, so none falls through to the unknown kind.
    expect(kindOf(type).kind).not.toBe(UNKNOWN_KIND)
  })

  it('has rows only for types the specification lists, and the three that change nothing besides', () => {
    // Scenario: a row for a type the specification does not list would be an invented one.
    expect([...EVENT_KINDS.keys(), ...CHANGES_NOTHING].sort()).toStrictEqual([...listed].sort())
  })

  it('names each type by its lower-case form, once', () => {
    // Scenario: the kind is the type in snake case, and no two types share one.
    for (const [type, kind] of EVENT_KINDS) expect(kind).toBe(type.toLowerCase())
    expect(new Set(EVENT_KINDS.values()).size).toBe(EVENT_KINDS.size)
  })

  it.each(CHANGES_NOTHING)('reports %s as a kind that names no account', (type) => {
    // Scenario: a test event, an experiment enrollment and a currency movement change no subscription.
    expect(kindOf(type)).toStrictEqual({ kind: CHANGES_NOTHING_KIND, refreshes: false })
  })

  it.each(listed.filter((type) => !CHANGES_NOTHING.includes(type)))(
    'reports %s as a kind that refreshes',
    (type) => {
      // Scenario: every other listed type names accounts to read.
      expect(kindOf(type).refreshes).toBe(true)
    }
  )

  it.each([
    'SOMETHING_NEW',
    '',
    'initial_purchase',
    'Initial_Purchase',
    '__proto__',
    'constructor',
    undefined,
    null,
    7,
    {}
  ])('reports %j as the unknown kind, which refreshes', (type) => {
    // Scenario: FR20: a type nobody has seen must never break the receiver.
    expect(kindOf(type)).toStrictEqual({ kind: UNKNOWN_KIND, refreshes: true })
  })
})
