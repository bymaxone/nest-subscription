/**
 * @fileoverview Unit tests for the webhook processor.
 *
 * Layer: unit.
 * Goal: a verified notification only triggers a read of the source, a failed check is one refusal
 * whatever its cause, an event is processed once, a failed event is processed again on retry, and
 * nothing of the request reaches a log or the observer.
 * Mocks: the fake source and the in-memory store; hand-resolved promises order concurrent calls;
 * the deadline's wait is replaced by one a test resolves.
 */
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type SourceNotification,
  type SubscriptionStore,
  type WebhookRequest,
  type WebhookVerification
} from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock,
  assertNoSentinel,
  createCapture,
  type Capture
} from '@bymax-one/nest-subscription/testing'

import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import type { SubscriptionChangeNotification } from '../options/subscription-options.types'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import type { DeadlineWait } from './deadline'
import { WebhookProcessor } from './webhook.processor'
import { toHttpAnswer } from './webhook-outcome'

const T0 = '2026-01-01T00:00:00.000Z'
const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const NOTIFICATION: SourceNotification = {
  eventId: 'evt-1',
  accountIds: ['acc-1'],
  kind: 'RENEWAL',
  eventTime: T0,
  environment: 'production'
}

/** A source whose verification a test scripts, over the fake's reads and requests. */
class ScriptedSource extends FakeSubscriptionSource {
  verification: () => Promise<WebhookVerification> | WebhookVerification = () => ({
    accepted: false
  })
  scripted = false

  override verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    return this.scripted
      ? Promise.resolve().then(() => this.verification())
      : super.verifyWebhook(request)
  }
}

/** One subscription that gives access. */
const RECORD: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: 'P1M',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** A snapshot with one active entitlement as of the given instant: the source's state. */
function entitled(
  sourceUpdatedAt: string,
  account: AccountReference = ACCOUNT
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: T0
    }),
    sourceUpdatedAt,
    subscriptions: [RECORD],
    entitlements: [
      {
        name: 'pro',
        active: true,
        until: null,
        grantingSubscriptionReference: null,
        grantingSubscriptionReferences: []
      }
    ]
  }
}

/** The pieces of one processor, with what each test needs to look at. */
interface Harness {
  readonly source: ScriptedSource
  readonly store: InMemorySubscriptionStore
  readonly clock: ManualClock
  readonly processor: WebhookProcessor
  readonly capture: Capture
  readonly hook: jest.Mock<unknown, [SubscriptionChangeNotification]>
  /** Resolves the deadline wait that is running, as if the time had passed. */
  readonly expire: () => void
}

/** Builds a processor over a scripted source, the in-memory store and a hand-resolved deadline. */
function harness(
  options: {
    store?: (base: InMemorySubscriptionStore) => SubscriptionStore
    multiTenant?: boolean
  } = {}
): Harness {
  const source = new ScriptedSource()
  const inMemory = new InMemorySubscriptionStore({ logger: () => undefined })
  const store = options.store?.(inMemory) ?? inMemory
  const clock = new ManualClock(T0)
  const capture = createCapture()
  const hook = jest.fn<unknown, [SubscriptionChangeNotification]>()
  const resolved = resolveOptions({
    source,
    store,
    clock,
    accountResolver: () => null,
    logger: capture.logger,
    observer: capture.observer,
    multiTenant: options.multiTenant ?? false
  })
  const bridge = new ObserverBridge(resolved.observer, clock)
  const dispatcher = new ChangeDispatcher(hook, store, resolved.logger, bridge)
  const refresher = new SnapshotRefresher(source, store, clock, null, dispatcher, bridge)
  let expire = (): void => undefined
  const wait: DeadlineWait = () =>
    new Promise<void>((resolve) => {
      expire = resolve
    })
  const processor = new WebhookProcessor(source, store, clock, resolved, refresher, bridge, wait)
  return { source, store: inMemory, clock, processor, capture, hook, expire: () => expire() }
}

/** The store with some methods replaced; the others reach it unchanged. */
function delegating(
  base: InMemorySubscriptionStore,
  overrides: Partial<SubscriptionStore>
): SubscriptionStore {
  return {
    getSnapshot: (key) => base.getSnapshot(key),
    putSnapshot: (key, snapshot, changes, at) => base.putSnapshot(key, snapshot, changes, at),
    clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
    listKeysWithPendingChanges: (limit, cursor) => base.listKeysWithPendingChanges(limit, cursor),
    markEventProcessed: (source, id, at) => base.markEventProcessed(source, id, at),
    forgetEvent: (source, id) => base.forgetEvent(source, id),
    deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
    listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor),
    ...overrides
  }
}

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
}

describe('WebhookProcessor verified notifications', () => {
  it('stores what the source reads and ignores the state the payload claims', async () => {
    // Scenario: the signed payload claims an active entitlement for the account while the source
    // says the account has none. Only the source's state may be stored (SEC01).
    const { source, store, processor } = harness()
    const claimed = {
      ...NOTIFICATION,
      entitlements: { pro: { active: true, accessUntil: null } },
      subscriptions: [{ status: 'active', givesAccess: true }]
    }
    const request = source.buildRequest(claimed)
    expect(new TextDecoder().decode(request.rawBody)).toContain('"givesAccess":true')
    const outcome = await processor.process(request)
    const stored = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(outcome).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.readCount(ACCOUNT)).toBe(1)
    expect(stored?.snapshot.entitlements).toStrictEqual([])
    expect(stored?.snapshot.subscriptions).toStrictEqual([])
  })

  it('stores the source state when the source says the account is entitled', async () => {
    // Scenario: the stored snapshot is the source's own, so the source's entitlement is stored.
    const { source, store, processor } = harness()
    source.setAccount(ACCOUNT, entitled('2026-01-01T00:00:10.000Z'))
    await processor.process(source.buildRequest(NOTIFICATION))
    const stored = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(stored?.snapshot.entitlements[0]?.active).toBe(true)
  })

  it('passes the adapter the bytes and the headers exactly as received', async () => {
    // Scenario: verification is delegated, with the very request object the host handed over.
    const { source, processor } = harness()
    const verify = jest.spyOn(source, 'verifyWebhook')
    const request = source.buildRequest(NOTIFICATION)
    await processor.process(request)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify.mock.calls[0]?.[0]).toBe(request)
  })

  it('records the event before it reads the source', async () => {
    // Scenario: the order of calls is mark, read, so a duplicate arriving mid-read is seen.
    const { source, store, processor } = harness()
    const order: string[] = []
    jest.spyOn(store, 'markEventProcessed').mockImplementation((...args) => {
      order.push('mark')
      return InMemorySubscriptionStore.prototype.markEventProcessed.apply(store, args)
    })
    jest.spyOn(source, 'readAccount').mockImplementation((account) => {
      order.push('read')
      return FakeSubscriptionSource.prototype.readAccount.call(source, account)
    })
    await processor.process(source.buildRequest(NOTIFICATION))
    expect(order).toStrictEqual(['mark', 'read'])
  })

  it('records the event under the source name with the receipt instant', async () => {
    // Scenario: the identifier is scoped by source and stamped by the injected clock.
    const { source, store, processor, clock } = harness()
    const mark = jest.spyOn(store, 'markEventProcessed')
    clock.advance(5000)
    await processor.process(source.buildRequest(NOTIFICATION))
    expect(mark).toHaveBeenCalledWith('fake', 'evt-1', '2026-01-01T00:00:05.000Z')
  })

  it('reads every distinct account a notification names, once each', async () => {
    // Scenario: three names, one of them repeated, are two accounts and two reads.
    const { source, processor } = harness()
    const outcome = await processor.process(
      source.buildRequest({ ...NOTIFICATION, accountIds: ['acc-1', 'acc-2', 'acc-1'] })
    )
    expect(outcome).toStrictEqual({ kind: 'processed', accounts: 2 })
    expect(source.readCount({ accountId: 'acc-1' })).toBe(1)
    expect(source.readCount({ accountId: 'acc-2' })).toBe(1)
  })

  it('treats an event kind nobody knows like any other', async () => {
    // Scenario: a kind added by the source tomorrow is accepted and refreshes the account (FR20).
    const { source, processor } = harness()
    const outcome = await processor.process(
      source.buildRequest({ ...NOTIFICATION, kind: 'SOMETHING_NEW_FROM_THE_SOURCE' })
    )
    expect(outcome.kind).toBe('processed')
    expect(source.readCount(ACCOUNT)).toBe(1)
  })

  it('processes a sandbox notification like a production one', async () => {
    // Scenario: whether sandbox state grants access is decided by the read, not by the receiver.
    const { source, processor } = harness()
    const outcome = await processor.process(
      source.buildRequest({ ...NOTIFICATION, environment: 'sandbox' })
    )
    expect(outcome.kind).toBe('processed')
    expect(source.readCount(ACCOUNT)).toBe(1)
  })

  it('answers a notification that names no account as ignored and touches nothing', async () => {
    // Scenario: nothing to read, nothing to record, nothing to store.
    const { source, store, processor } = harness()
    const mark = jest.spyOn(store, 'markEventProcessed')
    const outcome = await processor.process(
      source.buildRequest({ ...NOTIFICATION, accountIds: [] })
    )
    expect(outcome).toStrictEqual({ kind: 'ignored' })
    expect(mark).toHaveBeenCalledTimes(0)
    expect(source.totalReads).toBe(0)
  })

  it('does not wait for the host hook', async () => {
    // Scenario: the hook never returns; the receiver still answers (the hook is outside the deadline).
    const { source, processor, hook } = harness()
    source.setAccount(ACCOUNT, entitled('2026-01-01T00:00:10.000Z'))
    hook.mockReturnValue(new Promise(() => undefined))
    const outcome = await processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expect(outcome.kind).toBe('processed')
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('calls the host hook once with the changes the read produced', async () => {
    // Scenario: a stored change reaches the hook once, with the source's state as `current`.
    const { source, processor, hook } = harness()
    source.setAccount(ACCOUNT, entitled('2026-01-01T00:00:10.000Z'))
    await processor.process(source.buildRequest(NOTIFICATION))
    await flush()
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook.mock.calls[0]?.[0].current.entitlements[0]?.active).toBe(true)
  })
})

describe('WebhookProcessor refusals', () => {
  /** A request signed for a notification, and ways to break it. */
  function signed(source: FakeSubscriptionSource): WebhookRequest {
    return source.buildRequest(NOTIFICATION)
  }

  const THROWING_ERROR = new Error('verifier exploded')
  const REFUSALS: ReadonlyArray<readonly [string, (source: ScriptedSource) => WebhookRequest]> = [
    [
      'a wrong signature',
      (source) => ({ ...signed(source), headers: { 'x-fake-signature': 'f'.repeat(64) } })
    ],
    ['a missing signature header', (source) => ({ ...signed(source), headers: {} })],
    [
      'a body altered after signing',
      (source) => {
        const request = signed(source)
        const rawBody = new TextEncoder().encode(
          new TextDecoder().decode(request.rawBody).replace('acc-1', 'acc-9')
        )
        return { ...request, rawBody }
      }
    ],
    [
      'a body that is not JSON',
      (source) => {
        const rawBody = new TextEncoder().encode('not json at all')
        return {
          rawBody,
          headers: {
            'x-fake-signature': source.buildRequest(NOTIFICATION).headers['x-fake-signature']
          }
        }
      }
    ],
    ['an empty body', () => ({ rawBody: new Uint8Array(), headers: {} })]
  ]

  const VERIFIER_FAILURES: ReadonlyArray<readonly [string, () => unknown]> = [
    ['a verifier that rejects', () => Promise.reject(THROWING_ERROR)],
    [
      'a verifier that throws',
      () => {
        throw THROWING_ERROR
      }
    ],
    ['an acceptance without a notification', () => ({ accepted: true })],
    ['an acceptance with a blank event identifier', () => accept({ eventId: '  ' })],
    ['an acceptance with a missing event identifier', () => accept({ eventId: undefined })],
    ['an acceptance whose accounts are not a list', () => accept({ accountIds: 'acc-1' })],
    ['an acceptance naming a blank account', () => accept({ accountIds: ['acc-1', ' '] })],
    ['an acceptance naming an account that is not text', () => accept({ accountIds: [7] })],
    ['an answer that is null', () => null],
    ['an answer that is a string', () => 'accepted'],
    ['an acceptance flag that is not true', () => ({ accepted: 'yes', notification: NOTIFICATION })]
  ]

  /** An acceptance whose notification differs from the good one by the given fields. */
  function accept(fields: Record<string, unknown>): unknown {
    return { accepted: true, notification: { ...NOTIFICATION, ...fields } }
  }

  /** Asserts the processor changed nothing: no read, no record, no stored snapshot, no hook. */
  async function expectUntouched(h: Harness, mark: jest.SpyInstance): Promise<void> {
    await flush()
    expect(h.source.totalReads).toBe(0)
    expect(mark).toHaveBeenCalledTimes(0)
    expect(await h.store.getSnapshot(encodeAccountKey(ACCOUNT))).toBeNull()
    expect(h.hook).toHaveBeenCalledTimes(0)
  }

  it.each(REFUSALS)('refuses %s with the one refusal and changes nothing', async (_name, build) => {
    // Scenario: the fake source refuses this request for its own reason; the answer is the shared
    // refusal and the store, the source and the hook are untouched.
    const h = harness()
    const mark = jest.spyOn(h.store, 'markEventProcessed')
    const outcome = await h.processor.process(build(h.source))
    expect(outcome).toStrictEqual({ kind: 'refused' })
    expect(toHttpAnswer(outcome)).toBe(toHttpAnswer({ kind: 'refused' }))
    expect(JSON.stringify(toHttpAnswer(outcome))).toBe(
      JSON.stringify(toHttpAnswer({ kind: 'refused' }))
    )
    await expectUntouched(h, mark)
  })

  it.each(VERIFIER_FAILURES)('refuses %s with the one refusal', async (_name, script) => {
    // Scenario: the adapter itself misbehaves; a verifier that throws is a refusal and never a
    // server error, so a malformed request cannot make the source retry.
    const h = harness()
    const mark = jest.spyOn(h.store, 'markEventProcessed')
    h.source.scripted = true
    h.source.verification = script as () => Promise<WebhookVerification>
    const outcome = await h.processor.process(signed(h.source))
    expect(outcome).toStrictEqual({ kind: 'refused' })
    expect(toHttpAnswer(outcome)).toBe(toHttpAnswer({ kind: 'refused' }))
    await expectUntouched(h, mark)
  })

  it('answers every cause with byte-identical answers', async () => {
    // Scenario: the answers of all causes, compared as serialized text, are one text.
    const answers: string[] = []
    for (const [, build] of REFUSALS) {
      const h = harness()
      answers.push(JSON.stringify(toHttpAnswer(await h.processor.process(build(h.source)))))
    }
    for (const [, script] of VERIFIER_FAILURES) {
      const h = harness()
      h.source.scripted = true
      h.source.verification = script as () => Promise<WebhookVerification>
      answers.push(JSON.stringify(toHttpAnswer(await h.processor.process(signed(h.source)))))
    }
    expect(answers.length).toBe(REFUSALS.length + VERIFIER_FAILURES.length)
    expect(new Set(answers).size).toBe(1)
  })

  it('reports a refusal to the observer without a cause', async () => {
    // Scenario: the observer is told `refused` and nothing that names a check.
    const h = harness()
    await h.processor.process({ rawBody: new Uint8Array(), headers: {} })
    expect(h.capture.payloads).toStrictEqual([
      { method: 'onWebhook', payload: { outcome: 'refused', durationMs: 0, retained: false } }
    ])
  })
})

describe('WebhookProcessor de-duplication', () => {
  it('reads the source once for the same event delivered five times in turn', async () => {
    // Scenario: one event, five sequential deliveries (AC03): one read, one host notification.
    const { source, processor, hook } = harness()
    source.setAccount(ACCOUNT, entitled('2026-01-01T00:00:10.000Z'))
    const request = source.buildRequest(NOTIFICATION)
    const outcomes = []
    for (let n = 0; n < 5; n += 1) outcomes.push(await processor.process(request))
    await flush()
    expect(outcomes.map((outcome) => outcome.kind)).toStrictEqual([
      'processed',
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate'
    ])
    expect(source.readCount(ACCOUNT)).toBe(1)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('reads the source once for the same event delivered five times at once', async () => {
    // Scenario: five concurrent deliveries while the read is held: exactly one reads the source.
    const { source, processor, hook } = harness()
    source.setAccount(ACCOUNT, entitled('2026-01-01T00:00:10.000Z'))
    const release = source.delayNextRead()
    const request = source.buildRequest(NOTIFICATION)
    const all = Promise.all([1, 2, 3, 4, 5].map(() => processor.process(request)))
    await flush()
    release()
    const outcomes = await all
    await flush()
    expect(outcomes.filter((outcome) => outcome.kind === 'processed')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.kind === 'duplicate')).toHaveLength(4)
    expect(source.readCount(ACCOUNT)).toBe(1)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('answers a repeated identifier without reading the source', async () => {
    // Scenario: the identifier was recorded earlier by another delivery; no read is made.
    const { source, store, processor } = harness()
    await store.markEventProcessed('fake', 'evt-1', T0)
    const outcome = await processor.process(source.buildRequest(NOTIFICATION))
    expect(outcome).toStrictEqual({ kind: 'duplicate' })
    expect(source.totalReads).toBe(0)
  })

  it('keeps events of different identifiers apart', async () => {
    // Scenario: two events for the same account are two reads.
    const { source, processor } = harness()
    await processor.process(source.buildRequest(NOTIFICATION))
    await processor.process(source.buildRequest({ ...NOTIFICATION, eventId: 'evt-2' }))
    expect(source.readCount(ACCOUNT)).toBe(2)
  })

  it('removes the identifier of an event whose read failed, so the retry is processed', async () => {
    // Scenario: the first delivery fails at the source; the retry of the same event is processed (D16).
    const { source, processor } = harness()
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest(NOTIFICATION)
    const first = await processor.process(request)
    const second = await processor.process(request)
    expect(first).toStrictEqual({ kind: 'failed' })
    expect(second).toStrictEqual({ kind: 'processed', accounts: 1 })
    expect(source.readCount(ACCOUNT)).toBe(2)
  })

  it('removes the identifier through forgetEvent under the source name', async () => {
    // Scenario: the identifier removed is the one recorded, by source and event.
    const { source, store, processor } = harness()
    const forget = jest.spyOn(store, 'forgetEvent')
    source.failNextRead(new Error('source down'))
    await processor.process(source.buildRequest(NOTIFICATION))
    expect(forget).toHaveBeenCalledTimes(1)
    expect(forget).toHaveBeenCalledWith('fake', 'evt-1')
  })

  it('fails the event when one of several accounts cannot be read, and forgets it', async () => {
    // Scenario: two accounts; the first read fails; the event is failed and its retry is allowed.
    const { source, processor } = harness()
    source.failNextRead(new Error('source down'))
    const request = source.buildRequest({ ...NOTIFICATION, accountIds: ['acc-1', 'acc-2'] })
    const first = await processor.process(request)
    const second = await processor.process(request)
    expect(first).toStrictEqual({ kind: 'failed' })
    expect(second).toStrictEqual({ kind: 'processed', accounts: 2 })
  })

  it('fails the event, without forgetting, when the store cannot record it', async () => {
    // Scenario: the store is down at the first call; nothing was recorded, so nothing is forgotten.
    const h = harness({
      store: (base) =>
        delegating(base, { markEventProcessed: () => Promise.reject(new Error('store down')) })
    })
    const forget = jest.spyOn(h.store, 'forgetEvent')
    const outcome = await h.processor.process(h.source.buildRequest(NOTIFICATION))
    expect(outcome).toStrictEqual({ kind: 'failed' })
    expect(forget).toHaveBeenCalledTimes(0)
    expect(h.source.totalReads).toBe(0)
  })

  it('still answers failed, and tells the observer, when the identifier cannot be forgotten', async () => {
    // Scenario: the source is down and so is forgetEvent; the outcome is failed, the identifier
    // stays recorded, the observer says so and the log holds a fixed sentence with a code.
    const h = harness({
      store: (base) =>
        delegating(base, {
          forgetEvent: () =>
            Promise.reject(new SubscriptionError('SUBSCRIPTION_SOURCE_UNAVAILABLE'))
        })
    })
    h.source.failNextRead(new Error('source down'))
    const request = h.source.buildRequest(NOTIFICATION)
    const first = await h.processor.process(request)
    const retry = await h.processor.process(request)
    expect(first).toStrictEqual({ kind: 'failed' })
    expect(retry).toStrictEqual({ kind: 'duplicate' })
    expect(h.capture.payloads.filter((entry) => entry.method === 'onWebhook')).toStrictEqual([
      { method: 'onWebhook', payload: { outcome: 'failed', durationMs: 0, retained: true } },
      { method: 'onWebhook', payload: { outcome: 'duplicate', durationMs: 0, retained: false } }
    ])
    expect(h.capture.lines).toStrictEqual([
      'A failed webhook event could not be forgotten; its retries are answered as already seen: SUBSCRIPTION_SOURCE_UNAVAILABLE.'
    ])
  })

  it("logs a forget failure that is not the library's as unclassified", async () => {
    // Scenario: the store raises its own error; the line carries `unclassified` and no error text.
    const h = harness({
      store: (base) =>
        delegating(base, { forgetEvent: () => Promise.reject(new Error('secret-text')) })
    })
    h.source.failNextRead(new Error('source down'))
    await h.processor.process(h.source.buildRequest(NOTIFICATION))
    expect(h.capture.lines).toHaveLength(1)
    expect(h.capture.lines[0]).toMatch(/: unclassified\.$/)
    expect(h.capture.lines[0]).not.toContain('secret-text')
  })
})

describe('WebhookProcessor tenants', () => {
  it("reads the accounts under the tenant of the host's route", async () => {
    // Scenario: a multi-tenant host passes the tenant of its authenticated route (SEC08).
    const h = harness({ multiTenant: true })
    const account = { tenantId: 't-1', accountId: 'acc-1' }
    const outcome = await h.processor.process(h.source.buildRequest(NOTIFICATION), {
      tenantId: 't-1'
    })
    expect(outcome.kind).toBe('processed')
    expect(h.source.readCount(account)).toBe(1)
    expect(h.source.readCount(ACCOUNT)).toBe(0)
    expect(await h.store.getSnapshot(encodeAccountKey(account))).not.toBeNull()
  })

  it.each([
    ['no context', undefined],
    ['an empty context', {}],
    ['a blank tenant', { tenantId: '  ' }]
  ])('throws for %s in a multi-tenant host before anything is called', async (_name, context) => {
    // Scenario: a multi-tenant host that forgot the tenant gets a programming error, and the
    // adapter, the store and the source are never called.
    const h = harness({ multiTenant: true })
    const verify = jest.spyOn(h.source, 'verifyWebhook')
    const mark = jest.spyOn(h.store, 'markEventProcessed')
    await expect(
      h.processor.process(h.source.buildRequest(NOTIFICATION), context)
    ).rejects.toMatchObject({ code: 'SUBSCRIPTION_INVALID_INPUT' })
    expect(verify).toHaveBeenCalledTimes(0)
    expect(mark).toHaveBeenCalledTimes(0)
    expect(h.source.totalReads).toBe(0)
    expect(h.capture.payloads).toStrictEqual([])
  })

  it('never takes the tenant from the body', async () => {
    // Scenario: a payload that names a tenant of its own is read under the route's tenant only.
    const h = harness({ multiTenant: true })
    const withTenant = { ...NOTIFICATION, tenantId: 'evil' }
    await h.processor.process(h.source.buildRequest(withTenant), { tenantId: 't-1' })
    expect(h.source.readCount({ tenantId: 'evil', accountId: 'acc-1' })).toBe(0)
    expect(h.source.readCount({ tenantId: 't-1', accountId: 'acc-1' })).toBe(1)
  })

  it('ignores a blank tenant in a single-tenant host', async () => {
    // Scenario: a blank tenant means none; the account is read without one.
    const h = harness()
    await h.processor.process(h.source.buildRequest(NOTIFICATION), { tenantId: ' ' })
    expect(h.source.readCount(ACCOUNT)).toBe(1)
  })
})

describe('WebhookProcessor containment', () => {
  it('keeps every sentinel of the request out of the log and the observer', async () => {
    // Scenario: sentinels sit in the account, the event, a header and the body; across every
    // outcome none reaches a log line or an observer payload (SEC06).
    const h = harness()
    const sentinels = ['sentinel-account', 'sentinel-event', 'sentinel-header', 'sentinel-body']
    const notification = {
      ...NOTIFICATION,
      eventId: sentinels[1] as string,
      accountIds: [sentinels[0] as string],
      note: sentinels[3]
    }
    const good = h.source.buildRequest(notification)
    const withHeader = { ...good, headers: { ...good.headers, authorization: sentinels[2] } }
    h.source.failNextRead(new Error(sentinels.join(' ')))
    await h.processor.process(withHeader)
    await h.processor.process(withHeader)
    await h.processor.process({
      rawBody: new TextEncoder().encode(sentinels[3]),
      headers: { a: sentinels[2] }
    })
    await h.processor.process(h.source.buildRequest({ ...notification, accountIds: [] }))
    assertNoSentinel(h.capture, sentinels)
    const heard = h.capture.payloads
      .filter((entry) => entry.method === 'onWebhook')
      .map((entry) => (entry.payload as { outcome: string }).outcome)
    expect(heard).toStrictEqual(['failed', 'processed', 'refused', 'ignored'])
  })
})
