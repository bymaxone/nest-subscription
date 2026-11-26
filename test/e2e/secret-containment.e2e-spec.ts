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
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'
import { InMemorySubscriptionStore } from '@bymax-one/nest-subscription/testing'
import { SnapshotRefresher } from '../../src/core/refresh/snapshot-refresher'
import { credentialedSource } from './fixtures/credentialed-source'
import { startStandIn } from './fixtures/revenuecat-stand-in'
import {
  expectNoSentinel,
  outputsOf,
  ROTATED_SENTINEL,
  V1_SENTINEL,
  WEBHOOK_SENTINEL
} from './fixtures/sentinel-sweep'

function sentinelOptions(): Parameters<typeof resolveOptions>[0] {
  return {
    source: credentialedSource(),
    store: new InMemorySubscriptionStore(),
    accountResolver: () => null
  }
}

/** Runs the capability query and each management operation on the fixture's subscription. */
async function runManagement(
  service: SubscriptionService,
  account: { accountId: string }
): Promise<unknown[]> {
  const reference = 'sub_PLACEHOLDER_1'
  const calls = [
    () => service.getCapabilities(account, reference),
    () => service.stopRenewal(account, reference),
    () => service.resume(account, reference),
    () => service.changeProduct(account, reference, 'product_PLACEHOLDER_annual'),
    () => service.extend(account, reference, { days: 3, reason: 'other' }),
    () => service.refund(account, reference)
  ]
  const results: unknown[] = []
  for (const call of calls) results.push(await call().catch((error: unknown) => error))
  return results
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

  it('shows no secret on any path of the RevenueCat source, the options and the service that holds it', async () => {
    // Scenario: D26: the adapter holds an API key, a webhook authorization and a signing secret,
    // each a rotation pair; the module options hold none, and a sweep of the source, of the
    // resolved options and of the service after a read finds no value.
    const source = revenueCatSource({
      projectId: 'proj_PLACEHOLDER',
      apiKey: { current: WEBHOOK_SENTINEL, previous: ROTATED_SENTINEL },
      apiKeyV1: { current: V1_SENTINEL },
      webhookAuthorization: { current: WEBHOOK_SENTINEL, previous: ROTATED_SENTINEL },
      webhookSigningSecret: { current: WEBHOOK_SENTINEL, previous: ROTATED_SENTINEL },
      baseUrl: 'http://127.0.0.1:9/v2',
      fetch: () => Promise.reject(new TypeError('the source is down'))
    })
    const options = resolveOptions({
      source,
      store: new InMemorySubscriptionStore(),
      accountResolver: () => null
    })
    expectNoSentinel(outputsOf(source))
    expectNoSentinel(outputsOf(options))
    const app = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRoot({
          source,
          store: new InMemorySubscriptionStore(),
          accountResolver: () => null
        })
      ]
    }).compile()
    const service = app.get(SubscriptionService)
    await service.refresh({ accountId: 'acc-1' }).catch(() => undefined)
    expectNoSentinel(outputsOf(service))
    expect(Object.keys(source)).toEqual(['name'])
    await app.close()
  })

  it('shows no secret in what any management operation returns or raises, or in the adapter and service afterwards', async () => {
    // Scenario: SEC05: the adapter holds a rotation pair as its API key and talks to the stand-in,
    // which refuses the operations with a body that holds the key; nothing returned, raised or
    // held shows it.
    const stand = await startStandIn(WEBHOOK_SENTINEL)
    stand.serveFixture('customer_a', 'active-subscription')
    const source = revenueCatSource({
      projectId: 'proj_PLACEHOLDER',
      apiKey: { current: WEBHOOK_SENTINEL, previous: ROTATED_SENTINEL },
      apiKeyV1: V1_SENTINEL,
      baseUrl: stand.baseUrl
    })
    const app = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRoot({
          source,
          store: new InMemorySubscriptionStore(),
          accountResolver: () => null
        })
      ]
    }).compile()
    const service = app.get(SubscriptionService)
    await service.refresh({ accountId: 'customer_a' })
    stand.respondWith((request) =>
      request.method === 'POST'
        ? {
            status: 409,
            body: { message: `${WEBHOOK_SENTINEL} ${ROTATED_SENTINEL} ${V1_SENTINEL}` }
          }
        : undefined
    )
    const results = await runManagement(service, { accountId: 'customer_a' })
    expect(results.filter((result) => result instanceof SubscriptionError).length).toBeGreaterThan(
      0
    )
    for (const result of results) {
      expect(JSON.stringify(result) + String(result)).not.toContain(WEBHOOK_SENTINEL)
      expect(JSON.stringify(result) + String(result)).not.toContain(ROTATED_SENTINEL)
      expect(JSON.stringify(result) + String(result)).not.toContain(V1_SENTINEL)
      if (typeof result === 'object' && result !== null) expectNoSentinel(outputsOf(result))
    }
    expectNoSentinel(outputsOf(source))
    expectNoSentinel(outputsOf(service))
    await app.close()
    await stand.close()
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
