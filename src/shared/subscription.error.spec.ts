/**
 * @fileoverview Pins the behaviour of `SubscriptionError`: code, fixed message, cause and the
 * serialized form.
 * @layer shared
 */
import { SUBSCRIPTION_ERROR_CODES, SUBSCRIPTION_ERROR_MESSAGES } from './error-codes'
import { SubscriptionError } from './subscription.error'

describe('SubscriptionError', () => {
  it('carries the code and the fixed message of the catalogue', () => {
    // Scenario: an error is raised with a code; the message is the catalogue's text for it.
    const error = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SubscriptionError')
    expect(error.code).toBe('SUBSCRIPTION_NO_ACCESS')
    expect(error.message).toBe(SUBSCRIPTION_ERROR_MESSAGES.SUBSCRIPTION_NO_ACCESS)
  })

  it('passes the cause through the standard property', () => {
    // Scenario: a lower-level failure is attached as the cause for debugging.
    const cause = new Error('socket hang up')
    const error = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE, { cause })
    expect(error.cause).toBe(cause)
  })

  it('has no cause when none is given', () => {
    // Scenario: no options bag, so the standard property is absent.
    const error = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    expect('cause' in error).toBe(false)
  })

  it('serializes to the code and the message only', () => {
    // Scenario: the error carries a cause with a sentinel; JSON.stringify must show neither the
    // cause nor any other own property.
    const cause = new Error('sentinel-secret-value')
    const error = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.WEBHOOK_REFUSED, { cause })
    expect(error.toJSON()).toEqual({
      code: 'SUBSCRIPTION_WEBHOOK_REFUSED',
      message: SUBSCRIPTION_ERROR_MESSAGES.SUBSCRIPTION_WEBHOOK_REFUSED
    })
    const serialized = JSON.stringify(error)
    expect(JSON.parse(serialized)).toEqual(error.toJSON())
    expect(serialized).not.toContain('sentinel-secret-value')
  })

  it('has no option paths when none are given', () => {
    // Scenario: an error raised without paths exposes an empty list and keeps the fixed message.
    const error = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID)
    expect(error.optionPaths).toEqual([])
    expect(error.message).toBe(SUBSCRIPTION_ERROR_MESSAGES.SUBSCRIPTION_CONFIG_INVALID)
  })

  it('appends the option paths to the fixed message, in the order given', () => {
    // Scenario: a configuration error names two options; the message lists them after the text.
    const error = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID, {
      optionPaths: ['store', 'failPolicy']
    })
    expect(error.message).toBe(
      `${SUBSCRIPTION_ERROR_MESSAGES.SUBSCRIPTION_CONFIG_INVALID} Offending options: store, failPolicy.`
    )
    expect(error.optionPaths).toEqual(['store', 'failPolicy'])
    expect(error.toJSON()).toEqual({ code: 'SUBSCRIPTION_CONFIG_INVALID', message: error.message })
  })

  it('keeps its own copy of the option paths', () => {
    // Scenario: the caller mutates the array it passed after raising the error.
    const paths = ['store']
    const error = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID, {
      optionPaths: paths
    })
    paths.push('source')
    expect(error.optionPaths).toEqual(['store'])
    expect(Object.isFrozen(error.optionPaths)).toBe(true)
  })
})
