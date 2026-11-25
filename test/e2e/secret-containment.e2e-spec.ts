/**
 * @fileoverview Secret containment, end to end (SEC05, SEC09): sentinel secrets go in through the
 * public root, and every path that serializes, copies, enumerates or inspects what the library
 * holds is swept for them. The sweep lives in `fixtures/sentinel-sweep.ts` so that each later provider is added to it.
 * @layer e2e
 */
import { inspect } from 'node:util'

import { Test } from '@nestjs/testing'
import {
  Secret,
  SubscriptionError,
  SubscriptionModule,
  EntitlementGuard,
  SubscriptionService,
  resolveOptions
} from '@bymax-one/nest-subscription'
import { InMemorySubscriptionStore } from '@bymax-one/nest-subscription/testing'
import { SnapshotRefresher } from '../../src/core/refresh/snapshot-refresher'
import { credentialedSource } from './fixtures/credentialed-source'
import {
  expectNoSentinel,
  outputsOf,
  ROTATED_SENTINEL,
  WEBHOOK_SENTINEL
} from './fixtures/sentinel-sweep'

function sentinelOptions(): Parameters<typeof resolveOptions>[0] {
  return {
    source: credentialedSource(),
    store: new InMemorySubscriptionStore(),
    accountResolver: () => null
  }
}

describe('secret containment', () => {
  it('shows no secret on any path of the resolved options', () => {
    // Scenario: the resolved options hold a source whose credential is a rotation pair in a Secret.
    // The sweep reaches the Secret (its placeholder is printed) and finds no value.
    const resolved = resolveOptions(sentinelOptions())
    expectNoSentinel(outputsOf(resolved))
    expect(JSON.stringify(resolved)).toContain('[Secret]')
    expect(inspect(resolved, { depth: null })).toContain('[Secret]')
  })

  it('shows no secret on any path of the service and the refresher the module provides', async () => {
    // Scenario: an application boots with the credentialed source; the service and the refresher
    // hold it, and a sweep of each, after a refresh, finds no value.
    const app = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRoot({
          source: credentialedSource(),
          store: new InMemorySubscriptionStore(),
          accountResolver: () => null
        })
      ]
    }).compile()
    const service = app.get(SubscriptionService)
    await service.refresh({ accountId: 'acc-1' })
    expectNoSentinel(outputsOf(service))
    expectNoSentinel(outputsOf(app.get(SnapshotRefresher)))
    expectNoSentinel(outputsOf(app.get(EntitlementGuard)))
    expectNoSentinel(outputsOf(await service.getSnapshot({ accountId: 'acc-1' })))
    expect(inspect(service, { depth: null, showHidden: true })).toContain('[Secret]')
    await app.close()
  })

  it('shows no secret on any path of the Secret holder itself', () => {
    // Scenario: the holder is swept on its own, as an adapter or a host would hold it.
    expectNoSentinel(outputsOf(new Secret(WEBHOOK_SENTINEL, ROTATED_SENTINEL)))
  })

  it('still returns both secrets to a deliberate read, and accepts either for verification', () => {
    // Scenario: during a rotation a request carrying either value verifies (SEC09).
    const secret = credentialedSource().credential
    expect(secret.candidates()).toEqual([WEBHOOK_SENTINEL, ROTATED_SENTINEL])
    expect(secret.matches(WEBHOOK_SENTINEL)).toBe(true)
    expect(secret.matches(ROTATED_SENTINEL)).toBe(true)
    expect(secret.matches('another-value')).toBe(false)
  })

  it('reads back the single value it was given and refuses to hold an unusable one', () => {
    // Scenario: the deliberate read of one value, and a holder built from nothing or from an
    // empty previous value, which would otherwise accept an empty presentation.
    expect(new Secret(WEBHOOK_SENTINEL).reveal()).toBe(WEBHOOK_SENTINEL)
    expect(Secret.from(WEBHOOK_SENTINEL).candidates()).toEqual([WEBHOOK_SENTINEL])
    expect(
      Secret.from({ current: WEBHOOK_SENTINEL, previous: ROTATED_SENTINEL }).candidates()
    ).toEqual([WEBHOOK_SENTINEL, ROTATED_SENTINEL])
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
