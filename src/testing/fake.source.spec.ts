/**
 * @fileoverview Pins the behaviour of the scriptable fake source: state, reads, delays, failures,
 * the signed webhook requests it accepts and the capabilities it scripts.
 * @layer testing
 */
import { createHash } from 'node:crypto'
import type {
  ManagedRecord,
  SourceNotification,
  SubscriptionSource
} from '@bymax-one/nest-subscription'
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import { FakeSubscriptionSource } from './fake.source'

const NOW = new Date('2026-03-01T12:00:00.000Z')
const clock = { now: (): Date => NOW }

const notification: SourceNotification = {
  eventId: 'evt_1',
  accountIds: ['acc_1', 'acc_2'],
  kind: 'RENEWAL',
  eventTime: '2026-03-01T11:00:00.000Z',
  environment: 'production'
}

const record: SubscriptionRecord = {
  subscriptionReference: 's1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'play_store',
  environment: 'production',
  productReference: 'pro',
  billingInterval: 'month',
  currentPeriodStart: '2026-03-01T00:00:00.000Z',
  currentPeriodEnd: '2026-04-01T00:00:00.000Z',
  accessUntil: '2026-04-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: 'https://manage.example/s1'
}

function snapshotFor(accountId: string, tenantId?: string): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId,
      ...(tenantId === undefined ? {} : { tenantId }),
      source: 'fake',
      fetchedAt: '2026-03-01T00:00:00.000Z'
    }),
    subscriptions: [record]
  }
}

/** Lets every promise that can settle without a timer do so. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
}

describe('FakeSubscriptionSource reads', () => {
  it('reads an account nobody set as an account the source does not know', async () => {
    // Scenario: the empty snapshot carries the source name and the injected clock's instant.
    const source = new FakeSubscriptionSource({ name: 'scripted', clock })
    const snapshot = await source.readAccount({ accountId: 'acc_1' })
    expect(snapshot).toEqual(
      createEmptySnapshot({
        accountId: 'acc_1',
        source: 'scripted',
        fetchedAt: NOW.toISOString()
      })
    )
  })

  it('carries the tenant of an unknown account when there is one', async () => {
    // Scenario: a multi-tenant host reads an account the source does not know.
    const source = new FakeSubscriptionSource({ clock })
    const snapshot = await source.readAccount({ accountId: 'acc_1', tenantId: 't1' })
    expect(snapshot.tenantId).toBe('t1')
  })

  it('names itself fake and reads the system clock by default', async () => {
    // Scenario: no options; the name is the default and the instant is the present.
    const before = Date.now()
    const source = new FakeSubscriptionSource()
    const snapshot = await source.readAccount({ accountId: 'acc_1' })
    expect(source.name).toBe('fake')
    expect(snapshot.source).toBe('fake')
    expect(Date.parse(snapshot.fetchedAt)).toBeGreaterThanOrEqual(before)
  })

  it('returns the state a test set, for that account and tenant only', async () => {
    // Scenario: the same account identifier under two tenants and with none are three accounts.
    const source = new FakeSubscriptionSource({ clock })
    const plain = snapshotFor('acc_1')
    const tenant = snapshotFor('acc_1', 't1')
    source.setAccount({ accountId: 'acc_1' }, plain)
    source.setAccount({ accountId: 'acc_1', tenantId: 't1' }, tenant)
    expect(await source.readAccount({ accountId: 'acc_1' })).toBe(plain)
    expect(await source.readAccount({ accountId: 'acc_1', tenantId: 't1' })).toBe(tenant)
    expect(
      (await source.readAccount({ accountId: 'acc_1', tenantId: 't2' })).subscriptions
    ).toEqual([])
  })

  it('counts reads per account and in all', async () => {
    // Scenario: later phases assert zero source calls; the counters say how many there were.
    const source = new FakeSubscriptionSource({ clock })
    expect(source.totalReads).toBe(0)
    await source.readAccount({ accountId: 'a' })
    await source.readAccount({ accountId: 'a' })
    await source.readAccount({ accountId: 'b' })
    expect(source.readCount({ accountId: 'a' })).toBe(2)
    expect(source.readCount({ accountId: 'b' })).toBe(1)
    expect(source.readCount({ accountId: 'c' })).toBe(0)
    expect(source.totalReads).toBe(3)
  })

  it('fails the next read once, with the error given, and still counts it', async () => {
    // Scenario: one failure is scripted; the read after it succeeds.
    const source = new FakeSubscriptionSource({ clock })
    const failure = new Error('source down')
    source.failNextRead(failure)
    await expect(source.readAccount({ accountId: 'a' })).rejects.toBe(failure)
    await expect(source.readAccount({ accountId: 'a' })).resolves.toMatchObject({ accountId: 'a' })
    expect(source.readCount({ accountId: 'a' })).toBe(2)
  })

  it('fails as many reads as failures were scripted, in order', async () => {
    // Scenario: two failures queue; the third read succeeds.
    const source = new FakeSubscriptionSource({ clock })
    source.failNextRead('first')
    source.failNextRead('second')
    await expect(source.readAccount({ accountId: 'a' })).rejects.toBe('first')
    await expect(source.readAccount({ accountId: 'a' })).rejects.toBe('second')
    await expect(source.readAccount({ accountId: 'a' })).resolves.toBeDefined()
  })

  it('holds a read until the test releases it, with no timer', async () => {
    // Scenario: the read is pending until the release function is called.
    const source = new FakeSubscriptionSource({ clock })
    const release = source.delayNextRead()
    let settled = false
    const pending = source.readAccount({ accountId: 'a' }).then(() => {
      settled = true
    })
    await settle()
    expect(settled).toBe(false)
    release()
    await pending
    expect(settled).toBe(true)
  })

  it('holds several reads, each by its own release', async () => {
    // Scenario: two delays queue; releasing the second first leaves the first read pending.
    const source = new FakeSubscriptionSource({ clock })
    const releaseFirst = source.delayNextRead()
    const releaseSecond = source.delayNextRead()
    const done: string[] = []
    const first = source.readAccount({ accountId: 'a' }).then(() => done.push('first'))
    const second = source.readAccount({ accountId: 'b' }).then(() => done.push('second'))
    releaseSecond()
    await settle()
    expect(done).toEqual(['second'])
    releaseFirst()
    await Promise.all([first, second])
    expect(done).toEqual(['second', 'first'])
  })

  it('gives a scripted failure to the read that was next when it was scripted', async () => {
    // Scenario: a delay and a failure are scripted for one read; a later read starts and ends
    // while the first is held. The later read succeeds and the held read fails once released.
    const source = new FakeSubscriptionSource({ clock })
    const release = source.delayNextRead()
    const failure = new Error('scripted')
    source.failNextRead(failure)
    const held = source.readAccount({ accountId: 'a' }).then(
      () => 'resolved',
      (error: unknown) => error
    )
    await expect(source.readAccount({ accountId: 'b' })).resolves.toMatchObject({ accountId: 'b' })
    release()
    expect(await held).toBe(failure)
  })

  it('delays before it fails when both are scripted for one read', async () => {
    // Scenario: the failure only surfaces after the release.
    const source = new FakeSubscriptionSource({ clock })
    const release = source.delayNextRead()
    source.failNextRead('late')
    const outcome = source.readAccount({ accountId: 'a' }).then(
      () => 'resolved',
      (error: unknown) => error
    )
    await settle()
    release()
    expect(await outcome).toBe('late')
  })
})

describe('FakeSubscriptionSource webhooks', () => {
  const source = new FakeSubscriptionSource({ clock })

  it('accepts a request it built and returns the notification', async () => {
    // Scenario: the round trip of a notification through its own signed request.
    expect(await source.verifyWebhook(source.buildRequest(notification))).toEqual({
      accepted: true,
      notification
    })
  })

  it('refuses a request whose body changed after it was signed', async () => {
    // Scenario: one byte of the body differs from the signed one.
    const request = source.buildRequest(notification)
    const tampered = new Uint8Array(request.rawBody)
    tampered[0] = 32
    expect(await source.verifyWebhook({ ...request, rawBody: tampered })).toEqual({
      accepted: false
    })
  })

  it('refuses a request with no signature or a wrong one', async () => {
    // Scenario: the header is absent, then present with a value that signs nothing.
    const { rawBody } = source.buildRequest(notification)
    expect(await source.verifyWebhook({ rawBody, headers: {} })).toEqual({ accepted: false })
    expect(
      await source.verifyWebhook({ rawBody, headers: { 'x-fake-signature': 'nope' } })
    ).toEqual({ accepted: false })
  })

  it('refuses a body that is not a notification, even when it is signed', async () => {
    // Scenario: the signature is right, the body is not JSON, or JSON of the wrong shape.
    const bodies = [
      'not json',
      'null',
      '7',
      '{}',
      JSON.stringify({ ...notification, eventId: 1 }),
      JSON.stringify({ ...notification, accountIds: 'acc_1' }),
      JSON.stringify({ ...notification, accountIds: [1] }),
      JSON.stringify({ ...notification, accountIds: ['acc_1', 1] }),
      JSON.stringify({ ...notification, kind: null }),
      JSON.stringify({ ...notification, eventTime: 5 }),
      JSON.stringify({ ...notification, environment: 'staging' })
    ]
    for (const body of bodies) {
      const rawBody = new TextEncoder().encode(body)
      const headers = { 'x-fake-signature': createHash('sha256').update(rawBody).digest('hex') }
      expect(await source.verifyWebhook({ rawBody, headers })).toEqual({ accepted: false })
    }
  })

  it('hands queued requests out oldest first and then none', () => {
    // Scenario: two notifications are queued; the third take finds the queue empty.
    const queued = new FakeSubscriptionSource({ clock })
    const first = queued.queueNotification(notification)
    const second = queued.queueNotification({ ...notification, eventId: 'evt_2' })
    expect(queued.nextQueuedRequest()).toBe(first)
    expect(queued.nextQueuedRequest()).toBe(second)
    expect(queued.nextQueuedRequest()).toBeUndefined()
  })
})

describe('FakeSubscriptionSource management', () => {
  const account = { accountId: 'a' }
  const target: ManagedRecord = { kind: 'subscription', record }
  const purchase: ManagedRecord = {
    kind: 'purchase',
    record: {
      purchaseReference: 'p1',
      entitlementNames: ['pro'],
      givesAccess: true,
      origin: 'play_store',
      environment: 'production',
      productReference: 'lifetime',
      purchasedAt: '2026-01-01T00:00:00.000Z',
      accessUntil: null,
      refundedAt: null
    }
  }

  it('declares no capabilities until a test scripts them, per origin', async () => {
    // Scenario: the origin of the record picks the answer, for a subscription and a purchase.
    const source = new FakeSubscriptionSource({ clock })
    expect(await source.capabilities(account, target)).toEqual({
      operations: [],
      managementReference: null
    })
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: 'https://manage.example/s1'
    })
    expect((await source.capabilities(account, target)).operations).toEqual(['stop_renewal'])
    expect((await source.capabilities(account, purchase)).operations).toEqual(['stop_renewal'])
    expect(
      (
        await source.capabilities(account, {
          kind: 'subscription',
          record: { ...record, origin: 'app_store' }
        })
      ).operations
    ).toEqual([])
  })

  it('answers that the person must act, with the management reference, by default', async () => {
    // Scenario: nothing scripted; each of the five operations is counted on its own.
    const source = new FakeSubscriptionSource({ clock })
    expect(source.stopRenewalCalls).toBe(0)
    const expected = {
      outcome: 'customer_action_required',
      managementReference: 'https://manage.example/s1'
    }
    expect(await source.stopRenewal(account, record)).toEqual(expected)
    expect(await source.resume(account, record)).toEqual(expected)
    expect(await source.changeProduct(account, record, 'pro_annual')).toEqual(expected)
    expect(await source.extend(account, record, { days: 3 })).toEqual(expected)
    expect(await source.refund(account, target)).toEqual(expected)
    expect(await source.refund(account, purchase)).toEqual({
      outcome: 'customer_action_required',
      managementReference: null
    })
    expect(source.stopRenewalCalls).toBe(1)
    expect(source.operationCalls('refund')).toBe(2)
    expect(source.operationCalls('resume')).toBe(1)
    expect(source.totalOperationCalls).toBe(6)
  })

  it('answers with the result scripted for the operation and the origin', async () => {
    // Scenario: an accepted request for one operation and origin; another origin and another
    // operation keep the default.
    const source = new FakeSubscriptionSource({ clock })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    expect(await source.stopRenewal(account, record)).toEqual({ outcome: 'accepted' })
    expect((await source.stopRenewal(account, { ...record, origin: 'web' })).outcome).toBe(
      'customer_action_required'
    )
    expect((await source.resume(account, record)).outcome).toBe('customer_action_required')
  })

  it('is usable wherever the source port is expected', async () => {
    // Scenario: the class is passed as the port, with no private member needed.
    const port: SubscriptionSource = new FakeSubscriptionSource({ clock })
    expect((await port.readAccount({ accountId: 'a' })).accountId).toBe('a')
  })
})
