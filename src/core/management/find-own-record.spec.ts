/**
 * @fileoverview Pins the ownership check: a record is found in the authenticated account's own
 * stored snapshot, among its subscriptions and non-renewing purchases and nowhere else, and a
 * reference that belongs to another account, another tenant or nobody is refused.
 * @layer core
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import {
  ACCOUNT,
  harness,
  purchaseOf,
  snapshotOf,
  subscriptionOf
} from './management.builders.spec'
import { findOwnRecord, locateRecord } from './find-own-record'

describe('findOwnRecord', () => {
  it('finds a subscription of the account, tagged with its kind', async () => {
    // Scenario: the stored snapshot holds a subscription and a purchase; the subscription's
    // reference answers the subscription.
    const { store, seed } = harness()
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()], [purchaseOf()]))
    expect(await findOwnRecord(store, ACCOUNT, 'sub-1')).toStrictEqual({
      kind: 'subscription',
      record: subscriptionOf()
    })
  })

  it('finds a non-renewing purchase of the account, tagged with its kind', async () => {
    // Scenario: the purchase's reference answers the purchase (D31).
    const { store, seed } = harness()
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()], [purchaseOf()]))
    expect(await findOwnRecord(store, ACCOUNT, 'pur-1')).toStrictEqual({
      kind: 'purchase',
      record: purchaseOf()
    })
  })

  it.each([
    ['another account', { accountId: 'acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'acc-1', tenantId: 'tenant-b' }],
    ['no tenant', { accountId: 'acc-1' }]
  ])('refuses a reference held by %s, as an unknown account', async (_label, other) => {
    // Scenario: acc-1 of tenant-a holds both kinds; the caller is someone else and names them.
    const { store, seed } = harness()
    const owner = { accountId: 'acc-1', tenantId: 'tenant-a' }
    await seed(owner, snapshotOf(owner, [subscriptionOf()], [purchaseOf()]))
    for (const reference of ['sub-1', 'pur-1']) {
      await expect(findOwnRecord(store, other, reference)).rejects.toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
      })
    }
  })

  it('refuses a reference the account does not hold and an account with nothing stored', async () => {
    // Scenario: an unknown reference, then an account the store has never seen.
    const { store, seed } = harness()
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()], [purchaseOf()]))
    await expect(findOwnRecord(store, ACCOUNT, 'sub-9')).rejects.toBeInstanceOf(SubscriptionError)
    await expect(findOwnRecord(store, ACCOUNT, 'pur-9')).rejects.toBeInstanceOf(SubscriptionError)
    await expect(findOwnRecord(store, { accountId: 'nobody' }, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    })
  })

  it.each([[''], ['   ']])('refuses the blank reference %j as invalid input', async (reference) => {
    // Scenario: a blank reference never reaches the store.
    const { store } = harness()
    const read = jest.spyOn(store, 'getSnapshot')
    await expect(findOwnRecord(store, ACCOUNT, reference)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses a reference that is not a string as invalid input', async () => {
    // Scenario: a caller passes a number through a loose type.
    const { store } = harness()
    const holder: object = { value: 7 }
    const loose: string = Reflect.get(holder, 'value')
    await expect(findOwnRecord(store, ACCOUNT, loose)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
  })
})

describe('locateRecord', () => {
  it('finds nothing in a snapshot that holds no purchases list', () => {
    // Scenario: a snapshot without `nonRenewingPurchases` holds none.
    const { nonRenewingPurchases: _none, ...bare } = snapshotOf(ACCOUNT, [subscriptionOf()])
    expect(locateRecord(bare, 'pur-1')).toBeUndefined()
  })

  it('prefers the subscription when both kinds carry one reference', () => {
    // Scenario: a clash is answered the same way every time.
    const snapshot = snapshotOf(
      ACCOUNT,
      [subscriptionOf({ subscriptionReference: 'x' })],
      [purchaseOf({ purchaseReference: 'x' })]
    )
    expect(locateRecord(snapshot, 'x')?.kind).toBe('subscription')
  })
})
