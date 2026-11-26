/**
 * @fileoverview Pins the one check a snapshot from outside the library's write path passes: every
 * field the model types has its type, closed sets hold members, nullable and optional fields are
 * what they may be, and identity and instants fit. A table lists every field of the model, and a
 * case fails when a field of the fixture is missing from it, so a field added to the model cannot
 * go unchecked.
 * @layer core
 */
import { createEmptySnapshot, type SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import { InMemorySubscriptionStore } from '@bymax-one/nest-subscription/testing'

import { isSnapshotFor } from './snapshot-fit'

const ACCOUNT = { accountId: 'acc-1' }
const TENANTED = { tenantId: 'one', accountId: 'acc-1' }
const T0 = '2026-01-01T00:00:00.000Z'

/** A non-renewing purchase with every field present and a value of each type. */
const PURCHASE = {
  purchaseReference: 'purchase-1',
  entitlementNames: ['pro'],
  givesAccess: true,
  origin: 'web',
  environment: 'production',
  productReference: 'lifetime',
  purchasedAt: T0,
  accessUntil: T0,
  refundedAt: T0
} as const

/** A snapshot with every field of the model present and a value of each type. */
function full(): SubscriptionSnapshot {
  return {
    accountId: 'acc-1',
    tenantId: 'one',
    entitlements: [
      {
        name: 'pro',
        active: true,
        until: T0,
        grantingSubscriptionReference: 'sub-1',
        grantingSubscriptionReferences: ['sub-1']
      }
    ],
    subscriptions: [
      {
        subscriptionReference: 'sub-1',
        status: 'active',
        givesAccess: true,
        willRenew: 'yes',
        origin: 'web',
        environment: 'production',
        productReference: 'pro',
        billingInterval: 'month',
        currentPeriodStart: T0,
        currentPeriodEnd: T0,
        accessUntil: T0,
        billingIssueSince: T0,
        cancelledAt: T0,
        refundedAt: T0,
        managementReference: 'https://example.test/manage'
      }
    ],
    nonRenewingPurchases: [PURCHASE],
    source: 'fake',
    sourceCustomer: { id: 'customer-1' },
    fetchedAt: T0,
    sourceUpdatedAt: T0
  }
}

/** Replaces one field of the first entitlement, the first subscription or the snapshot itself. */
function withField(path: string, value: unknown): unknown {
  const snapshot = JSON.parse(JSON.stringify(full()))
  const [first, second, third] = path.split('.')
  if (second === undefined) return { ...snapshot, [first ?? '']: value }
  if (third === undefined) {
    return { ...snapshot, [first ?? '']: { ...snapshot[first ?? ''], [second]: value } }
  }
  const list = snapshot[first ?? '']
  return { ...snapshot, [first ?? '']: [{ ...list[0], [third]: value }] }
}

/** Every field of the model with one value of the wrong type for it. */
const WRONG: ReadonlyArray<readonly [string, unknown]> = [
  ['accountId', 1],
  ['tenantId', 1],
  ['entitlements', 'none'],
  ['entitlements', [null]],
  ['subscriptions', {}],
  ['subscriptions', [null]],
  ['source', 3],
  ['sourceCustomer', 'c'],
  ['sourceCustomer.id', 1],
  ['fetchedAt', 1],
  ['sourceUpdatedAt', 1],
  ['entitlements.0.name', 1],
  ['entitlements.0.active', 'false'],
  ['entitlements.0.active', 1],
  ['entitlements.0.until', 1],
  ['entitlements.0.grantingSubscriptionReference', 1],
  ['entitlements.0.grantingSubscriptionReferences', undefined],
  ['entitlements.0.grantingSubscriptionReferences', 'sub-1'],
  ['entitlements.0.grantingSubscriptionReferences', [1]],
  ['entitlements.0.grantingSubscriptionReferences', ['sub-2', 'sub-1']],
  ['entitlements.0.grantingSubscriptionReferences', ['sub-1', 'sub-1']],
  ['entitlements.0.grantingSubscriptionReferences', []],
  ['entitlements.0.grantingSubscriptionReferences', ['sub-0']],
  ['subscriptions.0.subscriptionReference', 1],
  ['subscriptions.0.status', 'bogus'],
  ['subscriptions.0.givesAccess', 'true'],
  ['subscriptions.0.givesAccess', 1],
  ['subscriptions.0.willRenew', 'maybe'],
  ['subscriptions.0.origin', 'moon'],
  ['subscriptions.0.environment', 'staging'],
  ['subscriptions.0.productReference', 1],
  ['subscriptions.0.billingInterval', 1],
  ['subscriptions.0.currentPeriodStart', 1],
  ['subscriptions.0.currentPeriodEnd', 1],
  ['subscriptions.0.accessUntil', 1],
  ['subscriptions.0.billingIssueSince', 1],
  ['subscriptions.0.cancelledAt', 1],
  ['subscriptions.0.refundedAt', 1],
  ['subscriptions.0.managementReference', 1],
  ['nonRenewingPurchases', {}],
  ['nonRenewingPurchases', [null]],
  ['nonRenewingPurchases.0.purchaseReference', 1],
  ['nonRenewingPurchases.0.entitlementNames', undefined],
  ['nonRenewingPurchases.0.entitlementNames', 'pro'],
  ['nonRenewingPurchases.0.entitlementNames', [1]],
  ['nonRenewingPurchases.0.entitlementNames', ['b', 'a']],
  ['nonRenewingPurchases.0.entitlementNames', ['a', 'a']],
  ['nonRenewingPurchases.0.givesAccess', 'true'],
  ['nonRenewingPurchases.0.origin', 'moon'],
  ['nonRenewingPurchases.0.environment', 'staging'],
  ['nonRenewingPurchases.0.productReference', 1],
  ['nonRenewingPurchases.0.purchasedAt', 1],
  ['nonRenewingPurchases.0.accessUntil', 1],
  ['nonRenewingPurchases.0.refundedAt', 1]
]

/** Every path of a field in a snapshot, as the table writes it; lists are walked at their first item. */
function pathOf(snapshot: unknown): string[] {
  const paths: string[] = []
  const walk = (value: unknown, prefix: string): void => {
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 1)) walk(item, `${prefix}.0`)
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        const path = prefix === '' ? key : `${prefix}.${key}`
        paths.push(path)
        walk(child, path)
      }
    }
  }
  walk(snapshot, '')
  return paths
}

describe('isSnapshotFor', () => {
  it('lists in its table every field the fixture holds, at every depth', () => {
    // Scenario: a field added to the model must be added to the fixture, which then must be in the
    // table of wrong values, or this case names the path that is missing.
    const listed = new Set(WRONG.map(([path]) => path))
    expect(pathOf(full()).filter((path) => !listed.has(path))).toEqual([])
  })

  it.each(WRONG)('refuses a snapshot whose %s is %j', (path, wrong) => {
    // Scenario: one field has a value of the wrong type or outside its closed set.
    expect(isSnapshotFor(withField(path, wrong), TENANTED)).toBe(false)
  })

  it.each([
    ['two grantors, sorted, with the decisive one among them', ['sub-1', 'sub-2']],
    ['one grantor that is the decisive one', ['sub-1']]
  ])('accepts an entitlement with %s', (_name, grantors) => {
    // Scenario: the list is sorted, unique and holds the decisive subscription.
    expect(
      isSnapshotFor(withField('entitlements.0.grantingSubscriptionReferences', grantors), TENANTED)
    ).toBe(true)
  })

  it('accepts a snapshot with no list of purchases, which reads as none, and one with an empty list', () => {
    // Scenario: a snapshot with no list of purchases, and one of an account with none.
    const { nonRenewingPurchases: _held, ...without } = full()
    expect(isSnapshotFor(without, TENANTED)).toBe(true)
    expect(isSnapshotFor({ ...full(), nonRenewingPurchases: [] }, TENANTED)).toBe(true)
  })

  it('accepts the snapshot with every field present', () => {
    // Scenario: the control for the table; the fixture itself fits.
    expect(isSnapshotFor(full(), TENANTED)).toBe(true)
  })

  it.each([
    [
      'every nullable field null',
      () => ({
        ...full(),
        sourceCustomer: null,
        sourceUpdatedAt: null,
        entitlements: [
          {
            name: 'pro',
            active: false,
            until: null,
            grantingSubscriptionReference: null,
            grantingSubscriptionReferences: []
          }
        ],
        subscriptions: [
          {
            ...full().subscriptions[0],
            accessUntil: null,
            billingIssueSince: null,
            cancelledAt: null,
            refundedAt: null,
            managementReference: null
          }
        ]
      })
    ],
    ['empty lists', () => ({ ...full(), entitlements: [], subscriptions: [] })],
    [
      'the empty snapshot the library produces',
      () => createEmptySnapshot({ accountId: 'acc-1', tenantId: 'one', source: 's', fetchedAt: T0 })
    ]
  ])('accepts %s', (_name, build) => {
    // Scenario: every legitimate shape of a nullable field and of a list.
    expect(isSnapshotFor(build(), TENANTED)).toBe(true)
  })

  it('accepts a snapshot of an account with no tenant when the tenant is absent', () => {
    // Scenario: the optional field is absent, as the library writes it.
    const { tenantId: _tenant, ...tenantless } = full()
    expect(isSnapshotFor(tenantless, ACCOUNT)).toBe(true)
    expect(
      isSnapshotFor(
        createEmptySnapshot({ accountId: 'acc-1', source: 's', fetchedAt: T0 }),
        ACCOUNT
      )
    ).toBe(true)
  })

  it('accepts what the in-memory store returns after a JSON round trip', async () => {
    // Scenario: a snapshot written to the store and read back, as a cache or a database would hold it.
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    await store.putSnapshot('k', full(), [], T0)
    const read = (await store.getSnapshot('k'))?.snapshot
    expect(isSnapshotFor(JSON.parse(JSON.stringify(read)), TENANTED)).toBe(true)
    expect(isSnapshotFor(read, TENANTED)).toBe(true)
  })

  it.each([null, undefined, 'text', 3, [], true])('refuses %j, which is not an object', (value) => {
    // Scenario: values that are not snapshots at all.
    expect(isSnapshotFor(value, ACCOUNT)).toBe(false)
  })

  it.each([
    ['another account', { ...full(), accountId: 'other' }, TENANTED],
    ['another tenant', { ...full(), tenantId: 'two' }, TENANTED],
    ['no tenant for a tenanted account', { ...full(), tenantId: undefined }, TENANTED],
    ['a tenant for an account with none', full(), ACCOUNT]
  ])('refuses a snapshot of %s', (_name, snapshot, account) => {
    // Scenario: the identity is not the account asked for.
    expect(isSnapshotFor(snapshot, account)).toBe(false)
  })

  it.each([
    ['fetchedAt', 'invalid'],
    ['sourceUpdatedAt', 'later'],
    ['entitlements.0.until', 'not-a-date'],
    ['subscriptions.0.currentPeriodStart', '31 Feb'],
    ['subscriptions.0.accessUntil', 'soon'],
    ['subscriptions.0.billingIssueSince', 'x'],
    ['subscriptions.0.cancelledAt', 'yesterday'],
    ['subscriptions.0.refundedAt', 'never'],
    ['subscriptions.0.currentPeriodEnd', 'end']
  ])('refuses a snapshot whose %s is the text %j', (path, text) => {
    // Scenario: a string field that holds an instant but not a readable one.
    expect(isSnapshotFor(withField(path, text), TENANTED)).toBe(false)
  })

  describe('with a value it cannot read', () => {
    /** A copy of the fixture with one property replaced by a getter that throws. */
    function throwingAt(target: Record<string, unknown>, name: string): Record<string, unknown> {
      return Object.defineProperty({ ...target }, name, {
        enumerable: true,
        get: () => {
          throw new Error('getter broke')
        }
      })
    }

    const proxy = (trap: 'get' | 'has' | 'ownKeys' | 'getPrototypeOf'): unknown =>
      new Proxy(
        {},
        {
          [trap]: () => {
            throw new Error(`${trap} trap broke`)
          }
        }
      )

    it('answers false for a snapshot whose entitlements getter throws', () => {
      // Scenario: reading one top-level field throws.
      expect(isSnapshotFor(throwingAt({ ...full() }, 'entitlements'), TENANTED)).toBe(false)
    })

    it('answers false for a snapshot whose nested active getter throws', () => {
      // Scenario: reading a field of an entitlement throws.
      const entitlement = throwingAt({ ...full().entitlements[0] }, 'active')
      expect(isSnapshotFor({ ...full(), entitlements: [entitlement] }, TENANTED)).toBe(false)
    })

    it.each(['get', 'has', 'ownKeys', 'getPrototypeOf'] as const)(
      'answers false for a proxy whose %s trap throws',
      (trap) => {
        // Scenario: the value is a proxy that throws when the validator touches it.
        expect(isSnapshotFor(proxy(trap), TENANTED)).toBe(false)
        expect(isSnapshotFor({ ...full(), entitlements: [proxy(trap)] }, TENANTED)).toBe(false)
      }
    )
  })
})
