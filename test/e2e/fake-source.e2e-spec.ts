/**
 * @fileoverview Drives the fake source from the `testing` subpath the way a host's tests do:
 * script a state, queue a notification, delay and fail reads, and count them.
 * @layer e2e
 */
import type { SourceNotification, SubscriptionRecord } from '@bymax-one/nest-subscription'
import { FakeSubscriptionSource } from '@bymax-one/nest-subscription/testing'
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import { createHash } from 'node:crypto'

const NOW = '2026-03-01T12:00:00.000Z'
const clock = { now: (): Date => new Date(NOW) }

const NOTIFICATION: SourceNotification = {
  eventId: 'evt_1',
  accountIds: ['acc_1'],
  kind: 'RENEWAL',
  eventTime: NOW,
  environment: 'sandbox'
}

const RECORD: SubscriptionRecord = {
  subscriptionReference: 's1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'play_store',
  environment: 'production',
  productReference: 'pro',
  billingInterval: 'month',
  currentPeriodStart: NOW,
  currentPeriodEnd: NOW,
  accessUntil: null,
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** A request whose body is signed correctly, whatever the body holds. */
function signed(body: string): { rawBody: Uint8Array; headers: Record<string, string> } {
  const rawBody = new TextEncoder().encode(body)
  return {
    rawBody,
    headers: { 'x-fake-signature': createHash('sha256').update(rawBody).digest('hex') }
  }
}

describe('the fake source through the testing subpath', () => {
  it('reads state, counts reads and serves unknown accounts, with and without a tenant', async () => {
    // Scenario: set state for one tenant, read three accounts, and count.
    const source = new FakeSubscriptionSource({ name: 'scripted', clock })
    const tenantState = createEmptySnapshot({
      accountId: 'a',
      tenantId: 't',
      source: 'scripted',
      fetchedAt: NOW
    })
    source.setAccount({ accountId: 'a', tenantId: 't' }, tenantState)
    source.setAccount({ accountId: 'a', tenantId: 't' }, tenantState)
    expect(await source.readAccount({ accountId: 'a', tenantId: 't' })).toBe(tenantState)
    expect((await source.readAccount({ accountId: 'a' })).fetchedAt).toBe(NOW)
    expect((await source.readAccount({ accountId: 'z', tenantId: 'u' })).tenantId).toBe('u')
    expect(source.totalReads).toBe(3)
    expect(source.readCount({ accountId: 'a' })).toBe(1)
    expect(source.readCount({ accountId: 'nobody' })).toBe(0)
    const unclocked = new FakeSubscriptionSource()
    expect(unclocked.name).toBe('fake')
    expect((await unclocked.readAccount({ accountId: 'a' })).source).toBe('fake')
  })

  it('delays one read and fails the next, without a timer', async () => {
    // Scenario: a read is held until released; after it a scripted failure rejects one read.
    const source = new FakeSubscriptionSource({ clock })
    const release = source.delayNextRead()
    const held = source.readAccount({ accountId: 'a' })
    release()
    expect((await held).accountId).toBe('a')
    source.failNextRead('down')
    await expect(source.readAccount({ accountId: 'a' })).rejects.toBe('down')
    await expect(source.readAccount({ accountId: 'a' })).resolves.toBeDefined()
  })

  it('accepts the requests it built and refuses everything else', async () => {
    // Scenario: a queued notification verifies; tampered, unsigned and malformed bodies do not.
    const source = new FakeSubscriptionSource({ clock })
    const request = source.queueNotification(NOTIFICATION)
    expect(source.nextQueuedRequest()).toBe(request)
    expect(source.nextQueuedRequest()).toBeUndefined()
    expect(await source.verifyWebhook(request)).toEqual({
      accepted: true,
      notification: NOTIFICATION
    })
    expect((await source.verifyWebhook({ ...request, headers: {} })).accepted).toBe(false)
    const malformed = [
      'not json',
      'null',
      '3',
      JSON.stringify({ ...NOTIFICATION, eventId: 4 }),
      JSON.stringify({ ...NOTIFICATION, accountIds: 'a' }),
      JSON.stringify({ ...NOTIFICATION, accountIds: [4] }),
      JSON.stringify({ ...NOTIFICATION, accountIds: ['a', 4] }),
      JSON.stringify({ ...NOTIFICATION, kind: 4 }),
      JSON.stringify({ ...NOTIFICATION, eventTime: 4 }),
      JSON.stringify({ ...NOTIFICATION, environment: 'staging' })
    ]
    for (const body of malformed) {
      expect((await source.verifyWebhook(signed(body))).accepted).toBe(false)
    }
  })

  it('scripts capabilities and renewal results per origin', async () => {
    // Scenario: defaults first, then a script for one origin.
    const source = new FakeSubscriptionSource({ clock })
    expect(source.capabilities(RECORD).operations).toEqual([])
    expect((await source.stopRenewal({ accountId: 'a' }, RECORD)).outcome).toBe(
      'customer_action_required'
    )
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    const snapshot = createEmptySnapshot({ accountId: 'a', source: 'fake', fetchedAt: NOW })
    source.setStopRenewalResult('play_store', { outcome: 'stopped', snapshot })
    expect(source.capabilities(RECORD).operations).toEqual(['stop_renewal'])
    expect(await source.stopRenewal({ accountId: 'a' }, RECORD)).toEqual({
      outcome: 'stopped',
      snapshot
    })
    expect(source.stopRenewalCalls).toBe(2)
  })
})
