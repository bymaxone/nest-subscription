/**
 * @fileoverview Secret containment, end to end (SEC05, SEC09): sentinel secrets go in through the
 * public root, and every path that serializes, copies, enumerates or inspects what the library
 * holds is swept for them. The sweep lives in `fixtures/sentinel-sweep.ts` so that each later provider is added to it.
 * @layer e2e
 */
import { Secret, SubscriptionError, resolveOptions } from '@bymax-one/nest-subscription'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore
} from '@bymax-one/nest-subscription/testing'
import {
  expectNoSentinel,
  outputsOf,
  ROTATED_SENTINEL,
  WEBHOOK_SENTINEL
} from './fixtures/sentinel-sweep'

function sentinelOptions(): Parameters<typeof resolveOptions>[0] {
  return {
    source: new FakeSubscriptionSource(),
    store: new InMemorySubscriptionStore(),
    accountResolver: () => null,
    webhookSecret: { current: WEBHOOK_SENTINEL, previous: ROTATED_SENTINEL }
  }
}

describe('secret containment', () => {
  it('shows no secret on any path of the resolved options', () => {
    // Scenario: the resolved options hold two valid webhook secrets.
    const resolved = resolveOptions(sentinelOptions())
    expectNoSentinel(outputsOf(resolved))
  })

  it('shows no secret on any path of the Secret holder itself', () => {
    // Scenario: the holder is swept on its own, as an adapter or a host would hold it.
    expectNoSentinel(outputsOf(new Secret(WEBHOOK_SENTINEL, ROTATED_SENTINEL)))
  })

  it('still returns both secrets to a deliberate read, and accepts either for verification', () => {
    // Scenario: during a rotation a request carrying either value verifies (SEC09).
    const secret = resolveOptions(sentinelOptions()).webhookSecret
    expect(secret?.candidates()).toEqual([WEBHOOK_SENTINEL, ROTATED_SENTINEL])
    expect(secret?.matches(WEBHOOK_SENTINEL)).toBe(true)
    expect(secret?.matches(ROTATED_SENTINEL)).toBe(true)
    expect(secret?.matches('another-value')).toBe(false)
  })

  it('reads back the single value it was given and refuses to hold an unusable one', () => {
    // Scenario: the deliberate read of one value, and a holder built from nothing or from an
    // empty previous value, which would otherwise accept an empty presentation.
    expect(new Secret(WEBHOOK_SENTINEL).reveal()).toBe(WEBHOOK_SENTINEL)
    expect(Secret.from(WEBHOOK_SENTINEL).candidates()).toEqual([WEBHOOK_SENTINEL])
    expect(() => new Secret('')).toThrow(SubscriptionError)
    expect(() => new Secret(WEBHOOK_SENTINEL, '')).toThrow(SubscriptionError)
    expect(new Secret(WEBHOOK_SENTINEL).matches(ROTATED_SENTINEL)).toBe(false)
    const held = new Secret(WEBHOOK_SENTINEL)
    expect(Secret.from(held)).toBe(held)
    expect(Reflect.apply(held.matches, held, [undefined])).toBe(false)
  })

  it('keeps the value out of the error a refused secret raises', () => {
    // Scenario: the refusal of an empty previous value next to a real current one.
    try {
      new Secret(WEBHOOK_SENTINEL, '')
    } catch (error) {
      expectNoSentinel(outputsOf(error as object))
      expect(String(error)).not.toContain(WEBHOOK_SENTINEL)
      return
    }
    throw new Error('the secret was accepted')
  })
})
