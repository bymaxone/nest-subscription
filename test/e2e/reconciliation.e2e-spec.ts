/**
 * @fileoverview Reconciliation, end to end: a real application with a store that holds stale
 * accounts, a manual clock and the fake source. A run refreshes only the stale accounts, ends at
 * its batch bound or its rate, carries on from its cursor, survives a failing account, and starts
 * no timer. Time moves only through the clock and the wait function the test passes.
 * @layer e2e
 */
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import {
  SubscriptionError,
  SubscriptionModule,
  SubscriptionService
} from '@bymax-one/nest-subscription'
import type { Wait } from '@bymax-one/nest-subscription'
import { SUBSCRIPTION_ERROR_CODES, createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'
import { encodeAccountKey } from '@bymax-one/nest-subscription'

const T0 = '2026-01-01T00:00:00.000Z'
const DAY = 86_400_000

/** An application with `count` accounts stored at T0 and then two days passed. */
async function boot(
  count: number,
  multiTenant = false
): Promise<{
  app: TestingModule
  service: SubscriptionService
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  wait: Wait
}> {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const app = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source,
        store,
        clock,
        multiTenant,
        accountResolver: () => null
      })
    ]
  }).compile()
  for (let n = 1; n <= count; n += 1) {
    const reference = multiTenant
      ? { tenantId: 't1', accountId: `acc-${String(n).padStart(3, '0')}` }
      : { accountId: `acc-${String(n).padStart(3, '0')}` }
    await store.putSnapshot(
      encodeAccountKey(reference),
      createEmptySnapshot({ ...reference, source: 'fake', fetchedAt: T0 }),
      [],
      T0
    )
  }
  clock.advance(2 * DAY)
  return {
    app,
    service: app.get(SubscriptionService),
    source,
    store,
    clock,
    wait: (ms) => {
      clock.advance(ms)
      return Promise.resolve()
    }
  }
}

describe('reconciliation', () => {
  it('refreshes the stale accounts and leaves a fresh one alone', async () => {
    // Scenario: three stale accounts and one fetched a minute ago.
    const { app, service, source, store, clock, wait } = await boot(3)
    const fresh = { accountId: 'fresh' }
    const fetchedAt = new Date(clock.now().getTime() - 60_000).toISOString()
    await store.putSnapshot(
      encodeAccountKey(fresh),
      createEmptySnapshot({ ...fresh, source: 'fake', fetchedAt }),
      [],
      fetchedAt
    )
    const result = await service.reconcile({ olderThanMs: DAY, wait })
    expect(result).toEqual({ refreshed: 3, failed: 0, cursor: null })
    expect(source.readCount(fresh)).toBe(0)
    expect(source.totalReads).toBe(3)
    await app.close()
  })

  it('stops at the batch bound and goes on from the cursor it returned', async () => {
    // Scenario: five stale accounts, two a run.
    const { app, service, source, wait } = await boot(5)
    const first = await service.reconcile({ olderThanMs: DAY, batchSize: 2, wait })
    expect(first).toMatchObject({ refreshed: 2 })
    const second = await service.reconcile({
      olderThanMs: DAY,
      batchSize: 2,
      cursor: first.cursor,
      wait
    })
    expect(second).toMatchObject({ refreshed: 2 })
    const third = await service.reconcile({
      olderThanMs: DAY,
      batchSize: 2,
      cursor: second.cursor,
      wait
    })
    expect(third).toEqual({ refreshed: 1, failed: 0, cursor: null })
    expect(source.totalReads).toBe(5)
    await app.close()
  })

  it('goes on to the next page of the store while the batch has room', async () => {
    // Scenario: a hundred and fifty stale accounts and a batch of that size; two pages are read.
    const { app, service, source, wait } = await boot(150)
    const result = await service.reconcile({
      olderThanMs: DAY,
      batchSize: 150,
      maxCallsPerSecond: 1000,
      wait
    })
    expect(result).toEqual({ refreshed: 150, failed: 0, cursor: null })
    expect(source.totalReads).toBe(150)
    await app.close()
  })

  it('waits through the function it is given when the rate is spent', async () => {
    // Scenario: six accounts at two a second; the waits it asks for add up to two seconds.
    const { app, service, clock } = await boot(6)
    const waited: number[] = []
    const result = await service.reconcile({
      olderThanMs: DAY,
      maxCallsPerSecond: 2,
      wait: (ms) => {
        waited.push(ms)
        clock.advance(ms)
        return Promise.resolve()
      }
    })
    expect(result.refreshed).toBe(6)
    expect(waited).toEqual([1000, 1000])
    await app.close()
  })

  it('ends at its rate with no wait function and returns a cursor to go on from', async () => {
    // Scenario: six accounts at two a second and nothing to wait with.
    const { app, service, source } = await boot(6)
    const result = await service.reconcile({ olderThanMs: DAY, maxCallsPerSecond: 2 })
    expect(result).toMatchObject({ refreshed: 2, failed: 0 })
    expect(source.totalReads).toBe(2)
    await app.close()
  })

  it('counts a failed account and goes on with the others', async () => {
    // Scenario: the first read fails.
    const { app, service, source, wait } = await boot(3)
    source.failNextRead(new Error('down'))
    const result = await service.reconcile({ olderThanMs: DAY, wait })
    expect(result).toEqual({ refreshed: 2, failed: 1, cursor: null })
    await app.close()
  })

  it('refuses an account with no tenant in a multi-tenant application, and refreshes the others', async () => {
    // Scenario: one account stored under a tenant, one stored with none.
    const { app, service, source, store, clock, wait } = await boot(1, true)
    const orphan = { accountId: 'orphan' }
    await store.putSnapshot(
      encodeAccountKey(orphan),
      createEmptySnapshot({ ...orphan, source: 'fake', fetchedAt: T0 }),
      [],
      T0
    )
    expect(clock.now().getTime()).toBeGreaterThan(Date.parse(T0))
    const result = await service.reconcile({ olderThanMs: DAY, wait })
    expect(result).toMatchObject({ refreshed: 1, failed: 1 })
    expect(source.readCount(orphan)).toBe(0)
    await app.close()
  })

  it('counts a key it did not write as failed without reading the source', async () => {
    // Scenario: a foreign key in the store beside a real account.
    const { app, service, source, store, wait } = await boot(1)
    await store.putSnapshot(
      'foreign',
      createEmptySnapshot({ accountId: 'foreign', source: 'fake', fetchedAt: T0 }),
      [],
      T0
    )
    const result = await service.reconcile({ olderThanMs: DAY, wait })
    expect(result).toMatchObject({ refreshed: 1, failed: 1 })
    expect(source.totalReads).toBe(1)
    await app.close()
  })

  it.each([
    ['a rate of zero', { maxCallsPerSecond: 0 }],
    ['a batch of zero', { batchSize: 0 }],
    ['a negative threshold', { olderThanMs: -1 }],
    ['a threshold older than any instant', { olderThanMs: Number.MAX_VALUE }]
  ])('refuses %s with the invalid-input code', async (_name, options) => {
    // Scenario: an option out of range stops the run before anything is read.
    const { app, service, source } = await boot(1)
    const error = await service.reconcile(options).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SubscriptionError)
    expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    expect(source.totalReads).toBe(0)
    await app.close()
  })

  it('runs with its defaults when called with no argument', async () => {
    // Scenario: the default threshold is the module's maximum age, a day; the account is two days old.
    const { app, service, source } = await boot(1)
    await expect(service.reconcile()).resolves.toEqual({
      refreshed: 1,
      failed: 0,
      cursor: null
    })
    expect(source.totalReads).toBe(1)
    await app.close()
  })

  it('starts no timer while it runs', async () => {
    // Scenario: a run that waits through the test's function and one that ends at its rate.
    const { app, service, wait } = await boot(4)
    const timeout = jest.spyOn(globalThis, 'setTimeout')
    const interval = jest.spyOn(globalThis, 'setInterval')
    await service.reconcile({ olderThanMs: DAY, maxCallsPerSecond: 1, wait })
    await service.reconcile({ olderThanMs: DAY, maxCallsPerSecond: 1 })
    expect(timeout).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    await app.close()
  })
})
