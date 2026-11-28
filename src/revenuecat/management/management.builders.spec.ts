/**
 * @fileoverview Builders the RevenueCat management specs share: a context over a recording `fetch`
 * stub, answers, and the records an operation acts on. The file is a spec so that its own cases
 * pin the stub.
 * @layer revenuecat
 */
import { Secret } from '@bymax-one/nest-subscription/internal'
import type {
  NonRenewingPurchaseRecord,
  SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'

import type { RevenueCatManagementContext } from './management-context'
import { RevenueCatHttp } from '../revenuecat-http'

/** The key the stub context carries, which no error or log may show. */
export const KEY = 'sentinel-api-key-91c2'

/** The App User ID of the account the specs act as. */
export const APP_USER = 'sentinel-app-user/1'

/** A request the stub received. */
export interface Call {
  /** The method. */
  readonly method: string
  /** The address, as sent. */
  readonly url: string
  /** The body, or `undefined` when none was sent. */
  readonly body: string | undefined
}

/** What the stub answers for a request: a status and a JSON body. */
export type Answer = { readonly status: number; readonly body?: unknown }

/** Decides the answer of one request. */
export type Responder = (call: Call) => Answer

/** A JSON answer with status 200. */
export function ok(body: unknown): Answer {
  return { status: 200, body }
}

/** A context whose two clients talk to a stub, and the requests the stub saw. */
export interface Stubbed {
  /** The context the operations take. */
  readonly context: RevenueCatManagementContext
  /** Every request, in order. */
  readonly calls: Call[]
  /** The requests that changed something. */
  writes(): Call[]
}

/** Builds a context over a stub that answers with `respond`; `versionOne` false holds no version 1 client. */
export function stubbed(respond: Responder, versionOne = true): Stubbed {
  const calls: Call[] = []
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      body: typeof init.body === 'string' ? init.body : undefined
    }
    calls.push(call)
    const answer = respond(call)
    return Promise.resolve(
      new Response(JSON.stringify(answer.body ?? {}), { status: answer.status })
    )
  }
  const config = { apiKey: new Secret(KEY), timeoutMs: 1000, fetch }
  return {
    context: {
      http: new RevenueCatHttp({ ...config, baseUrl: 'https://rc.test/v2' }),
      httpV1: versionOne ? new RevenueCatHttp({ ...config, baseUrl: 'https://rc.test/v1' }) : null,
      projectId: 'proj_1'
    },
    calls,
    writes: () => calls.filter((call) => call.method !== 'GET')
  }
}

/** A subscription of the given origin that renews, with fields changed. */
export function subscriptionOf(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    subscriptionReference: 'sub_1',
    status: 'active',
    givesAccess: true,
    willRenew: 'yes',
    origin: 'play_store',
    environment: 'production',
    productReference: 'pro_monthly',
    billingInterval: '',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    accessUntil: '2026-02-01T00:00:00.000Z',
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: 'https://manage.example/sub_1',
    ...overrides
  }
}

/** A non-renewing purchase of the given origin, with fields changed. */
export function purchaseOf(
  overrides: Partial<NonRenewingPurchaseRecord> = {}
): NonRenewingPurchaseRecord {
  return {
    purchaseReference: 'pur_1',
    entitlementNames: ['pro'],
    givesAccess: true,
    origin: 'play_store',
    environment: 'production',
    productReference: 'lifetime',
    purchasedAt: '2026-01-01T00:00:00.000Z',
    accessUntil: null,
    refundedAt: null,
    ...overrides
  }
}

// Other specs import this file for its builders, which would register its own cases in each of
// them and give one full name to several files, so they are declared only when this file is run.
const own = expect.getState().testPath === __filename ? describe : (): void => undefined

own('management builders', () => {
  it('records each request and tells the writes from the reads', async () => {
    // Scenario: a read and a write through the two clients are recorded with their bodies.
    const { context, calls, writes } = stubbed(() => ok({ done: true }))
    await context.http.get('/a')
    await context.httpV1?.post('/b', { x: 1 })
    await context.http.post('/c')
    expect(calls.map((call) => [call.method, call.url, call.body])).toStrictEqual([
      ['GET', 'https://rc.test/v2/a', undefined],
      ['POST', 'https://rc.test/v1/b', '{"x":1}'],
      ['POST', 'https://rc.test/v2/c', undefined]
    ])
    expect(writes()).toHaveLength(2)
  })

  it('answers a status with an empty body when none is given', async () => {
    // Scenario: a failure answer carries a status only.
    const { context } = stubbed(() => ({ status: 500 }))
    await expect(context.http.get('/a')).rejects.toBeInstanceOf(Error)
  })
})
