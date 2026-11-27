/**
 * @fileoverview Pins the assembled RevenueCat source: that it reads through the client, verifies
 * and parses webhooks with one refusal value, reports what it must, answers the management calls
 * as not possible from a server, validates its options first and holds no secret where a
 * serialization, a spread or an inspection can reach it.
 * @layer revenuecat
 */
import { createHmac } from 'node:crypto'
import { inspect } from 'node:util'

import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { fixtureFetch, loadFixture, type FetchCall } from './revenuecat.fixture'
import type { RevenueCatSourceOptions } from './revenuecat.options'
import {
  REVENUECAT_SOURCE_NAME,
  UNIDENTIFIED_EVENT_LINE,
  revenueCatSource
} from './revenuecat.source'
import { HEADER_ONLY_WARNING, REFUSED } from './webhook/verify-webhook'

const API_KEY = 'sentinel-api-key-7f3a'
const PREVIOUS_KEY = 'sentinel-previous-api-key-91bc'
const AUTHORIZATION = 'sentinel-authorization-5d2e'
const SIGNING = 'sentinel-signing-secret-0a1b'
const T = 1_795_000_000
const SENTINELS = [API_KEY, PREVIOUS_KEY, AUTHORIZATION, SIGNING]

function sourceWith(
  extra: Partial<RevenueCatSourceOptions> = {}
): ReturnType<typeof revenueCatSource> {
  return revenueCatSource({
    projectId: 'proj_PLACEHOLDER',
    apiKey: { current: API_KEY, previous: PREVIOUS_KEY },
    baseUrl: 'http://127.0.0.1:9/v2',
    clock: { now: () => new Date(T * 1000) },
    fetch: fixtureFetch('active-subscription'),
    ...extra
  })
}

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const signed = (body: Uint8Array): Record<string, string> => ({
  'x-revenuecat-webhook-signature': `t=${String(T)},v1=${createHmac('sha256', SIGNING)
    .update(`${String(T)}.`)
    .update(body)
    .digest('hex')}`
})

describe('revenueCatSource', () => {
  it('is named revenuecat and reads an account through the version 2 API', async () => {
    // Scenario: the snapshot carries the adapter's name and the customer of the request.
    const calls: FetchCall[] = []
    const source = sourceWith({ fetch: fixtureFetch('active-subscription', calls) })
    const snapshot = await source.readAccount({ accountId: 'customer_PLACEHOLDER_active' })
    expect(source.name).toBe(REVENUECAT_SOURCE_NAME)
    expect(snapshot.source).toBe('revenuecat')
    expect(snapshot.entitlements.map((entitlement) => entitlement.name)).toStrictEqual(['premium'])
    expect(calls[0]?.url).toContain(
      '/projects/proj_PLACEHOLDER/customers/customer_PLACEHOLDER_active/subscriptions'
    )
    expect(calls[0]?.init.headers).toMatchObject({ authorization: `Bearer ${API_KEY}` })
  })

  it('reads the customer of the account it is asked for, and the sandbox setting it was given', async () => {
    // Scenario: allowSandbox reaches the read.
    const source = sourceWith({ fetch: fixtureFetch('sandbox-subscription'), allowSandbox: true })
    expect((await source.readAccount({ accountId: 'c' })).entitlements).toHaveLength(1)
    const closed = sourceWith({ fetch: fixtureFetch('sandbox-subscription') })
    expect((await closed.readAccount({ accountId: 'c' })).entitlements).toHaveLength(0)
  })

  it.each([
    ['true', { allowSandbox: true }, true],
    ['false', { allowSandbox: false }, false],
    ['left unset', {}, false]
  ])('declares that it admits sandbox purchases as its option says: %s', (_name, extra, admits) => {
    // Scenario: the module compares this declaration with its own allowSandbox at boot.
    expect(sourceWith(extra).admitsSandbox).toBe(admits)
  })

  it('answers stop renewal as not possible for the App Store, with the management reference', async () => {
    // Scenario: the source advertises no server-side operation, and the answer carries the
    // management reference for the person to act on.
    const source = sourceWith()
    const snapshot = await source.readAccount({ accountId: 'c' })
    const subscription = snapshot.subscriptions[0]
    if (subscription === undefined) throw new Error('the fixture holds a subscription')
    expect(
      await source.capabilities({ accountId: 'c' }, { kind: 'subscription', record: subscription })
    ).toStrictEqual({
      operations: ['extend'],
      managementReference: 'https://apps.apple.com/account/subscriptions'
    })
    expect(await source.stopRenewal({ accountId: 'c' }, subscription)).toStrictEqual({
      outcome: 'customer_action_required',
      managementReference: 'https://apps.apple.com/account/subscriptions'
    })
  })
})

describe('revenueCatSource extend', () => {
  it('extends an App Store subscription through the version 2 action, with its key', async () => {
    // Scenario: the source hands the request to the extend operation with the adapter's own client.
    const requests: Array<{ url: string; init: RequestInit }> = []
    const source = sourceWith({
      fetch: (url, init) => {
        requests.push({ url, init })
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
    })
    const [subscription] = (
      await sourceWith().readAccount({ accountId: 'customer_PLACEHOLDER_active' })
    ).subscriptions
    if (subscription === undefined) throw new Error('the fixture holds a subscription')
    expect(
      await source.extend?.({ accountId: 'c' }, subscription, { days: 5, reason: 'other' })
    ).toStrictEqual({ outcome: 'accepted' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(
      'http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/subscriptions/sub_PLACEHOLDER_1/actions/extend'
    )
    expect(requests[0]?.init.body).toBe('{"extend_by_days":5,"extend_reason_code":"other"}')
  })
})

describe('revenueCatSource refund', () => {
  it('refunds a web billing purchase through the version 2 action, with its key', async () => {
    // Scenario: the source hands the request to the refund operation with the adapter's own client.
    const requests: Array<{ url: string; method: string | undefined }> = []
    const source = sourceWith({
      fetch: (url, init) => {
        requests.push({ url, method: init.method })
        return Promise.resolve(new Response('{"store":"rc_billing"}', { status: 200 }))
      }
    })
    const record = {
      purchaseReference: 'pur_1',
      entitlementNames: ['pro'],
      givesAccess: true,
      origin: 'web',
      environment: 'production',
      productReference: 'lifetime',
      purchasedAt: '2026-01-01T00:00:00.000Z',
      accessUntil: null,
      refundedAt: null
    } as const
    expect(await source.refund?.({ accountId: 'c' }, { kind: 'purchase', record })).toStrictEqual({
      outcome: 'accepted'
    })
    expect(requests).toStrictEqual([
      { url: 'http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/purchases/pur_1', method: 'GET' },
      {
        url: 'http://127.0.0.1:9/v2/projects/proj_PLACEHOLDER/purchases/pur_1/actions/refund',
        method: 'POST'
      }
    ])
  })
})

describe('revenueCatSource purchases', () => {
  it('has no management reference for a non-renewing purchase', async () => {
    // Scenario: a purchase carries no management reference, so none is answered.
    const purchase = {
      purchaseReference: 'p1',
      entitlementNames: ['pro'],
      givesAccess: true,
      origin: 'app_store',
      environment: 'production',
      productReference: 'lifetime',
      purchasedAt: '2026-01-01T00:00:00.000Z',
      accessUntil: null,
      refundedAt: null
    } as const
    expect(
      await sourceWith().capabilities({ accountId: 'c' }, { kind: 'purchase', record: purchase })
    ).toStrictEqual({ operations: [], managementReference: null })
  })
})

describe('revenueCatSource options', () => {
  it.each([
    ['an empty project', { projectId: '', apiKey: API_KEY }, ['projectId']],
    [
      'a sandbox in production without the confirmation',
      { projectId: 'p', apiKey: API_KEY, allowSandbox: true, isProduction: true },
      ['confirmSandboxInProduction']
    ]
  ])('refuses %s at boot, naming the option and no value', (_label, options, paths) => {
    // Scenario: SEC07: the second option is required, and the boot fails without it.
    expect.assertions(3)
    try {
      revenueCatSource(options)
    } catch (error) {
      expect(error).toBeInstanceOf(SubscriptionError)
      expect(error).toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID,
        optionPaths: paths
      })
      expect(JSON.stringify(error)).not.toContain(API_KEY)
    }
  })

  it('accepts sandbox access in production when the confirmation is given', () => {
    // Scenario: the two options together.
    expect(() =>
      sourceWith({ allowSandbox: true, isProduction: true, confirmSandboxInProduction: true })
    ).not.toThrow()
  })

  it('calls no host function and makes no request when the options are refused', () => {
    // Scenario: validation comes before every side effect.
    const warn = jest.fn()
    const fetchStub = jest.fn()
    expect(() =>
      revenueCatSource({
        projectId: '',
        apiKey: API_KEY,
        webhookAuthorization: AUTHORIZATION,
        logger: { warn },
        fetch: fetchStub
      })
    ).toThrow(SubscriptionError)
    expect(warn).toHaveBeenCalledTimes(0)
    expect(fetchStub).toHaveBeenCalledTimes(0)
  })

  it('reports the header-only method once, at boot, and says nothing when the signature is set', () => {
    // Scenario: FR12: the weaker method is allowed and reported.
    const warn = jest.fn()
    sourceWith({ webhookAuthorization: AUTHORIZATION, logger: { warn } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(HEADER_ONLY_WARNING)
    const quiet = jest.fn()
    sourceWith({
      webhookAuthorization: AUTHORIZATION,
      webhookSigningSecret: SIGNING,
      logger: { warn: quiet }
    })
    expect(quiet).toHaveBeenCalledTimes(0)
  })
})

describe('revenueCatSource webhooks', () => {
  const body = encode(loadFixture('webhook-initial-purchase'))

  it('accepts a request with the right header and returns the notification', async () => {
    // Scenario: the header method alone.
    const source = sourceWith({ webhookAuthorization: AUTHORIZATION })
    expect(
      await source.verifyWebhook({ rawBody: body, headers: { authorization: AUTHORIZATION } })
    ).toStrictEqual({
      accepted: true,
      notification: {
        eventId: 'event_PLACEHOLDER_initial-purchase',
        accountIds: ['user_PLACEHOLDER_a'],
        kind: 'initial_purchase',
        eventTime: '2026-11-18T11:06:40.000Z',
        environment: 'production'
      }
    })
  })

  it('accepts a request with the right signature, and one of two rotated secrets', async () => {
    // Scenario: the signature method, with the previous secret still valid.
    const source = sourceWith({
      webhookSigningSecret: { current: 'a-newer-secret', previous: SIGNING }
    })
    expect(await source.verifyWebhook({ rawBody: body, headers: signed(body) })).toMatchObject({
      accepted: true
    })
  })

  it.each([
    ['a wrong header', { authorization: 'wrong' }],
    ['no header', {}],
    ['a header that differs in case', { authorization: AUTHORIZATION.toUpperCase() }]
  ])('refuses %s with the one refusal value', async (_label, headers) => {
    // Scenario: SEC03: whatever failed, the caller gets the same frozen value.
    const source = sourceWith({ webhookAuthorization: AUTHORIZATION })
    expect(await source.verifyWebhook({ rawBody: body, headers })).toBe(REFUSED)
  })

  it('refuses a body altered after signing, a stale timestamp and a source with no method, all as the one value', async () => {
    // Scenario: AC02 for RevenueCat, through the assembled source.
    const source = sourceWith({ webhookSigningSecret: SIGNING })
    const altered = new TextEncoder().encode(`${new TextDecoder().decode(body)} `)
    const stale = sourceWith({
      webhookSigningSecret: SIGNING,
      clock: { now: () => new Date((T + 3600) * 1000) }
    })
    const bare = sourceWith()
    expect(await source.verifyWebhook({ rawBody: altered, headers: signed(body) })).toBe(REFUSED)
    expect(await stale.verifyWebhook({ rawBody: body, headers: signed(body) })).toBe(REFUSED)
    expect(await bare.verifyWebhook({ rawBody: body, headers: signed(body) })).toBe(REFUSED)
  })

  it('names the accounts of a transfer event, both of them, and reads nothing from the payload', async () => {
    // Scenario: both identifiers of the transfer are accounts to refresh.
    const source = sourceWith({ webhookAuthorization: AUTHORIZATION })
    const result = await source.verifyWebhook({
      rawBody: encode(loadFixture('webhook-transfer')),
      headers: { authorization: AUTHORIZATION }
    })
    expect(result).toMatchObject({
      accepted: true,
      notification: { kind: 'transfer', accountIds: ['user_PLACEHOLDER_a', 'user_PLACEHOLDER_b'] }
    })
  })

  it('reports an event that names only anonymous identifiers, without any identifier, and still accepts it', async () => {
    // Scenario: recorded and reported, never dropped silently: a log line, a callback, no account.
    const warn = jest.fn()
    const onUnidentifiedEvent = jest.fn()
    const source = sourceWith({
      webhookAuthorization: AUTHORIZATION,
      webhookSigningSecret: SIGNING,
      logger: { warn },
      onUnidentifiedEvent
    })
    const anonymous = encode(loadFixture('webhook-anonymous-only'))
    const result = await source.verifyWebhook({
      rawBody: anonymous,
      headers: { authorization: AUTHORIZATION, ...signed(anonymous) }
    })
    expect(result).toMatchObject({ accepted: true, notification: { accountIds: [] } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(UNIDENTIFIED_EVENT_LINE)
    expect(onUnidentifiedEvent).toHaveBeenCalledTimes(1)
    expect(onUnidentifiedEvent).toHaveBeenCalledWith({
      kind: 'initial_purchase',
      environment: 'production'
    })
    expect(JSON.stringify([...warn.mock.calls, ...onUnidentifiedEvent.mock.calls])).not.toContain(
      'RCAnonymousID'
    )
  })

  it('does not report an event that names an account, and survives a logger and a callback that throw', async () => {
    // Scenario: a failing report path never fails the verification.
    const warn = jest.fn()
    const onUnidentifiedEvent = jest.fn()
    const quiet = sourceWith({
      webhookAuthorization: AUTHORIZATION,
      webhookSigningSecret: SIGNING,
      logger: { warn },
      onUnidentifiedEvent
    })
    await quiet.verifyWebhook({
      rawBody: body,
      headers: { authorization: AUTHORIZATION, ...signed(body) }
    })
    expect([warn.mock.calls.length, onUnidentifiedEvent.mock.calls.length]).toStrictEqual([0, 0])
    const failing = sourceWith({
      webhookAuthorization: AUTHORIZATION,
      logger: {
        warn: () => {
          throw new Error('logger failed')
        }
      },
      onUnidentifiedEvent: () => {
        throw new Error('callback failed')
      }
    })
    const anonymous = encode(loadFixture('webhook-anonymous-only'))
    expect(
      await failing.verifyWebhook({ rawBody: anonymous, headers: { authorization: AUTHORIZATION } })
    ).toMatchObject({ accepted: true })
  })

  it('accepts a verified event of a kind it has never seen and names its accounts, so the receiver refreshes', async () => {
    // Scenario: FR20.
    const source = sourceWith({ webhookAuthorization: AUTHORIZATION })
    const result = await source.verifyWebhook({
      rawBody: encode(loadFixture('webhook-unknown-kind')),
      headers: { authorization: AUTHORIZATION }
    })
    expect(result).toMatchObject({
      accepted: true,
      notification: { kind: 'unknown', accountIds: ['user_PLACEHOLDER_a'] }
    })
  })
})

describe('revenueCatSource containment', () => {
  it('shows no credential or secret in JSON.stringify, a spread, util.inspect or the property names of the source', () => {
    // Scenario: SEC05 and D26: the four paths and the property names, over a source that holds every secret.
    const source = sourceWith({
      webhookAuthorization: { current: AUTHORIZATION },
      webhookSigningSecret: SIGNING
    })
    const outputs = [
      JSON.stringify(source),
      JSON.stringify({ ...source }),
      inspect(source),
      inspect(source, { showHidden: true }),
      inspect(source, { showHidden: true, depth: null }),
      Object.getOwnPropertyNames(source).join(),
      Object.getOwnPropertySymbols(source).map(String).join(),
      JSON.stringify(Object.entries(source))
    ]
    for (const output of outputs) {
      for (const sentinel of SENTINELS) expect(output).not.toContain(sentinel)
    }
    expect(Object.keys(source)).toStrictEqual(['name', 'admitsSandbox'])
  })
})
