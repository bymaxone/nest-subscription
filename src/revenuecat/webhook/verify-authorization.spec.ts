/**
 * @fileoverview Pins the static authorization header check of RevenueCat webhooks: an exact value
 * is accepted, anything else is refused, two values work during a rotation, and every configured
 * value is compared whatever matched first.
 * @layer revenuecat
 */
import nodeCrypto from 'node:crypto'

import { Secret } from '@bymax-one/nest-subscription/internal'

import { headerValue, verifyAuthorization } from './verify-authorization'

const VALUE = 'sentinel-authorization-5d2e'
const PREVIOUS = 'sentinel-previous-authorization-91bc'

describe('verifyAuthorization', () => {
  it('accepts the configured value, under any capitalisation of the header name', () => {
    // Scenario: the right value passes whatever case the framework gave the name.
    for (const name of ['authorization', 'Authorization', 'AUTHORIZATION']) {
      expect(verifyAuthorization(new Secret(VALUE), { [name]: VALUE })).toBe(true)
    }
  })

  it.each([
    ['a wrong value', { authorization: 'something-else' }],
    ['no header', {}],
    ['a header that is undefined', { authorization: undefined }],
    ['a value in a different case', { authorization: VALUE.toUpperCase() }],
    ['the value with a prefix', { authorization: `Bearer ${VALUE}` }],
    ['the value with a suffix', { authorization: `${VALUE} ` }],
    ['an empty value', { authorization: '' }],
    ['the value under another header name', { 'x-authorization': VALUE }]
  ])('refuses %s', (_label, headers) => {
    // Scenario: only the exact configured value passes.
    expect(verifyAuthorization(new Secret(VALUE), headers)).toBe(false)
  })

  it.each([
    ['the current value', VALUE, true],
    ['the previous value', PREVIOUS, true],
    ['a value that is neither', 'a-third-value', false]
  ])('with two values configured, %s is accepted: %s', (_label, presented, accepted) => {
    // Scenario: SEC09: a rotation accepts either configured value.
    expect(verifyAuthorization(new Secret(VALUE, PREVIOUS), { authorization: presented })).toBe(
      accepted
    )
  })

  it('compares with timingSafeEqual over equal-length buffers, once for each configured value', () => {
    // Scenario: both values are compared even when the first matches, and the buffers have the
    // length of a digest whatever the length of the values.
    const spy = jest.spyOn(nodeCrypto, 'timingSafeEqual')
    expect(verifyAuthorization(new Secret(VALUE, PREVIOUS), { authorization: VALUE })).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
    for (const [left, right] of spy.mock.calls) {
      expect(left).toHaveProperty('byteLength', 32)
      expect(right).toHaveProperty('byteLength', 32)
    }
  })
})

describe('headerValue', () => {
  it('finds a header by its lower-case name whatever case it arrived in', () => {
    // Scenario: names are case-insensitive.
    expect(headerValue({ 'X-A': '1' }, 'x-a')).toBe('1')
    expect(headerValue({ 'x-a': '2' }, 'x-a')).toBe('2')
  })

  it('gives undefined for a header that was not sent or has no value', () => {
    // Scenario: a header the framework dropped.
    expect(headerValue({ 'x-a': undefined }, 'x-a')).toBeUndefined()
    expect(headerValue({}, 'x-a')).toBeUndefined()
  })
})
