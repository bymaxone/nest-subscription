/**
 * @fileoverview Pins the two helpers of the read context: the error of a response that cannot be
 * used, and the conversion of the account-unknown error that a request after the first one of a
 * read must never keep.
 * @layer revenuecat
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { unavailableIfUnknown, unreadable } from './read-context'

describe('unreadable', () => {
  it('is the source-unavailable error', () => {
    // Scenario: a response that cannot be used is a source that cannot be read.
    expect(unreadable()).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
  })
})

describe('unavailableIfUnknown', () => {
  it('turns the account-unknown error into the source-unavailable one', () => {
    // Scenario: a resource that is gone after the first request is not an unknown customer.
    const converted = unavailableIfUnknown(
      new SubscriptionError(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
    )
    expect(converted).toBeInstanceOf(SubscriptionError)
    expect(converted).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE })
  })

  it.each([
    SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID,
    SUBSCRIPTION_ERROR_CODES.INVALID_INPUT,
    SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
  ])('returns the error with the code %s as the same object', (code) => {
    // Scenario: any other library error passes through untouched.
    const error = new SubscriptionError(code)
    expect(unavailableIfUnknown(error)).toBe(error)
  })

  it.each([new Error('plain'), 'text', undefined, null])('returns %j as it is', (value) => {
    // Scenario: what is not a library error is not converted.
    expect(unavailableIfUnknown(value)).toBe(value)
  })

  it('does not take an error that only carries the account-unknown code for a library error', () => {
    // Scenario: the conversion needs the library's own class.
    const lookalike = Object.assign(new Error('x'), {
      code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    })
    expect(unavailableIfUnknown(lookalike)).toBe(lookalike)
  })
})
