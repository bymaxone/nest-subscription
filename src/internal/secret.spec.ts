/**
 * @fileoverview Pins `Secret`: a deliberate read returns the value, rotation holds two values, the
 * comparison is by digest, and no serialization, spread, inspection or coercion shows a value.
 * @layer internal
 */
import { inspect } from 'node:util'

import { SubscriptionError } from '@bymax-one/nest-subscription/shared'
import { Secret, SECRET_PLACEHOLDER } from './secret'

const CURRENT = 'sentinel-current-5d1c0e7a'
const PREVIOUS = 'sentinel-previous-93b2f4c8'

function leaks(output: string): boolean {
  return output.includes(CURRENT) || output.includes(PREVIOUS)
}

describe('Secret', () => {
  describe('a deliberate read', () => {
    it('returns the current value', () => {
      // Scenario: the one value given is read back through the explicit method.
      expect(new Secret(CURRENT).reveal()).toBe(CURRENT)
    })

    it('lists only the current value when there is no previous one', () => {
      // Scenario: a secret without rotation has one candidate.
      expect(new Secret(CURRENT).candidates()).toEqual([CURRENT])
    })

    it('lists the current and the previous value during rotation', () => {
      // Scenario: two valid values are held at once, the current one first (SEC09).
      const secret = new Secret(CURRENT, PREVIOUS)
      expect(secret.reveal()).toBe(CURRENT)
      expect(secret.candidates()).toEqual([CURRENT, PREVIOUS])
    })

    it('hands out a list that cannot change what the secret holds', () => {
      // Scenario: a caller mutates the list it got; a later read is unaffected.
      const secret = new Secret(CURRENT, PREVIOUS)
      expect(() => Reflect.apply(Array.prototype.push, secret.candidates(), ['x'])).toThrow(
        TypeError
      )
      expect(secret.candidates()).toEqual([CURRENT, PREVIOUS])
    })
  })

  describe('construction', () => {
    it.each([
      ['an empty current value', ''],
      ['a non-string current value', 42],
      ['a missing current value', undefined]
    ])('refuses %s', (_name, value) => {
      // Scenario: a secret with nothing to compare against could accept an empty presentation.
      expect(() => Reflect.construct(Secret, [value])).toThrow(SubscriptionError)
    })

    it.each([
      ['an empty previous value', ''],
      ['a non-string previous value', 7]
    ])('refuses %s', (_name, value) => {
      // Scenario: the previous value, when given, must be as usable as the current one.
      expect(() => Reflect.construct(Secret, [CURRENT, value])).toThrow(SubscriptionError)
    })

    it('does not put the refused value in the error', () => {
      // Scenario: a wrong-shaped previous value carries a sentinel; the error shows none.
      try {
        Reflect.construct(Secret, [CURRENT, { sentinel: PREVIOUS }])
      } catch (error) {
        expect(leaks(String(error))).toBe(false)
        expect(leaks(inspect(error, { showHidden: true, depth: null }))).toBe(false)
        return
      }
      throw new Error('the secret was accepted')
    })

    it('is frozen', () => {
      // Scenario: nothing can be added to a secret after construction.
      expect(Object.isFrozen(new Secret(CURRENT))).toBe(true)
    })
  })

  describe('Secret.from', () => {
    it('wraps a string', () => {
      // Scenario: the shorthand for one value.
      expect(Secret.from(CURRENT).candidates()).toEqual([CURRENT])
    })

    it('wraps a current and previous pair', () => {
      // Scenario: the rotation shape.
      expect(Secret.from({ current: CURRENT, previous: PREVIOUS }).candidates()).toEqual([
        CURRENT,
        PREVIOUS
      ])
    })

    it('wraps a pair without a previous value', () => {
      // Scenario: the rotation shape outside a rotation.
      expect(Secret.from({ current: CURRENT }).candidates()).toEqual([CURRENT])
    })

    it('returns a secret it is given as it is', () => {
      // Scenario: an adapter that already wrapped its secret is not wrapped twice.
      const secret = new Secret(CURRENT)
      expect(Secret.from(secret)).toBe(secret)
    })
  })

  describe('matches', () => {
    const secret = new Secret(CURRENT, PREVIOUS)

    it.each([
      ['the current value', CURRENT, true],
      ['the previous value', PREVIOUS, true],
      ['a wrong value of the same length', `${CURRENT.slice(0, -1)}x`, false],
      ['a prefix of the current value', CURRENT.slice(0, -1), false],
      ['the current value with a suffix', `${CURRENT}x`, false],
      ['an empty value', '', false]
    ])('answers for %s', (_name, presented, expected) => {
      // Scenario: one candidate, a near miss, a different length and an empty value are presented.
      expect(secret.matches(presented)).toBe(expected)
    })

    it.each([[undefined], [null], [42], [{}]])('refuses a presented value that is %p', (value) => {
      // Scenario: a header that was not sent, or any other type, never matches.
      expect(Reflect.apply(secret.matches, secret, [value])).toBe(false)
    })

    it('does not accept the previous value once the secret no longer holds it', () => {
      // Scenario: after a rotation completes the retired value is refused.
      expect(new Secret(CURRENT).matches(PREVIOUS)).toBe(false)
    })

    it('does not throw for a presented value shorter or longer than the secret', () => {
      // Scenario: a presented value of a different length does not throw, which the raw
      // timingSafeEqual would do; the comparison is over fixed-width digests.
      expect(() => secret.matches('a')).not.toThrow()
      expect(() => secret.matches('a'.repeat(10_000))).not.toThrow()
    })
  })

  describe('serialization, copying, inspection and coercion', () => {
    const secret = new Secret(CURRENT, PREVIOUS)

    it('shows the placeholder through toJSON and JSON.stringify', () => {
      // Scenario: the secret sits inside a larger object that is serialized.
      expect(secret.toJSON()).toBe(SECRET_PLACEHOLDER)
      const json = JSON.stringify({ nested: { secret } })
      expect(json).toBe(`{"nested":{"secret":"${SECRET_PLACEHOLDER}"}}`)
      expect(leaks(json)).toBe(false)
    })

    it('has no own property to spread, list or iterate', () => {
      // Scenario: every way to enumerate or copy own properties comes back empty.
      expect({ ...secret }).toEqual({})
      expect(Object.keys(secret)).toEqual([])
      expect(Object.entries(secret)).toEqual([])
      expect(Object.values(secret)).toEqual([])
      expect(Object.getOwnPropertyNames(secret)).toEqual([])
      expect(Object.getOwnPropertySymbols(secret)).toEqual([])
      expect(Reflect.ownKeys(secret)).toEqual([])
      const seen: string[] = []
      for (const key in secret) seen.push(key)
      expect(seen).toEqual([])
      expect(Object.assign({}, secret)).toEqual({})
    })

    it('copies to an object with no value', () => {
      // Scenario: structuredClone keeps own enumerable data only.
      expect(leaks(JSON.stringify(structuredClone(secret)))).toBe(false)
      expect(Object.getOwnPropertyNames(structuredClone(secret))).toEqual([])
    })

    it('shows the placeholder through util.inspect, with and without hidden properties', () => {
      // Scenario: a developer logs the secret, even with showHidden and unlimited depth.
      for (const options of [
        {},
        { showHidden: true },
        { showHidden: true, depth: null, getters: true },
        { customInspect: true }
      ]) {
        const output = inspect(secret, options)
        expect(leaks(output)).toBe(false)
        expect(output).toBe(SECRET_PLACEHOLDER)
      }
    })

    it('shows no value when inspected inside another object', () => {
      // Scenario: the secret is a field of an object that is inspected with hidden properties.
      const output = inspect({ a: { secret } }, { showHidden: true, depth: null })
      expect(leaks(output)).toBe(false)
      expect(output).toContain(SECRET_PLACEHOLDER)
    })

    it('shows the placeholder when coerced to a string', () => {
      // Scenario: string conversion, a template literal and concatenation.
      expect(String(secret)).toBe(SECRET_PLACEHOLDER)
      expect(`${secret}`).toBe(SECRET_PLACEHOLDER)
      expect(`value: ${secret.toString()}`).toBe(`value: ${SECRET_PLACEHOLDER}`)
      expect(leaks(String(secret))).toBe(false)
    })

    it('does not expose its values through the prototype', () => {
      // Scenario: the prototype's own members are methods; none is a data property.
      const proto = Object.getPrototypeOf(secret) as object
      for (const name of Object.getOwnPropertyNames(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name)
        expect(descriptor?.value === undefined || typeof descriptor.value === 'function').toBe(true)
      }
    })
  })
})
