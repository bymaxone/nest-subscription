/**
 * @fileoverview Pins the pure fail policy by table: `refuse` never trusts a snapshot that cannot
 * be shown current; `last_known_state` trusts one strictly younger than the tolerance and refuses
 * one aged exactly the tolerance or more, and a missing snapshot, an unknown policy value or an
 * unusable tolerance refuse.
 * @layer core
 */
import { createEmptySnapshot, type SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { applyFailPolicy } from './fail-policy'

const HOUR_MS = 3_600_000
const NOW = new Date('2026-01-02T00:00:00.000Z')

/** A snapshot fetched `ageMs` before NOW. */
function aged(ageMs: number): SubscriptionSnapshot {
  return createEmptySnapshot({
    accountId: 'acc-1',
    source: 'fake',
    fetchedAt: new Date(NOW.getTime() - ageMs).toISOString()
  })
}

describe('applyFailPolicy', () => {
  it.each([
    ['one millisecond younger than the tolerance', HOUR_MS - 1, true],
    ['exactly the tolerance', HOUR_MS, false],
    ['one millisecond older than the tolerance', HOUR_MS + 1, false],
    ['no age at all', 0, true],
    ['a day old', 24 * HOUR_MS, false]
  ])('under last_known_state a snapshot %s is trusted: %s', (_title, ageMs, trusted) => {
    // Scenario: the tolerance is one hour; "younger than" is strict, so the snapshot aged exactly
    // the tolerance is refused and one millisecond less is trusted.
    const outcome = applyFailPolicy({
      policy: 'last_known_state',
      toleranceMs: HOUR_MS,
      snapshot: aged(ageMs),
      now: NOW
    })
    expect(outcome.allow).toBe(trusted)
  })

  it('hands back the snapshot it trusted, so the decision is taken on that very value', () => {
    // Scenario: a trusted outcome carries the snapshot it judged, not a copy or another one.
    const snapshot = aged(HOUR_MS - 1)
    const outcome = applyFailPolicy({
      policy: 'last_known_state',
      toleranceMs: HOUR_MS,
      snapshot,
      now: NOW
    })
    expect(outcome).toEqual({ allow: true, snapshot })
    expect(outcome.allow && outcome.snapshot).toBe(snapshot)
  })

  it('refuses under last_known_state when there is no snapshot', () => {
    // Scenario: the store was unreadable and nothing came from a cache; there is nothing to trust.
    const outcome = applyFailPolicy({
      policy: 'last_known_state',
      toleranceMs: HOUR_MS,
      snapshot: null,
      now: NOW
    })
    expect(outcome).toEqual({ allow: false })
  })

  it.each([0, 1, HOUR_MS - 1, HOUR_MS, 24 * HOUR_MS])(
    'refuses under refuse whatever the age: %d ms',
    (ageMs) => {
      // Scenario: the default policy trusts nothing that cannot be shown current, young or old,
      // even with a tolerance that would trust it under the other policy.
      const outcome = applyFailPolicy({
        policy: 'refuse',
        toleranceMs: 48 * HOUR_MS,
        snapshot: aged(ageMs),
        now: NOW
      })
      expect(outcome).toEqual({ allow: false })
    }
  )

  it('refuses under refuse when there is no snapshot', () => {
    // Scenario: the default policy with an unreadable store.
    const outcome = applyFailPolicy({
      policy: 'refuse',
      toleranceMs: HOUR_MS,
      snapshot: null,
      now: NOW
    })
    expect(outcome).toEqual({ allow: false })
  })

  it('refuses for a policy value that is not one of the two', () => {
    // Scenario: a loosely typed caller passes another string; only the exact value
    // `last_known_state` ever trusts a snapshot.
    const loose = applyFailPolicy as (input: {
      policy: string
      toleranceMs: number
      snapshot: SubscriptionSnapshot | null
      now: Date
    }) => { allow: boolean }
    for (const policy of ['LAST_KNOWN_STATE', 'last-known-state', 'allow', '']) {
      expect(loose({ policy, toleranceMs: HOUR_MS, snapshot: aged(0), now: NOW })).toEqual({
        allow: false
      })
    }
  })

  it.each([Number.NaN, -1, 0])(
    'refuses under last_known_state for a tolerance of %d',
    (tolerance) => {
      // Scenario: a tolerance that is not a positive number trusts nothing, not even a snapshot
      // fetched this instant.
      const outcome = applyFailPolicy({
        policy: 'last_known_state',
        toleranceMs: tolerance,
        snapshot: aged(0),
        now: NOW
      })
      expect(outcome).toEqual({ allow: false })
    }
  )
})
