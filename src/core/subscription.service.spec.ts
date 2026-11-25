/**
 * @fileoverview Pins the service reads: an answer comes from the store and never from the source,
 * an unknown account is a value, the snapshot comes back frozen with its age, the tenant is part of
 * every key, and an on-demand refresh goes through the refresher. The fake source's read counter
 * proves when the source is and is not called.
 * @layer core
 */
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
import { SnapshotRefresher } from './refresh/snapshot-refresher'
import { SubscriptionService } from './subscription.service'

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

/** The service over a fresh source, store and clock. */
function setup(multiTenant = false): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  service: SubscriptionService
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const options = resolveOptions({ source, store, clock, multiTenant, accountResolver: () => null })
  const refresher = new SnapshotRefresher(source, store, clock)
  return {
    source,
    store,
    clock,
    service: new SubscriptionService(source, store, clock, options, refresher)
  }
}

describe('SubscriptionService reads', () => {
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
    const { service } = setup(true)
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
    const { source, service } = setup(true)
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
    const { source, service } = setup(true)
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
      const { source, service } = setup(true)
      const error = await service[method]({ accountId: 'acc-1' }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SubscriptionError)
      expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
      expect(source.totalReads).toBe(0)
    }
  )

  it('refuses hasEntitlement without a tenant, and a blank tenant, in a multi-tenant configuration', async () => {
    // Scenario: no tenant and a blank tenant are both a missing tenant.
    const { service } = setup(true)
    for (const tenantId of [undefined, '', '  ']) {
      const error = await service
        .hasEntitlement({ tenantId, accountId: 'acc-1' }, 'pro')
        .catch((e: unknown) => e)
      expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    }
  })

  it('accepts a missing tenant when the host is not multi-tenant', async () => {
    // Scenario: the default configuration serves one tenant and needs none.
    const { service } = setup(false)
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
