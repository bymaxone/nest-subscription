/**
 * @fileoverview Pins the members of the value sets of the model and that each set is frozen.
 * @layer shared
 */
import { SUBSCRIPTION_ENVIRONMENTS, type SubscriptionEnvironment } from './values'

describe('SUBSCRIPTION_ENVIRONMENTS', () => {
  it('lists production and sandbox, in that order', () => {
    // Scenario: a source reports the environment of a purchase; the set is exactly these two.
    expect([...SUBSCRIPTION_ENVIRONMENTS]).toEqual(['production', 'sandbox'])
  })

  it('is frozen', () => {
    // Scenario: a host holding the set cannot add or replace a member for every other caller.
    expect(Object.isFrozen(SUBSCRIPTION_ENVIRONMENTS)).toBe(true)
  })

  it('types each member as the union', () => {
    // Scenario: the derived union accepts a member and is the type of reading one back; a
    // renamed member fails to compile here.
    const environment: SubscriptionEnvironment = SUBSCRIPTION_ENVIRONMENTS[1]
    expect(environment).toBe('sandbox')
  })
})
