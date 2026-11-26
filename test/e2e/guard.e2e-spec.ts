/**
 * @fileoverview The guard on real routes of a running NestJS application: the three outcomes for
 * three accounts, the unauthenticated case, both fail-policy values with the store and the source
 * down, and no decision that waits for the source. The account comes from the host's resolver
 * only; time moves only through a manual clock.
 * @layer e2e
 */
import { HttpException, type ExecutionContext } from '@nestjs/common'
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host'
import request from 'supertest'
import {
  EntitlementGuard,
  RequiresEntitlement,
  SUBSCRIPTION_ERROR_CODES,
  SubscriptionError,
  type AccountReference,
  type SubscriptionCache,
  type SubscriptionErrorCode
} from '@bymax-one/nest-subscription'
import { SubscriptionError as InternalError } from '@bymax-one/nest-subscription/internal'
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'

import { decideAccess } from '../../src/core/guard/decide-access'
import { REQUIRED_ENTITLEMENT_KEY } from '../../src/core/guard/requires-entitlement.decorator'
import {
  ACCOUNT_HEADER,
  RAW_HEADER,
  START,
  TENANT_HEADER,
  THROW_HEADER,
  buildGuardedApp,
  snapshotOf,
  type GuardedApp
} from './fixtures/guarded-app'

const HOUR_MS = 3_600_000
const HELD: AccountReference = { accountId: 'sentinel-acc-held' }
const NONE: AccountReference = { accountId: 'sentinel-acc-none' }
const ON_HOLD: AccountReference = { accountId: 'sentinel-acc-hold' }

/** The apps a test built, closed after it. */
const running: GuardedApp[] = []

/** Builds an app and remembers it for the cleanup. */
async function boot(...args: Parameters<typeof buildGuardedApp>): Promise<GuardedApp> {
  const built = await buildGuardedApp(...args)
  running.push(built)
  return built
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((built) => built.app.close()))
})

/** A GET of a path as an account, or with no account when none is given. */
function get(built: GuardedApp, path: string, account?: AccountReference): request.Test {
  const call = request(built.app.getHttpServer()).get(path)
  if (account !== undefined) {
    void call.set(ACCOUNT_HEADER, account.accountId)
    if (account.tenantId !== undefined) void call.set(TENANT_HEADER, account.tenantId)
  }
  return call
}

/** Asserts a refusal: its status and a body that is exactly the catalogue's code and message. */
function expectRefusal(
  response: request.Response,
  status: number,
  code: SubscriptionErrorCode
): void {
  expect(response.status).toBe(status)
  expect(response.body).toStrictEqual(new SubscriptionError(code).toJSON())
}

/** Seeds the three accounts the outcome tests use. */
async function seedThree(built: GuardedApp): Promise<void> {
  await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
  await built.seed(snapshotOf(ON_HOLD, { givesAccess: false, entitlement: 'premium' }))
  await built.seed(snapshotOf(NONE, { givesAccess: true, entitlement: 'basic' }))
}

describe('guard: the three outcomes', () => {
  it('allows one account, refuses another as entitlement required and a third as no access', async () => {
    // Scenario: three accounts call one decorated route. One holds `premium`; one has only
    // `basic`, so it has no `premium` subscription; one has a `premium` subscription on hold.
    const built = await boot()
    await seedThree(built)
    const allowed = await get(built, '/premium', HELD)
    expect(allowed.status).toBe(200)
    expect(allowed.body).toStrictEqual({ ok: true })
    const required = await get(built, '/premium', NONE)
    expectRefusal(required, 403, SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED)
    const noAccess = await get(built, '/premium', ON_HOLD)
    expectRefusal(noAccess, 403, SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
  })

  it('refuses an account the store has no record of as entitlement required', async () => {
    // Scenario: nothing is stored for the account; the store is readable, so this is "no
    // subscription" and the source is not asked.
    const built = await boot()
    const response = await get(built, '/premium', { accountId: 'sentinel-acc-unknown' })
    expectRefusal(response, 403, SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED)
    expect(built.source.totalReads).toBe(0)
  })

  it('stops allowing an entitlement at its end instant, by the injected clock', async () => {
    // Scenario: the entitlement ends one hour in; the same request is allowed before and refused
    // from that instant, and only the manual clock moved.
    const built = await boot()
    const until = new Date(Date.parse(START) + HOUR_MS).toISOString()
    await built.seed(
      snapshotOf(HELD, { givesAccess: true, entitlement: 'premium', accessUntil: until })
    )
    expect((await get(built, '/premium', HELD)).status).toBe(200)
    built.clock.set(until)
    expectRefusal(await get(built, '/premium', HELD), 403, SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
  })

  it('applies the entitlement of the class, and the handler over it', async () => {
    // Scenario: the account holds `basic` only. The class route needs `basic`; the handler that
    // overrides it needs `premium`.
    const built = await boot()
    await built.seed(snapshotOf(NONE, { givesAccess: true, entitlement: 'basic' }))
    expect((await get(built, '/basic', NONE)).status).toBe(200)
    expectRefusal(
      await get(built, '/basic/premium', NONE),
      403,
      SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED
    )
  })

  it('leaves a route without the decorator alone, even with the store down and no account', async () => {
    // Scenario: the open route sits behind the same guard; it answers with no account and with
    // every store method failing, because the guard resolves and reads nothing for it.
    const built = await boot()
    built.store.fail()
    const response = await get(built, '/premium/open')
    expect(response.status).toBe(200)
    expect(built.source.totalReads).toBe(0)
  })
})

describe('guard: the account comes from the resolver only', () => {
  it('refuses a request with no account as unauthenticated, not as unsubscribed', async () => {
    // Scenario: no header, so the resolver answers null; 401 with the account code.
    const built = await boot()
    await seedThree(built)
    expectRefusal(await get(built, '/premium'), 401, SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED)
  })

  it.each([
    ['a string', '"sentinel-acc-held"'],
    ['an empty object', '{}'],
    ['a blank identifier', '{"accountId":"  "}'],
    ['a numeric identifier', '{"accountId":7}'],
    ['a numeric tenant', '{"accountId":"sentinel-acc-held","tenantId":3}'],
    ['null', 'null']
  ])('refuses as unauthenticated a resolver answer that is %s', async (_title, raw) => {
    // Scenario: the host's resolver answers with something that is not an account.
    const built = await boot()
    await seedThree(built)
    const response = await request(built.app.getHttpServer()).get('/premium').set(RAW_HEADER, raw)
    expectRefusal(response, 401, SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED)
  })

  it('refuses as source unavailable when the resolver throws, and says nothing of why', async () => {
    // Scenario: the resolver throws; the unexpected failure refuses with the catalogue body.
    const built = await boot()
    await seedThree(built)
    const response = await request(built.app.getHttpServer()).get('/premium').set(THROW_HEADER, '1')
    expectRefusal(response, 503, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
  })

  it.each([
    [401, 401],
    [403, 403],
    [302, 503],
    [200, 503]
  ])('answers %d for a resolver HTTP exception of status %d', async (status, expected) => {
    // Scenario: the host's resolver refuses with its own HTTP exception. From 400 to 599 it leaves
    // the guard with the host's body; any other status is an unexpected failure.
    const built = await boot()
    const response = await request(built.app.getHttpServer())
      .get('/premium')
      .set(THROW_HEADER, `http:${status}`)
    expect(response.status).toBe(expected)
    if (expected === 503) {
      expectRefusal(response, 503, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    } else {
      expect(response.body).toStrictEqual({ hint: 'host refusal' })
    }
  })

  it('does not pass an HTTP exception of the store through', async () => {
    // Scenario: the store rejects with an unauthorized exception; the guard's own refusal answers.
    const built = await boot()
    await seedThree(built)
    built.store.fail(['getSnapshot'], new HttpException({ hint: 'store' }, 401))
    expectRefusal(
      await get(built, '/premium', HELD),
      503,
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
  })

  it.each([
    ['an invalid date', (): Date => new Date(Number.NaN)],
    ['a value that is not a date', (): Date => Object.create(null)]
  ])('refuses as source unavailable when the clock gives %s', async (_title, now) => {
    // Scenario: the clock cannot say what time it is after the snapshot was read; the guard refuses
    // an account that would otherwise be allowed.
    const built = await boot()
    await seedThree(built)
    expect((await get(built, '/premium', HELD)).status).toBe(200)
    jest.spyOn(built.clock, 'now').mockImplementation(now)
    expectRefusal(
      await get(built, '/premium', HELD),
      503,
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
  })

  it('decides for the account the resolver names, whatever the body, query and headers say', async () => {
    // Scenario: the caller is `sentinel-acc-none` but the body, the query string and other headers all name
    // `sentinel-acc-held`; it is refused. The reverse is allowed. The guard reads none of them.
    const built = await boot()
    await seedThree(built)
    const forged = await request(built.app.getHttpServer())
      .post('/premium?accountId=sentinel-acc-held&tenantId=t')
      .set(ACCOUNT_HEADER, NONE.accountId)
      .set('x-account-id', HELD.accountId)
      .set('x-tenant-id', 't')
      .send({ accountId: HELD.accountId, tenantId: 't' })
    expectRefusal(forged, 403, SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED)
    const honest = await request(built.app.getHttpServer())
      .post('/premium?accountId=sentinel-acc-none')
      .set(ACCOUNT_HEADER, HELD.accountId)
      .send({ accountId: NONE.accountId })
    expect(honest.status).toBe(201)
  })

  it('keeps tenants apart in a multi-tenant host, and refuses an account with no tenant', async () => {
    // Scenario: the account is subscribed in tenant `t1`. A request resolved to `t1` is allowed,
    // the same account in `t2` is not, and a request with no tenant is unauthenticated.
    const built = await boot({ multiTenant: true })
    const inT1: AccountReference = { accountId: 'sentinel-acc-held', tenantId: 't1' }
    await built.seed(snapshotOf(inT1, { givesAccess: true, entitlement: 'premium' }))
    expect((await get(built, '/premium', inT1)).status).toBe(200)
    expectRefusal(
      await get(built, '/premium', { accountId: 'sentinel-acc-held', tenantId: 't2' }),
      403,
      SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED
    )
    expectRefusal(await get(built, '/premium', HELD), 401, SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED)
  })

  it('puts no account or tenant identifier in the body of any refusal the fixture can reach', async () => {
    // Scenario: unusual identifiers go through the refusals of a decision (both 403s), of a missing
    // account and of a malformed answer (401), of a resolver failure, of the store down and of a
    // stale snapshot under refuse (503); each answers its own status, none carries an identifier
    // in its body, and each body is the code and the message.
    const built = await boot({ multiTenant: true, maxSnapshotAgeMs: HOUR_MS })
    const hidden: AccountReference = {
      accountId: 'sentinel-acc-sentinel-77',
      tenantId: 'tenant-sentinel-77'
    }
    await built.seed(snapshotOf(hidden, { givesAccess: false, entitlement: 'premium' }))
    const answers: (readonly [request.Response, number])[] = [
      [await get(built, '/premium', hidden), 403],
      [await get(built, '/basic', hidden), 403],
      [await get(built, '/premium', { ...hidden, accountId: 'other-sentinel-77' }), 403],
      [await get(built, '/premium'), 401],
      [
        await request(built.app.getHttpServer())
          .get('/premium')
          .set(ACCOUNT_HEADER, hidden.accountId)
          .set(THROW_HEADER, '1'),
        503
      ],
      [
        await request(built.app.getHttpServer())
          .get('/premium')
          .set(RAW_HEADER, '{"accountId":"sentinel-acc-sentinel-77","tenantId":7}'),
        401
      ]
    ]
    built.store.fail(['getSnapshot'])
    answers.push([await get(built, '/premium', hidden), 503])
    built.store.recover()
    await built.seed(snapshotOf(hidden, { givesAccess: true, entitlement: 'premium' }))
    built.clock.advance(2 * HOUR_MS)
    answers.push([await get(built, '/premium', hidden), 503])
    for (const [response, status] of answers) {
      expect(response.status).toBe(status)
      expect(JSON.stringify(response.body)).not.toContain('sentinel-77')
      expect(Object.keys(response.body as object)).toEqual(['code', 'message'])
    }
  })
})

/** A host cache that keeps every entry for ever, so a read can be answered from it. */
function foreverCache(): SubscriptionCache {
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

describe('guard: the fail policy with the store down', () => {
  it.each(['refuse', 'last_known_state'] as const)(
    'refuses under %s when the store cannot be read and no cache holds the snapshot',
    async (failPolicy) => {
      // Scenario: a held account, the store failing on every method; no snapshot can be read, so
      // neither policy has anything to trust. The refusal is 503, not "no subscription".
      const built = await boot({ failPolicy })
      await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
      built.store.fail()
      expectRefusal(
        await get(built, '/premium', HELD),
        503,
        SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
      )
    }
  )

  it('allows again once the store is back', async () => {
    // Scenario: the refusal during the outage is not remembered.
    const built = await boot()
    await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
    built.store.fail(['getSnapshot'])
    expect((await get(built, '/premium', HELD)).status).toBe(503)
    built.store.recover()
    expect((await get(built, '/premium', HELD)).status).toBe(200)
  })

  /** Warms the cache with a stale snapshot, then takes the store down. */
  async function staleInCacheStoreDown(
    options: Parameters<typeof buildGuardedApp>[0]
  ): Promise<GuardedApp> {
    const built = await boot({ cache: foreverCache(), maxSnapshotAgeMs: HOUR_MS, ...options })
    await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
    built.clock.advance(2 * HOUR_MS)
    built.source.failNextRead(new Error('source down'))
    expect((await get(built, '/premium', HELD)).status).toBe(
      options?.failPolicy === 'last_known_state' ? 200 : 503
    )
    built.store.fail()
    return built
  }

  it('trusts a cached snapshot within the tolerance under last_known_state, store down', async () => {
    // Scenario: the cache holds the stale snapshot from an earlier read; the store is down and the
    // snapshot is younger than the tolerance, so the guard allows from the cache.
    const built = await staleInCacheStoreDown({
      failPolicy: 'last_known_state',
      lastKnownStateToleranceMs: 3 * HOUR_MS
    })
    expect((await get(built, '/premium', HELD)).status).toBe(200)
  })

  it('refuses a cached snapshot aged exactly the tolerance, and one older, store down', async () => {
    // Scenario: the same cached snapshot, the clock moved so its age is exactly the tolerance
    // (refused: it must be strictly younger) and then one millisecond beyond it.
    const built = await staleInCacheStoreDown({
      failPolicy: 'last_known_state',
      lastKnownStateToleranceMs: 3 * HOUR_MS
    })
    built.clock.set(new Date(Date.parse(START) + 3 * HOUR_MS).toISOString())
    expectRefusal(
      await get(built, '/premium', HELD),
      503,
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
    built.clock.advance(1)
    expectRefusal(
      await get(built, '/premium', HELD),
      503,
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
  })

  it('refuses a cached stale snapshot under refuse, store down', async () => {
    // Scenario: the default policy does not trust the cached snapshot that cannot be shown current.
    const built = await staleInCacheStoreDown({ failPolicy: 'refuse' })
    expectRefusal(
      await get(built, '/premium', HELD),
      503,
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
  })
})

describe('guard: the fail policy with the source down', () => {
  /** A stored snapshot that is `ageMs` old, with the source failing its next read. */
  async function staleSourceDown(
    ageMs: number,
    options: Parameters<typeof buildGuardedApp>[0]
  ): Promise<GuardedApp> {
    const built = await boot({
      maxSnapshotAgeMs: HOUR_MS,
      lastKnownStateToleranceMs: 3 * HOUR_MS,
      ...options
    })
    await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
    built.clock.advance(ageMs)
    built.source.failNextRead(new Error('source down'))
    return built
  }

  it('refuses a stale snapshot under refuse although it holds the entitlement', async () => {
    // Scenario: the snapshot is two hours old with a one-hour maximum and the source is down.
    const built = await staleSourceDown(2 * HOUR_MS, { failPolicy: 'refuse' })
    expectRefusal(
      await get(built, '/premium', HELD),
      503,
      SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    )
    expect(built.source.readCount(HELD)).toBe(1)
  })

  it('allows a snapshot younger than the tolerance under last_known_state', async () => {
    // Scenario: the same state under the other policy; the refresh fails in the background and
    // the stored snapshot, two hours old, is trusted.
    const built = await staleSourceDown(2 * HOUR_MS, { failPolicy: 'last_known_state' })
    expect((await get(built, '/premium', HELD)).status).toBe(200)
    expect(built.source.readCount(HELD)).toBe(1)
  })

  it.each([
    ['one millisecond under the tolerance', 3 * HOUR_MS - 1, 200],
    ['exactly the tolerance', 3 * HOUR_MS, 503],
    ['one millisecond over the tolerance', 3 * HOUR_MS + 1, 503]
  ])('at %s under last_known_state the status is %d', async (_title, ageMs, status) => {
    // Scenario: the boundary of the tolerance, measured on the injected clock.
    const built = await staleSourceDown(ageMs, { failPolicy: 'last_known_state' })
    const response = await get(built, '/premium', HELD)
    expect(response.status).toBe(status)
    if (status === 503) {
      expectRefusal(response, 503, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    }
  })

  it.each([
    ['two days old', 48 * HOUR_MS, 200],
    ['one millisecond under 72 hours', 72 * HOUR_MS - 1, 200],
    ['exactly 72 hours', 72 * HOUR_MS, 503]
  ])(
    'with the default tolerance a snapshot %s answers %d under last_known_state',
    async (_t, ageMs, status) => {
      // Scenario: only the policy is set; the tolerance is the default and the stored snapshot is
      // stale (past the default 24-hour maximum) with the source down.
      const built = await boot({ failPolicy: 'last_known_state' })
      await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
      built.clock.advance(ageMs)
      built.source.failNextRead(new Error('source down'))
      expect((await get(built, '/premium', HELD)).status).toBe(status)
    }
  )

  it('still refuses a trusted stale snapshot whose entitlement is not held', async () => {
    // Scenario: the policy only lets the stale snapshot be read; the account is on hold in it.
    const built = await boot({
      failPolicy: 'last_known_state',
      maxSnapshotAgeMs: HOUR_MS,
      lastKnownStateToleranceMs: 3 * HOUR_MS
    })
    await built.seed(snapshotOf(ON_HOLD, { givesAccess: false, entitlement: 'premium' }))
    built.clock.advance(2 * HOUR_MS)
    built.source.failNextRead(new Error('source down'))
    expectRefusal(await get(built, '/premium', ON_HOLD), 403, SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
  })

  it('never reads from the source for a missing snapshot, and refuses it under both policies', async () => {
    // Scenario: with nothing stored, both values refuse as "no subscription": the empty snapshot
    // is fresh, so there is nothing to refresh and the fail policy is not what decides.
    for (const failPolicy of ['refuse', 'last_known_state'] as const) {
      const built = await boot({ failPolicy })
      expectRefusal(
        await get(built, '/premium', { accountId: 'sentinel-acc-new' }),
        403,
        SUBSCRIPTION_ERROR_CODES.ENTITLEMENT_REQUIRED
      )
      expect(built.source.totalReads).toBe(0)
    }
  })
})

describe('guard: no decision waits for the source', () => {
  it('makes no source call for twenty consecutive decisions on a fresh snapshot', async () => {
    // Scenario: a fresh snapshot, ten allowed and ten refused requests; the source's read
    // counter stays at zero.
    const built = await boot()
    await seedThree(built)
    for (let call = 0; call < 10; call += 1) {
      expect((await get(built, '/premium', HELD)).status).toBe(200)
      expect((await get(built, '/premium', ON_HOLD)).status).toBe(403)
    }
    expect(built.source.totalReads).toBe(0)
  })

  it.each([
    ['refuse', 503],
    ['last_known_state', 200]
  ] as const)(
    'answers a request on a stale snapshot under %s with %d while the source read is held',
    async (failPolicy, status) => {
      // Scenario: the snapshot is stale and the source read is held unresolved by the test. The
      // response comes back while the read is still held, and several concurrent requests start
      // at most one read for the account.
      const built = await boot({
        failPolicy,
        maxSnapshotAgeMs: HOUR_MS,
        lastKnownStateToleranceMs: 3 * HOUR_MS
      })
      await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
      built.source.setAccount(HELD, snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
      built.clock.advance(2 * HOUR_MS)
      const release = built.source.delayNextRead()
      const responses = await Promise.all([
        get(built, '/premium', HELD),
        get(built, '/premium', HELD),
        get(built, '/premium', HELD)
      ])
      expect(responses.map((response) => response.status)).toEqual([status, status, status])
      expect(built.source.readCount(HELD)).toBe(1)
      release()
      await built.service.refresh(HELD)
    }
  )

  it('sees the refreshed snapshot on the next request, with no further source read', async () => {
    // Scenario: after the held read is released the store holds a fresh snapshot; the refusal of
    // the stale one under `refuse` is gone and the source is not read again.
    const built = await boot({ maxSnapshotAgeMs: HOUR_MS })
    await built.seed(snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
    built.source.setAccount(HELD, snapshotOf(HELD, { givesAccess: true, entitlement: 'premium' }))
    built.clock.advance(2 * HOUR_MS)
    expect((await get(built, '/premium', HELD)).status).toBe(503)
    await built.service.refresh(HELD)
    const reads = built.source.readCount(HELD)
    expect((await get(built, '/premium', HELD)).status).toBe(200)
    expect(built.source.readCount(HELD)).toBe(reads)
  })
})

describe('guard: cases a request cannot make', () => {
  it('refuses a blank entitlement name when the decorator is applied', () => {
    // Scenario: a route cannot be protected with a name nobody holds; the refusal comes when the
    // decorator is applied, so the application never boots with the route.
    expect(() => RequiresEntitlement('   ')).toThrow(
      expect.objectContaining({ code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT })
    )
  })

  /** An execution context of a given type for a handler. */
  function contextOf(type: string, handler: () => void): ExecutionContext {
    const host = new ExecutionContextHost([], Object, handler)
    host.setType(type)
    return host
  }

  /** The error a guard call rejects with. */
  async function refusalOf(
    guard: EntitlementGuard,
    context: ExecutionContext
  ): Promise<HttpException> {
    try {
      await guard.canActivate(context)
    } catch (error) {
      return error as HttpException
    }
    throw new Error('the guard allowed')
  }

  it('refuses a decorated route reached outside HTTP, without calling the resolver', async () => {
    // Scenario: a handler that carries the decorator is reached through another transport.
    const built = await boot()
    const handler = (): void => undefined
    Reflect.defineMetadata(REQUIRED_ENTITLEMENT_KEY, 'premium', handler)
    const refusal = await refusalOf(built.guard, contextOf('rpc', handler))
    expect(refusal.getStatus()).toBe(401)
    expect(refusal.getResponse()).toStrictEqual(
      new InternalError(SUBSCRIPTION_ERROR_CODES.UNAUTHENTICATED).toJSON()
    )
  })

  it('refuses a route whose metadata is not an entitlement name', async () => {
    // Scenario: the key holds a number; the guard cannot know what the route needs.
    const built = await boot()
    const handler = (): void => undefined
    Reflect.defineMetadata(REQUIRED_ENTITLEMENT_KEY, 7, handler)
    const refusal = await refusalOf(built.guard, contextOf('http', handler))
    expect(refusal.getStatus()).toBe(503)
  })

  it('gives no access for an end it cannot read, to the decision, the service and the guard', async () => {
    // Scenario: an entitlement that is active with an `until` that is not an instant. The pure
    // decision refuses it; the same snapshot written straight into the store reads as absent
    // through the service, which answers false, and the guard refuses the route.
    const snapshot = {
      ...createEmptySnapshot({ accountId: 'sentinel-acc-held', source: 'fake', fetchedAt: START }),
      entitlements: [
        {
          name: 'premium',
          active: true,
          until: 'not-a-date',
          grantingSubscriptionReference: 's',
          grantingSubscriptionReferences: ['s']
        }
      ]
    }
    expect(decideAccess(snapshot, 'premium', new Date(START))).toBe('no_access')
    const built = await boot()
    await built.seed(snapshot)
    expect(await built.service.hasEntitlement(HELD, 'premium')).toBe(false)
    expect((await get(built, '/premium', HELD)).status).toBe(403)
  })
})
