/**
 * @fileoverview Pins the service reads: an answer comes from the store and never from the source,
 * an unknown account is a value, the snapshot comes back frozen with its age, the tenant is part of
 * every key, and an on-demand refresh goes through the refresher. The fake source's read counter
 * proves when the source is and is not called.
 * @layer core
 */
import { Logger } from '@nestjs/common'
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  resolveEntitlements,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { resolveOptions } from './options/resolve-options'
import { SnapshotCache } from './cache/snapshot-cache'
import type { SubscriptionObserver } from './observer/observer.types'
import type { SubscriptionCache } from './options/subscription-options.types'
import { Reconciler } from './reconciliation/reconciler'
import { SnapshotRefresher } from './refresh/snapshot-refresher'
import { SubscriptionService } from './subscription.service'
import { ObserverBridge } from './observer/observer-bridge'

const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const T0 = '2026-01-01T00:00:00.000Z'

/** A subscription that does or does not give access, granting the entitlement `pro`. */
function subscription(givesAccess: boolean): SubscriptionRecord {
  return {
    subscriptionReference: 'sub-1',
    status: givesAccess ? 'active' : 'expired',
    givesAccess,
    willRenew: 'yes',
    origin: 'web',
    environment: 'production',
    productReference: 'pro',
    billingInterval: 'month',
    currentPeriodStart: T0,
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    accessUntil: '2026-02-01T00:00:00.000Z',
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: null
  }
}

/** The snapshot the source reports for an account whose `pro` entitlement is or is not given. */
function snapshotOf(account: AccountReference, givesAccess: boolean): SubscriptionSnapshot {
  const record = subscription(givesAccess)
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: T0
    }),
    entitlements: resolveEntitlements([record], new Map([['sub-1', ['pro']]])).entitlements,
    subscriptions: [record],
    sourceCustomer: { id: `customer-of-${account.tenantId ?? ''}-${account.accountId}` },
    sourceUpdatedAt: T0
  }
}

/** What a test may change about the service it builds. */
interface SetupOptions {
  readonly multiTenant?: boolean
  readonly maxSnapshotAgeMs?: number
  readonly observer?: SubscriptionObserver
  readonly cache?: SubscriptionCache
}

/** The service over a fresh source, store and clock. */
function setup(extra: SetupOptions = {}): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  refresher: SnapshotRefresher
  service: SubscriptionService
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const options = resolveOptions({ source, store, clock, accountResolver: () => null, ...extra })
  const snapshotCache =
    extra.cache === undefined
      ? null
      : new SnapshotCache(extra.cache, 30_000, clock, new ObserverBridge(null, clock))
  const refresher = new SnapshotRefresher(
    source,
    store,
    clock,
    snapshotCache,
    null,
    new ObserverBridge(null, clock)
  )
  return {
    source,
    store,
    clock,
    refresher,
    service: new SubscriptionService(
      source,
      store,
      clock,
      options,
      refresher,
      snapshotCache,
      new Reconciler(store, clock, refresher, options, null),
      new ObserverBridge(options.observer, clock)
    )
  }
}

describe('SubscriptionService reads', () => {
  it('answers false for an entitlement when the clock gives an unreadable instant', async () => {
    // Scenario: a held entitlement with no end is stored; the clock then returns an invalid date.
    // The service cannot tell the entitlement is current, so it is not held.
    const { source, clock, service } = setup()
    const held = snapshotOf(ACCOUNT, true)
    source.setAccount(ACCOUNT, {
      ...held,
      entitlements: held.entitlements.map((entitlement) => ({ ...entitlement, until: null }))
    })
    await service.refresh(ACCOUNT)
    expect(await service.hasEntitlement(ACCOUNT, 'pro')).toBe(true)
    jest.spyOn(clock, 'now').mockReturnValue(new Date(Number.NaN))
    expect(await service.hasEntitlement(ACCOUNT, 'pro')).toBe(false)
  })

  it('starts a background refresh when the clock gives an unreadable instant', async () => {
    // Scenario: a stored snapshot is never trusted as current under an unreadable clock, so the
    // read starts the refresh it would start for a stale one.
    const { source, clock, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await service.refresh(ACCOUNT)
    const reads = source.totalReads
    jest.spyOn(clock, 'now').mockReturnValue(new Date(Number.NaN))
    await service.getSnapshot(ACCOUNT)
    expect(source.totalReads).toBe(reads + 1)
  })

  it('answers a snapshot from the store and carries its age, without calling the source', async () => {
    // Scenario: a snapshot stored a minute ago; the read returns it, one minute old, with no read
    // of the source.
    const { source, clock, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await service.refresh(ACCOUNT)
    const readsAfterRefresh = source.totalReads
    clock.advance(60_000)
    const snapshot = await service.getSnapshot(ACCOUNT)
    expect(snapshot.ageMs).toBe(60_000)
    expect(snapshot.sourceCustomer?.id).toBe('customer-of--acc-1')
    expect(source.totalReads).toBe(readsAfterRefresh)
  })

  it('answers both reads while a source read is held and never waits for it', async () => {
    // Scenario: the next source read is held and never released; both reads still resolve, and
    // the source is not called at all.
    const { source, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await service.refresh(ACCOUNT)
    source.delayNextRead()
    const reads = source.totalReads
    await expect(service.getSnapshot(ACCOUNT)).resolves.toMatchObject({ accountId: 'acc-1' })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    expect(source.totalReads).toBe(reads)
  })

  it('answers an account with nothing stored as an empty snapshot and false, not an error', async () => {
    // Scenario: an account no refresh has stored; the source is not asked.
    const { source, service } = setup()
    const snapshot = await service.getSnapshot(ACCOUNT)
    expect(snapshot).toMatchObject({
      accountId: 'acc-1',
      source: 'fake',
      entitlements: [],
      subscriptions: [],
      sourceCustomer: null,
      sourceUpdatedAt: null,
      ageMs: 0
    })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
    expect(source.totalReads).toBe(0)
  })

  it('carries the tenant on the empty snapshot of an account that has one', async () => {
    // Scenario: a multi-tenant host asks about an unknown account.
    const { service } = setup({ multiTenant: true })
    const snapshot = await service.getSnapshot({ tenantId: 't1', accountId: 'acc-1' })
    expect(snapshot.tenantId).toBe('t1')
  })

  it.each([
    [true, true],
    [false, false]
  ])(
    'answers an entitlement from the active flag the source gave (access flag %s gives %s)',
    async (givesAccess, expected) => {
      // Scenario: the entitlement is active exactly when the subscription's access flag is.
      const { source, service } = setup()
      source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, givesAccess))
      await service.refresh(ACCOUNT)
      await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(expected)
    }
  )

  it.each([
    ['null, a lifetime grant', null, true],
    ['an instant after now', '2026-01-01T00:00:01.000Z', true],
    ['exactly now', '2026-01-01T00:00:00.000Z', false],
    ['an instant before now', '2025-12-31T23:59:59.999Z', false]
  ])(
    'answers an active entitlement whose until is %s with %s on the injected clock',
    async (_name, until, expected) => {
      // Scenario: the active flag is true; only the until instant against the injected now differs.
      const { store, service } = setup()
      const entitlement = {
        name: 'pro',
        active: true,
        until,
        grantingSubscriptionReference: null,
        grantingSubscriptionReferences: []
      }
      await store.putSnapshot(
        encodeAccountKey(ACCOUNT),
        { ...snapshotOf(ACCOUNT, true), entitlements: [entitlement] },
        [],
        T0
      )
      await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(expected)
    }
  )

  it('moves from true to false as the injected clock passes the until instant', async () => {
    // Scenario: until is ten seconds ahead; the answer flips when the clock reaches it.
    const { store, clock, service } = setup()
    const entitlement = {
      name: 'pro',
      active: true,
      until: '2026-01-01T00:00:10.000Z',
      grantingSubscriptionReference: null,
      grantingSubscriptionReferences: []
    }
    await store.putSnapshot(
      encodeAccountKey(ACCOUNT),
      { ...snapshotOf(ACCOUNT, true), entitlements: [entitlement] },
      [],
      T0
    )
    clock.advance(9999)
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    clock.advance(1)
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
  })

  it('answers false, and does not reject, for an active entitlement whose until cannot be read', async () => {
    // Scenario: a host store holds an entitlement whose until is not an instant.
    const { store, service } = setup()
    const entitlement = {
      name: 'pro',
      active: true,
      until: 'not-a-date',
      grantingSubscriptionReference: null,
      grantingSubscriptionReferences: []
    }
    await store.putSnapshot(
      encodeAccountKey(ACCOUNT),
      { ...snapshotOf(ACCOUNT, true), entitlements: [entitlement] },
      [],
      T0
    )
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
  })

  it('answers false for an entitlement the account does not have', async () => {
    // Scenario: the account has `pro` and is asked about `team`.
    const { source, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await service.refresh(ACCOUNT)
    await expect(service.hasEntitlement(ACCOUNT, 'team')).resolves.toBe(false)
  })

  it('refreshes through the refresher and returns what is stored, aged and frozen', async () => {
    // Scenario: refresh reads the source once, stores the result and returns it.
    const { source, store, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    const refreshed = await service.refresh(ACCOUNT)
    expect(source.readCount(ACCOUNT)).toBe(1)
    expect(refreshed.ageMs).toBe(0)
    expect(Object.isFrozen(refreshed)).toBe(true)
    const stored = (await store.getSnapshot(encodeAccountKey(ACCOUNT)))?.snapshot
    expect({ ...refreshed, ageMs: undefined }).toEqual({ ...stored, ageMs: undefined })
  })

  it('collapses a hundred concurrent on-demand refreshes into one source call', async () => {
    // Scenario: a hundred refreshes of one account while the first read is held.
    const { source, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    const release = source.delayNextRead()
    const callers = Array.from({ length: 100 }, () => service.refresh(ACCOUNT))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    release()
    await Promise.all(callers)
    expect(source.readCount(ACCOUNT)).toBe(1)
  })

  it('surfaces a source failure on refresh as the source-unavailable code', async () => {
    // Scenario: the source cannot be read; the store keeps what it had.
    const { source, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await service.refresh(ACCOUNT)
    source.failNextRead(new Error('down'))
    await expect(service.refresh(ACCOUNT)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
  })

  it('returns snapshots a caller cannot use to change what is stored', async () => {
    // Scenario: the caller tries to change the result in place; the next read is unchanged.
    const { source, service } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await service.refresh(ACCOUNT)
    const first = await service.getSnapshot(ACCOUNT)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.entitlements)).toBe(true)
    expect(Reflect.set(first.entitlements[0] ?? {}, 'active', false)).toBe(false)
    expect(Reflect.set(first, 'accountId', 'other')).toBe(false)
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    expect((await service.getSnapshot(ACCOUNT)).accountId).toBe('acc-1')
  })

  it('never returns the data of another tenant for the same account identifier', async () => {
    // Scenario: acc-1 exists under tenant one only; tenant two reads an empty snapshot.
    const { source, service } = setup({ multiTenant: true })
    const one: AccountReference = { tenantId: 'one', accountId: 'acc-1' }
    const two: AccountReference = { tenantId: 'two', accountId: 'acc-1' }
    source.setAccount(one, snapshotOf(one, true))
    await service.refresh(one)
    await expect(service.hasEntitlement(one, 'pro')).resolves.toBe(true)
    await expect(service.hasEntitlement(two, 'pro')).resolves.toBe(false)
    expect((await service.getSnapshot(two)).sourceCustomer).toBeNull()
  })

  it('never returns the data of another account when identifiers hold the key delimiter', async () => {
    // Scenario: ("a:b", "c") is stored; ("a", "b:c") reads nothing.
    const { source, service } = setup({ multiTenant: true })
    const stored: AccountReference = { tenantId: 'a:b', accountId: 'c' }
    const other: AccountReference = { tenantId: 'a', accountId: 'b:c' }
    source.setAccount(stored, snapshotOf(stored, true))
    await service.refresh(stored)
    await expect(service.hasEntitlement(stored, 'pro')).resolves.toBe(true)
    await expect(service.hasEntitlement(other, 'pro')).resolves.toBe(false)
  })

  it.each(['getSnapshot', 'refresh'] as const)(
    'refuses %s without a tenant in a multi-tenant configuration, before touching the source',
    async (method) => {
      // Scenario: the host serves several tenants and the caller passes none.
      const { source, service } = setup({ multiTenant: true })
      const error = await service[method]({ accountId: 'acc-1' }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SubscriptionError)
      expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
      expect(source.totalReads).toBe(0)
    }
  )

  it('refuses hasEntitlement without a tenant, and a blank tenant, in a multi-tenant configuration', async () => {
    // Scenario: no tenant and a blank tenant are both a missing tenant.
    const { service } = setup({ multiTenant: true })
    for (const tenantId of [undefined, '', '  ']) {
      const error = await service
        .hasEntitlement({ tenantId, accountId: 'acc-1' }, 'pro')
        .catch((e: unknown) => e)
      expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    }
  })

  it('accepts a missing tenant when the host is not multi-tenant', async () => {
    // Scenario: the default configuration serves one tenant and needs none.
    const { service } = setup()
    await expect(service.getSnapshot({ accountId: 'acc-1' })).resolves.toMatchObject({
      accountId: 'acc-1'
    })
  })

  it('refuses a blank account identifier as invalid input', async () => {
    // Scenario: a blank identifier never reaches the store or the source.
    const { source, service } = setup()
    const error = await service.getSnapshot({ accountId: ' ' }).catch((e: unknown) => e)
    expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    expect(source.totalReads).toBe(0)
  })
})

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

/** Lets one full turn of the event loop pass, which is when Node reports an unhandled rejection. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('SubscriptionService reconcile', () => {
  it('refreshes the stale accounts through the reconciler and returns its result', async () => {
    // Scenario: two accounts a day and a half old; the service's reconcile refreshes both.
    const { source, store, clock, service } = setup()
    for (const n of [1, 2]) {
      const reference = { accountId: `acc-${n}` }
      await store.putSnapshot(encodeAccountKey(reference), snapshotOf(reference, true), [], T0)
    }
    clock.advance(36 * 3_600_000)
    const result = await service.reconcile({ olderThanMs: 24 * 3_600_000 })
    expect(result).toEqual({ refreshed: 2, failed: 0, cursor: null })
    expect(source.totalReads).toBe(2)
  })

  it('refuses an option out of range as invalid input', async () => {
    // Scenario: a batch of zero.
    const { service } = setup()
    await expect(service.reconcile({ batchSize: 0 })).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
  })

  it('runs with its defaults when called with no argument', async () => {
    // Scenario: nothing stored, nothing to do.
    const { service } = setup()
    await expect(service.reconcile()).resolves.toEqual({
      refreshed: 0,
      failed: 0,
      cursor: null
    })
  })
})

describe('SubscriptionService background refresh', () => {
  const DAY = 24 * 3_600_000
  let warn: jest.SpyInstance

  // The test runner fails the running test on a rejection nobody handled, which Node reports one
  // turn of the event loop after it happens; the cases below wait that turn.
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  /** A service whose account is stored, then aged by `ageMs` and given the stale limit of a day. */
  async function aged(ageMs: number, extra: SetupOptions = {}): Promise<ReturnType<typeof setup>> {
    const built = setup({ maxSnapshotAgeMs: DAY, ...extra })
    built.source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await built.service.refresh(ACCOUNT)
    built.clock.advance(ageMs)
    return built
  }

  it('returns the stored snapshot at once and starts one background refresh for a stale snapshot', async () => {
    // Scenario: a snapshot a day and a millisecond old, with the source read held; the read
    // returns the old data while the refresh is still running, and the refresh then lands.
    const { source, service } = await aged(DAY + 1)
    const reads = source.readCount(ACCOUNT)
    const release = source.delayNextRead()
    const snapshot = await service.getSnapshot(ACCOUNT)
    expect(snapshot.ageMs).toBe(DAY + 1)
    await flush()
    expect(source.readCount(ACCOUNT)).toBe(reads + 1)
    release()
    await flush()
    expect((await service.getSnapshot(ACCOUNT)).ageMs).toBe(0)
  })

  it('does not start a refresh for a snapshot exactly as old as the limit', async () => {
    // Scenario: the boundary; a snapshot as old as the maximum age is still fresh, one
    // millisecond older is stale.
    const { source, clock, service } = await aged(DAY)
    const reads = source.totalReads
    await service.getSnapshot(ACCOUNT)
    await flush()
    expect(source.totalReads).toBe(reads)
    clock.advance(1)
    await service.getSnapshot(ACCOUNT)
    await flush()
    expect(source.totalReads).toBe(reads + 1)
  })

  it('starts no refresh for a fresh snapshot or for an account with nothing stored', async () => {
    // Scenario: neither read leaves the store.
    const { source, service } = await aged(1000)
    const reads = source.totalReads
    await service.getSnapshot(ACCOUNT)
    await service.hasEntitlement(ACCOUNT, 'pro')
    await service.getSnapshot({ accountId: 'unknown' })
    await flush()
    expect(source.totalReads).toBe(reads)
  })

  it('starts one source call for many reads of one stale account while the refresh is in flight', async () => {
    // Scenario: fifty reads, mixed between the two read methods, while the first refresh is held.
    const { source, service } = await aged(DAY + 1)
    const reads = source.readCount(ACCOUNT)
    const release = source.delayNextRead()
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        index % 2 === 0 ? service.getSnapshot(ACCOUNT) : service.hasEntitlement(ACCOUNT, 'pro')
      )
    )
    await flush()
    release()
    await flush()
    expect(source.readCount(ACCOUNT)).toBe(reads + 1)
  })

  it('does not reject the read, leave a rejection unhandled or change the result when the refresh fails', async () => {
    // Scenario: the background read fails; the read is already answered, nothing is unhandled and
    // the stored snapshot is untouched.
    const { source, service } = await aged(DAY + 1)
    source.failNextRead(new Error('upstream down for acc-1'))
    await expect(service.getSnapshot(ACCOUNT)).resolves.toMatchObject({ ageMs: DAY + 1 })
    await flush()
    await nextTurn()
    expect((await service.getSnapshot(ACCOUNT)).ageMs).toBe(DAY + 1)
  })

  it('logs the failure by its error code only and never names the account', async () => {
    // Scenario: the background failure is a source failure on account acc-1.
    const { source, service } = await aged(DAY + 1)
    source.failNextRead(new Error('upstream down for acc-1'))
    await service.getSnapshot(ACCOUNT)
    await flush()
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    expect(message).not.toContain('acc-1')
  })

  it('tells the observer the error code of a failed background refresh', async () => {
    // Scenario: an observer with the hook is configured; it receives the code and nothing else.
    const onBackgroundRefreshFailure = jest.fn()
    const { source, service } = await aged(DAY + 1, { observer: { onBackgroundRefreshFailure } })
    source.failNextRead(new Error('down'))
    await service.getSnapshot(ACCOUNT)
    await flush()
    expect(onBackgroundRefreshFailure).toHaveBeenCalledTimes(1)
    expect(onBackgroundRefreshFailure).toHaveBeenCalledWith({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
  })

  it('reports a failure that is not a library error with no code and without its text', async () => {
    // Scenario: the refresher rejects with a plain error, as a failing store would.
    const onBackgroundRefreshFailure = jest.fn()
    const { refresher, service } = await aged(DAY + 1, { observer: { onBackgroundRefreshFailure } })
    jest.spyOn(refresher, 'refresh').mockRejectedValue(new Error('store down'))
    await service.getSnapshot(ACCOUNT)
    await flush()
    expect(onBackgroundRefreshFailure).toHaveBeenCalledWith({ code: null })
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('unclassified')
    expect(message).not.toContain('store down')
  })

  it('does not let an observer that throws reject the read or leave a rejection unhandled', async () => {
    // Scenario: the hook throws while the failure is reported.
    const throwing = await aged(DAY + 1, {
      observer: {
        onBackgroundRefreshFailure: () => {
          throw new Error('observer broke')
        }
      }
    })
    throwing.source.failNextRead(new Error('down'))
    await expect(throwing.service.getSnapshot(ACCOUNT)).resolves.toBeDefined()
    await flush()
    await nextTurn()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not leave a rejection unhandled when the observer hook returns a rejected promise', async () => {
    // Scenario: an asynchronous hook rejects; the read was answered, and nothing escapes.
    const hook = jest.fn(() => Promise.reject(new Error('async observer broke')))
    const { source, service } = await aged(DAY + 1, {
      observer: { onBackgroundRefreshFailure: hook }
    })
    source.failNextRead(new Error('down'))
    await expect(service.getSnapshot(ACCOUNT)).resolves.toBeDefined()
    await flush()
    await nextTurn()
    expect(hook).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not wait for an observer hook that never settles', async () => {
    // Scenario: the hook returns a promise nobody resolves; the read still resolves at once.
    const hook = jest.fn(() => new Promise<void>(() => undefined))
    const { source, service } = await aged(DAY + 1, {
      observer: { onBackgroundRefreshFailure: hook }
    })
    source.failNextRead(new Error('down'))
    await expect(service.getSnapshot(ACCOUNT)).resolves.toBeDefined()
    await flush()
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('reports to the log alone when the observer has no hook', async () => {
    // Scenario: an observer object that handles nothing.
    const { source, service } = await aged(DAY + 1, { observer: {} })
    source.failNextRead(new Error('down'))
    await service.getSnapshot(ACCOUNT)
    await flush()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('attaches a rejection handler to the refresh it starts', async () => {
    // Scenario: the refresher returns a rejected promise; the service has handled it by the time
    // the read returns, so nothing is left for the runtime to report.
    const { refresher, service } = await aged(DAY + 1)
    const failed = Promise.reject(new Error('refresh failed'))
    const attach = jest.spyOn(failed, 'catch')
    jest.spyOn(refresher, 'refresh').mockReturnValue(failed)
    await service.getSnapshot(ACCOUNT)
    expect(attach).toHaveBeenCalledTimes(1)
    await flush()
    await nextTurn()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not delay the read for the refresh, whatever the refresh does', async () => {
    // Scenario: the refresher never settles; the read still resolves.
    const { refresher, service } = await aged(DAY + 1)
    jest.spyOn(refresher, 'refresh').mockReturnValue(new Promise(() => undefined))
    await expect(service.getSnapshot(ACCOUNT)).resolves.toMatchObject({ ageMs: DAY + 1 })
  })
})

/** A map-backed host cache that counts its calls. */
function hostCache(): SubscriptionCache & { gets: number; sets: number; deletes: number } {
  const entries = new Map<string, string>()
  const cache = {
    gets: 0,
    sets: 0,
    deletes: 0,
    get: (key: string): Promise<string | null> => {
      cache.gets += 1
      return Promise.resolve(entries.get(key) ?? null)
    },
    set: (key: string, value: string): Promise<void> => {
      cache.sets += 1
      entries.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string): Promise<void> => {
      cache.deletes += 1
      entries.delete(key)
      return Promise.resolve()
    }
  }
  return cache
}

describe('SubscriptionService with a cache', () => {
  /** Counts the reads that reach the store. */
  function countingStore(built: ReturnType<typeof setup>): jest.SpyInstance {
    return jest.spyOn(built.store, 'getSnapshot')
  }

  it('answers a second read of one account without reaching the store', async () => {
    // Scenario: the first read fills the cache; the second is answered from it.
    const cache = hostCache()
    const built = setup({ cache })
    built.source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await built.service.refresh(ACCOUNT)
    const reads = countingStore(built)
    await built.service.getSnapshot(ACCOUNT)
    await built.service.hasEntitlement(ACCOUNT, 'pro')
    expect(reads).toHaveBeenCalledTimes(1)
    expect(cache.sets).toBe(1)
  })

  it('shows a change on the next read after a refresh, not the cached value', async () => {
    // Scenario: a cached snapshot with the entitlement, then a refresh that removes it.
    const built = setup({ cache: hostCache() })
    built.source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await built.service.refresh(ACCOUNT)
    await expect(built.service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    built.clock.advance(1000)
    built.source.setAccount(ACCOUNT, {
      ...snapshotOf(ACCOUNT, false),
      sourceUpdatedAt: '2026-01-01T00:00:05.000Z'
    })
    await built.service.refresh(ACCOUNT)
    await expect(built.service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
  })

  it('shows the result of a background refresh on the next read', async () => {
    // Scenario: the cache holds a stale snapshot; the background refresh lands and empties it.
    const built = setup({ cache: hostCache(), maxSnapshotAgeMs: 1000 })
    built.source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await built.service.refresh(ACCOUNT)
    await built.service.getSnapshot(ACCOUNT)
    built.clock.advance(2000)
    expect((await built.service.getSnapshot(ACCOUNT)).ageMs).toBe(2000)
    await flush()
    expect((await built.service.getSnapshot(ACCOUNT)).ageMs).toBe(0)
  })

  it('answers reads and refreshes when every call to the host cache fails', async () => {
    // Scenario: the host cache rejects get, set and delete.
    const failing: SubscriptionCache = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
      delete: () => Promise.reject(new Error('down'))
    }
    const built = setup({ cache: failing })
    built.source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await expect(built.service.refresh(ACCOUNT)).resolves.toBeDefined()
    await expect(built.service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    await expect(built.service.getSnapshot(ACCOUNT)).resolves.toBeDefined()
  })

  it('reaches the store on every read when no cache was configured', async () => {
    // Scenario: with no cache the read goes to the store every time and no cache object exists.
    const built = setup()
    built.source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true))
    await built.service.refresh(ACCOUNT)
    const reads = countingStore(built)
    await built.service.getSnapshot(ACCOUNT)
    await built.service.getSnapshot(ACCOUNT)
    expect(reads).toHaveBeenCalledTimes(2)
  })
})
