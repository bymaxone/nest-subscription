/**
 * @fileoverview Secret containment, end to end (SEC05, SEC09): sentinel secrets go in through the
 * public root, and every path that serializes, copies, enumerates or inspects what the library
 * holds is swept for them. The sweep lives in `fixtures/sentinel-sweep.ts` so that each later provider is added to it.
 * @layer e2e
 */
import { Secret, resolveOptions } from '@bymax-one/nest-subscription'
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
})
