/**
 * @fileoverview No identifier in any log line or observer payload, end to end: a multi-tenant
 * application with sentinel account, tenant, customer and product values runs a refresh, cached
 * reads, guarded requests, a failing background refresh, a failing source and a reconciliation run
 * with a throwing hook, and everything its logger and observer received is searched for the
 * sentinels. A positive control proves the capture saw the events it is meant to search.
 * @layer e2e
 */
import request from 'supertest'
import { hashAccountKey, encodeAccountKey } from '@bymax-one/nest-subscription'
import type { AccountReference, SubscriptionCache } from '@bymax-one/nest-subscription'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import { ManualClock, assertNoSentinel, createCapture } from '@bymax-one/nest-subscription/testing'

import { ObserverBridge } from '../../src/core/observer/observer-bridge'

import {
  ACCOUNT_HEADER,
  TENANT_HEADER,
  buildGuardedApp,
  snapshotOf,
  type GuardedApp
} from './fixtures/guarded-app'

const DAY_MS = 86_400_000
const SENTINEL_ACCOUNT = 'sentinel-account-7f3a'
const SENTINEL_TENANT = 'sentinel-tenant-91bc'
const SENTINEL_CUSTOMER = 'sentinel-customer-2d4e'
const SENTINEL_PRODUCT = 'sentinel-product-5a6b'
const SENTINEL_HOOK_TEXT = 'sentinel-hook-text-8c1d'
const SENTINEL_SOURCE_TEXT = 'sentinel-source-text-3e9f'
const SENTINELS = [
  SENTINEL_ACCOUNT,
  SENTINEL_TENANT,
  SENTINEL_CUSTOMER,
  SENTINEL_PRODUCT,
  SENTINEL_HOOK_TEXT,
  SENTINEL_SOURCE_TEXT
]
const ACCOUNT: AccountReference = { accountId: SENTINEL_ACCOUNT, tenantId: SENTINEL_TENANT }
const OTHER: AccountReference = { accountId: 'other-account', tenantId: SENTINEL_TENANT }

/** A map-backed host cache. */
function mapCache(): SubscriptionCache {
  const entries = new Map<string, string>()
  return {
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      entries.delete(key)
      return Promise.resolve()
    }
  }
}

/** The state the source reports for the account, with sentinel customer and product values. */
function sourceState(): SubscriptionSnapshot {
  const base = snapshotOf(ACCOUNT, { givesAccess: true, entitlement: 'premium' })
  const [subscription] = base.subscriptions
  return {
    ...base,
    sourceCustomer: { id: SENTINEL_CUSTOMER },
    subscriptions:
      subscription === undefined ? [] : [{ ...subscription, productReference: SENTINEL_PRODUCT }]
  }
}

/** Lets timers, promises and background work settle. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

/** A GET of the guarded route as an account. */
function getAs(built: GuardedApp, account: AccountReference): request.Test {
  return request(built.app.getHttpServer())
    .get('/premium')
    .set(ACCOUNT_HEADER, account.accountId)
    .set(TENANT_HEADER, account.tenantId ?? '')
}

describe('no identifiers', () => {
  it('finds no sentinel in the log lines and observer payloads of a refresh, reads, guarded requests, a failing source and reconciliation', async () => {
    // Scenario: refresh, cached reads, an allowed and a refused request, a failing background
    // refresh, a failing source and a reconciliation run that calls a throwing hook.
    const capture = createCapture()
    let hookWorks = false
    const built = await buildGuardedApp({
      multiTenant: true,
      cache: mapCache(),
      logger: capture.logger,
      observer: capture.observer,
      onChange: () => {
        if (!hookWorks) throw new Error(`hook failed for ${SENTINEL_ACCOUNT} ${SENTINEL_HOOK_TEXT}`)
      }
    })
    built.source.setAccount(ACCOUNT, sourceState())
    // A refresh whose hook throws: the snapshot is stored and its changes stay pending.
    await built.service.refresh(ACCOUNT)
    // Two reads, the second from the host's cache; an allowed and a refused request.
    await built.service.getSnapshot(ACCOUNT)
    await built.service.getSnapshot(ACCOUNT)
    expect((await getAs(built, ACCOUNT)).status).toBe(200)
    expect((await getAs(built, OTHER)).status).toBe(403)
    // A reconciliation run that delivers the pending changes again to the throwing hook.
    await built.service.reconcile({})
    // A stale read starts a background refresh that the failing source ends.
    built.clock.advance(2 * DAY_MS)
    built.source.failNextRead(
      new Error(`source down for ${SENTINEL_ACCOUNT} ${SENTINEL_SOURCE_TEXT}`)
    )
    await built.service.getSnapshot(ACCOUNT)
    await settle()
    // A run that succeeds delivers the changes at last.
    hookWorks = true
    await built.service.reconcile({})

    const methods = new Set(capture.payloads.map((payload) => payload.method))
    expect([...methods].sort()).toStrictEqual([
      'onBackgroundRefreshFailure',
      'onCacheLookup',
      'onChangeDelivery',
      'onGuardDecision',
      'onRefresh',
      'onSourceError'
    ])
    expect(capture.lines.length).toBeGreaterThanOrEqual(3)
    expect(() => assertNoSentinel(capture, SENTINELS)).not.toThrow()
    await built.app.close()
  })

  it('names the account in the log only by its salted hash', async () => {
    // Scenario: the line a failing hook produces carries the hash of the account key and nothing
    // of the account or tenant.
    const capture = createCapture()
    const built = await buildGuardedApp({
      multiTenant: true,
      logger: capture.logger,
      onChange: () => {
        throw new Error(SENTINEL_HOOK_TEXT)
      }
    })
    built.source.setAccount(ACCOUNT, sourceState())
    await built.service.refresh(ACCOUNT)
    expect(capture.lines).toStrictEqual([
      `The change hook failed; its changes stay pending and are delivered again (account ${hashAccountKey(encodeAccountKey(ACCOUNT))}): unclassified.`
    ])
    await built.app.close()
  })

  it('delivers the webhook outcome payload with an outcome and a duration and nothing else', () => {
    // Scenario: the receiver reports a webhook through the bridge; the payload is closed.
    const capture = createCapture()
    const clock = new ManualClock('2026-01-01T00:00:00.000Z')
    const bridge = new ObserverBridge(capture.observer, clock)
    const startedAt = bridge.mark()
    clock.advance(15)
    bridge.webhook('duplicate', startedAt)
    expect(capture.payloads).toStrictEqual([
      { method: 'onWebhook', payload: { outcome: 'duplicate', durationMs: 15 } }
    ])
  })

  it('reports a webhook to an observer that does not want it without building anything', () => {
    // Scenario: an observer with no `onWebhook`; the report is a no-op and reads no clock.
    const clock = new ManualClock('2026-01-01T00:00:00.000Z')
    const now = jest.spyOn(clock, 'now')
    new ObserverBridge({}, clock).webhook('processed', 0)
    expect(now).not.toHaveBeenCalled()
  })

  it('refuses a sweep with no sentinel or an empty one, which would pass or fail for nothing', () => {
    // Scenario: an empty list and an empty string are misuse, not a clean result.
    const capture = createCapture()
    expect(() => assertNoSentinel(capture, [])).toThrow(/at least one sentinel/)
    expect(() => assertNoSentinel(capture, [''])).toThrow(/at least one sentinel/)
  })

  it.each([
    ['a Map key', 'sentinel-planted', new Map([['sentinel-planted', 1]])],
    ['a Map value', 'sentinel-planted', new Map([[1, 'sentinel-planted']])],
    ['a Set member', 'sentinel-planted', new Set(['sentinel-planted'])],
    ['a BigInt', '12345678901234567890', { count: 12345678901234567890n }],
    ['a string with a quote and a newline', 'sentinel"planted\n', { source: 'sentinel"planted\n' }]
  ])('finds a planted sentinel held as %s', (_where, sentinel, payload) => {
    // Scenario: the sentinel sits in one place of the payload's structure; the walk reaches it.
    const capture = createCapture()
    capture.observer.onWebhook?.(payload as never)
    expect(() => assertNoSentinel(capture, [sentinel])).toThrow(/found in observer payload 0/)
  })

  it('finds a planted sentinel beside a reference to the payload itself', () => {
    // Scenario: the payload contains itself; the search ends and still reaches the string.
    const loop: Record<string, unknown> = { deep: ['sentinel-planted'] }
    loop['self'] = loop
    const capture = createCapture()
    capture.observer.onWebhook?.(loop as never)
    expect(() => assertNoSentinel(capture, ['sentinel-planted'])).toThrow(/found in observer/)
  })

  it('passes payloads of functions, symbols, null and undefined that hold no sentinel', () => {
    // Scenario: values with no text are walked without failing.
    const capture = createCapture()
    capture.observer.onWebhook?.({
      run: () => 1,
      tag: Symbol('x'),
      none: null,
      nothing: undefined
    } as never)
    expect(() => assertNoSentinel(capture, ['sentinel-planted'])).not.toThrow()
  })

  it('detects an identifier when one is planted, so the sweep is not vacuous', () => {
    // Scenario: a sentinel put into a log line and into a payload fails the assertion.
    const inLine = createCapture()
    inLine.logger.warn(`failed for ${SENTINEL_ACCOUNT}`)
    const inPayload = createCapture()
    inPayload.observer.onSourceError?.({ source: SENTINEL_TENANT, durationMs: 1 })
    expect(() => assertNoSentinel(inLine, SENTINELS)).toThrow(/found in log line 0/)
    expect(() => assertNoSentinel(inPayload, SENTINELS)).toThrow(/found in observer payload 0/)
  })
})
