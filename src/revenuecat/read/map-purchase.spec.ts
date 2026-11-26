/**
 * @fileoverview Pins how one parsed purchase becomes a record: when it gives access, which
 * entitlements it names, when access ends, and the refund reading, at the boundaries each rule has.
 * @layer revenuecat
 */
import { contestedBy, NOTHING_CONTESTED } from './contested'
import { mapPurchase } from './map-purchase'
import type { ParsedEntitlement } from './parse-customer'
import type { ParsedPurchase } from './parse-purchases'

const NOW = '2026-11-25T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const DAY = 86_400_000

function parsed(overrides: Partial<ParsedPurchase> = {}): ParsedPurchase {
  return {
    id: 'p1',
    status: 'owned',
    store: 'app_store',
    environment: 'production',
    productId: 'product_1',
    purchasedAt: NOW_MS - DAY,
    entitlements: [],
    entitlementsIncomplete: false,
    ...overrides
  }
}

const premium: ParsedEntitlement = { id: 'e1', name: 'premium' }
const extra: ParsedEntitlement = { id: 'e2', name: 'extra' }

describe('mapPurchase', () => {
  it('holds nothing for a purchase that grants no entitlement', () => {
    // Scenario: D31: a consumable grants nothing and is not held.
    expect(mapPurchase(parsed(), [], new Map(), NOTHING_CONTESTED, NOW)).toBeNull()
  })

  it('gives access with no end to an owned purchase whose entitlement is active with no expiry', () => {
    // Scenario: a lifetime grant.
    expect(
      mapPurchase(parsed(), [premium], new Map([['e1', null]]), NOTHING_CONTESTED, NOW)
    ).toStrictEqual({
      purchaseReference: 'p1',
      entitlementNames: ['premium'],
      givesAccess: true,
      origin: 'app_store',
      environment: 'production',
      productReference: 'product_1',
      purchasedAt: new Date(NOW_MS - DAY).toISOString(),
      accessUntil: null,
      refundedAt: null
    })
  })

  it('ends access when the active entitlement ends', () => {
    // Scenario: a term pass.
    const end = NOW_MS + 30 * DAY
    expect(
      mapPurchase(parsed(), [premium], new Map([['e1', end]]), NOTHING_CONTESTED, NOW)?.accessUntil
    ).toBe(new Date(end).toISOString())
  })

  it('ends access at the latest of several active entitlements, and never ends it when one has no end', () => {
    // Scenario: one purchase that grants two entitlements with different ends.
    const both = [premium, extra]
    expect(
      mapPurchase(
        parsed(),
        both,
        new Map([
          ['e1', NOW_MS + DAY],
          ['e2', NOW_MS + 3 * DAY]
        ]),
        NOTHING_CONTESTED,
        NOW
      )?.accessUntil
    ).toBe(new Date(NOW_MS + 3 * DAY).toISOString())
    expect(
      mapPurchase(
        parsed(),
        both,
        new Map([
          ['e1', NOW_MS + DAY],
          ['e2', null]
        ]),
        NOTHING_CONTESTED,
        NOW
      )?.accessUntil
    ).toBeNull()
    expect(
      mapPurchase(
        parsed(),
        both,
        new Map([
          ['e2', NOW_MS + DAY],
          ['e1', NOW_MS + 3 * DAY]
        ]),
        NOTHING_CONTESTED,
        NOW
      )?.accessUntil
    ).toBe(new Date(NOW_MS + 3 * DAY).toISOString())
  })

  it('names only the entitlements that are active while it gives access, sorted and once each', () => {
    // Scenario: one of the two entitlements is not active; it is not granted.
    const duplicated = [extra, premium, { id: 'e1', name: 'premium' }]
    const record = mapPurchase(
      parsed(),
      duplicated,
      new Map([['e1', null]]),
      NOTHING_CONTESTED,
      NOW
    )
    expect(record?.entitlementNames).toStrictEqual(['premium'])
    expect(
      mapPurchase(
        parsed(),
        duplicated,
        new Map([
          ['e1', null],
          ['e2', null]
        ]),
        NOTHING_CONTESTED,
        NOW
      )?.entitlementNames
    ).toStrictEqual(['extra', 'premium'])
  })

  it('names every entitlement, sorted, when it gives no access', () => {
    // Scenario: the host can still see what the purchase would grant.
    const record = mapPurchase(
      parsed({ status: 'refunded' }),
      [premium, extra],
      new Map(),
      NOTHING_CONTESTED,
      NOW
    )
    expect(record).toMatchObject({
      givesAccess: false,
      entitlementNames: ['extra', 'premium'],
      accessUntil: null
    })
  })

  it.each([
    ['refunded', 'refunded'],
    ['pending', 'owned'],
    [null, 'owned']
  ])(
    'gives no access to a purchase with status %j even though its entitlement is active',
    (status, _control) => {
      // Scenario: only an owned purchase gives access.
      expect(
        mapPurchase(parsed({ status }), [premium], new Map([['e1', null]]), NOTHING_CONTESTED, NOW)
          ?.givesAccess
      ).toBe(false)
    }
  )

  it('gives no access to an owned purchase none of whose entitlements is active', () => {
    // Scenario: the term ended; the source no longer lists it.
    expect(
      mapPurchase(parsed(), [premium], new Map([['other', null]]), NOTHING_CONTESTED, NOW)
        ?.givesAccess
    ).toBe(false)
  })

  it('does not match an entitlement that has no identifier against the active list', () => {
    // Scenario: without an id there is nothing to look up.
    expect(
      mapPurchase(
        parsed(),
        [{ id: null, name: 'premium' }],
        new Map([['', null]]),
        NOTHING_CONTESTED,
        NOW
      )?.givesAccess
    ).toBe(false)
  })

  it('reads a refund as the purchase instant, the same on every read', () => {
    // Scenario: the API states no refund instant; the value must not change between reads.
    const first = mapPurchase(
      parsed({ status: 'refunded' }),
      [premium],
      new Map(),
      NOTHING_CONTESTED,
      NOW
    )
    const later = mapPurchase(
      parsed({ status: 'refunded' }),
      [premium],
      new Map(),
      NOTHING_CONTESTED,
      '2026-12-25T12:00:00.000Z'
    )
    expect(first?.refundedAt).toBe(new Date(NOW_MS - DAY).toISOString())
    expect(later?.refundedAt).toBe(first?.refundedAt)
    expect(
      mapPurchase(parsed({ status: 'owned' }), [premium], new Map(), NOTHING_CONTESTED, NOW)
        ?.refundedAt
    ).toBeNull()
  })

  it('stands the instant of the read in for a purchase instant the source did not send', () => {
    // Scenario: no `purchased_at`.
    const record = mapPurchase(
      parsed({ purchasedAt: null, status: 'refunded' }),
      [premium],
      new Map(),
      NOTHING_CONTESTED,
      NOW
    )
    expect(record).toMatchObject({ purchasedAt: NOW, refundedAt: NOW })
  })

  it('maps the store, the environment and the product as the source gave them', () => {
    // Scenario: the fields read straight from the source.
    expect(
      mapPurchase(
        parsed({ store: 'play_store', environment: 'sandbox', productId: null }),
        [premium],
        new Map(),
        NOTHING_CONTESTED,
        NOW
      )
    ).toMatchObject({ origin: 'play_store', environment: 'sandbox', productReference: '' })
  })

  describe('with an entitlement that a sandbox grantor also grants', () => {
    const both = [premium, extra]
    const active = new Map<string, number | null>([
      ['e1', null],
      ['e2', NOW_MS + DAY]
    ])

    it('gives no access and no end when the only entitlement is contested by identifier', () => {
      // Scenario: the active list shows it, but a sandbox grantor shares it.
      const record = mapPurchase(
        parsed(),
        [premium],
        new Map([['e1', null]]),
        contestedBy([{ id: 'e1', name: 'premium' }]),
        NOW
      )
      expect(record).toMatchObject({
        givesAccess: false,
        accessUntil: null,
        entitlementNames: ['premium']
      })
    })

    it('gives no access when the sandbox grantor names the entitlement without an identifier', () => {
      // Scenario: the match is by name, since the grantor gave no identifier.
      const record = mapPurchase(
        parsed(),
        [premium],
        new Map([['e1', null]]),
        contestedBy([{ id: null, name: 'premium' }]),
        NOW
      )
      expect(record?.givesAccess).toBe(false)
    })

    it('does not match by name a grantor that gave another identifier', () => {
      // Scenario: the name is only a fallback for a grantor without an identifier.
      const record = mapPurchase(
        parsed(),
        [premium],
        new Map([['e1', null]]),
        contestedBy([{ id: 'other', name: 'premium' }]),
        NOW
      )
      expect(record?.givesAccess).toBe(true)
    })

    it('keeps access through the entitlement that is not contested, with the end of that one', () => {
      // Scenario: one of two entitlements is contested; the other alone gives access and ends it.
      const record = mapPurchase(
        parsed(),
        both,
        active,
        contestedBy([{ id: 'e1', name: 'premium' }]),
        NOW
      )
      expect(record).toMatchObject({
        givesAccess: true,
        entitlementNames: ['extra'],
        accessUntil: new Date(NOW_MS + DAY).toISOString()
      })
    })

    it('gives no access when both entitlements are contested, and still names both', () => {
      // Scenario: nothing is left to keep it active.
      const record = mapPurchase(
        parsed(),
        both,
        active,
        contestedBy([
          { id: 'e1', name: 'premium' },
          { id: 'e2', name: 'extra' }
        ]),
        NOW
      )
      expect(record).toMatchObject({
        givesAccess: false,
        accessUntil: null,
        entitlementNames: ['extra', 'premium']
      })
    })
  })
})
