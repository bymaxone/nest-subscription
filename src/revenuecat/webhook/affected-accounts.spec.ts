/**
 * @fileoverview Pins which accounts an event names: the last seen and first identifiers, every
 * alias, and both sides of a transfer; de-duplicated, case-sensitive, with anonymous identifiers
 * counted and kept out.
 * @layer revenuecat
 */
import { ANONYMOUS_PREFIX, affectedAccounts } from './affected-accounts'

describe('affectedAccounts', () => {
  it('names the last seen identifier, the first one and every alias, once each, in order', () => {
    // Scenario: the order of first appearance is the order of the fields, and a repeat is dropped.
    expect(
      affectedAccounts({ app_user_id: 'b', original_app_user_id: 'a', aliases: ['a', 'b', 'c'] })
    ).toStrictEqual({ accountIds: ['b', 'a', 'c'], anonymousCount: 0 })
  })

  it('names both the identifiers that lost and the identifiers that gained the purchases of a transfer', () => {
    // Scenario: a transfer event has the two lists and no App User ID of its own.
    expect(
      affectedAccounts({ transferred_from: ['from_1', 'from_2'], transferred_to: ['to_1'] })
    ).toStrictEqual({ accountIds: ['from_1', 'from_2', 'to_1'], anonymousCount: 0 })
  })

  it('never changes the case of an identifier or treats two cases as one', () => {
    // Scenario: App User IDs are case-sensitive.
    expect(
      affectedAccounts({ app_user_id: 'User', aliases: ['user', 'USER'] }).accountIds
    ).toStrictEqual(['User', 'user', 'USER'])
  })

  it('counts anonymous identifiers and leaves them out of the accounts', () => {
    // Scenario: an anonymous identifier is no account of the host; two distinct ones are two.
    expect(
      affectedAccounts({
        app_user_id: `${ANONYMOUS_PREFIX}one`,
        original_app_user_id: `${ANONYMOUS_PREFIX}two`,
        aliases: [`${ANONYMOUS_PREFIX}one`, 'real']
      })
    ).toStrictEqual({ accountIds: ['real'], anonymousCount: 2 })
  })

  it('does not take an identifier that only contains the anonymous prefix for an anonymous one', () => {
    // Scenario: the prefix must start the identifier.
    expect(affectedAccounts({ app_user_id: `x${ANONYMOUS_PREFIX}1` }).accountIds).toStrictEqual([
      `x${ANONYMOUS_PREFIX}1`
    ])
  })

  it('drops what is not an identifier: non-strings, empty strings, and values past the longest identifier', () => {
    // Scenario: a malformed list never throws and never names an account that cannot exist.
    expect(
      affectedAccounts({
        app_user_id: '',
        original_app_user_id: 7,
        aliases: [1, null, '', 'ok', 'x'.repeat(1501), 'y'.repeat(1500)],
        transferred_from: 'not a list',
        transferred_to: null
      })
    ).toStrictEqual({ accountIds: ['ok', 'y'.repeat(1500)], anonymousCount: 0 })
  })

  it.each([null, undefined, 'text', 5, [], {}])('names nothing for the event %j', (event) => {
    // Scenario: an event that is not an object, or has no identifier, names no account.
    expect(affectedAccounts(event)).toStrictEqual({ accountIds: [], anonymousCount: 0 })
  })
})
