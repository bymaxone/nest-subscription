/**
 * @fileoverview Pins the reads that must show a state after an event: the management fresh read
 * and read-back and the webhook processor's read each start after the call, so a refresh already in flight, which read the state before the event, is never mistaken
 * for them. Two refreshes that start after one another still share one read.
 * @layer core
 */
import type {
  AccountReference,
  ManagementOperation,
  OperationResult
} from '@bymax-one/nest-subscription/internal'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import { createEmptySnapshot, type SubscriptionRecord } from '@bymax-one/nest-subscription/shared'
import { FakeSubscriptionSource } from '@bymax-one/nest-subscription/testing'
import { InMemorySubscriptionStore, ManualClock } from '@bymax-one/nest-subscription/testing'
import { encodeAccountKey } from '@bymax-one/nest-subscription/internal'

import {
  ACCOUNT,
  harness,
  snapshotOf,
  subscriptionOf
} from '../management/management.builders.spec'
import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import type { SubscriptionService } from '../subscription.service'
import type { DeadlineWait } from '../webhook/deadline'
import { WebhookProcessor } from '../webhook/webhook.processor'
import { SnapshotRefresher } from './snapshot-refresher'

const ACCEPTED: OperationResult = { outcome: 'accepted' }
const BEFORE = '2026-01-01T00:00:00.000Z'
const AFTER = '2026-01-02T00:00:00.000Z'

/** Lets a read that has been started begin, and every promise that needs no help settle. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

/** One operation: its port method, how the service is asked, and the state that shows its effect. */
interface Row {
  readonly name: ManagementOperation
  readonly method: 'stopRenewal' | 'resume' | 'changeProduct' | 'extend' | 'refund'
  readonly call: (
    service: SubscriptionService,
    account: AccountReference
  ) => Promise<{ outcome: string }>
  readonly stored: SubscriptionRecord
  readonly effect: SubscriptionRecord
  readonly done: string
}

const ROWS: readonly Row[] = [
  {
    name: 'stop_renewal',
    method: 'stopRenewal',
    call: (s, a) => s.stopRenewal(a, 'sub-1'),
    stored: subscriptionOf(),
    effect: subscriptionOf({ willRenew: 'no' }),
    done: 'stopped'
  },
  {
    name: 'resume',
    method: 'resume',
    call: (s, a) => s.resume(a, 'sub-1'),
    stored: subscriptionOf({ willRenew: 'no' }),
    effect: subscriptionOf({ willRenew: 'yes' }),
    done: 'resumed'
  },
  {
    name: 'change_product',
    method: 'changeProduct',
    call: (s, a) => s.changeProduct(a, 'sub-1', 'pro_annual'),
    stored: subscriptionOf(),
    effect: subscriptionOf({ productReference: 'pro_annual' }),
    done: 'product_changed'
  },
  {
    name: 'extend',
    method: 'extend',
    call: (s, a) => s.extend(a, 'sub-1', { days: 7 }),
    stored: subscriptionOf(),
    effect: subscriptionOf({ currentPeriodEnd: '2026-02-08T00:00:00.000Z' }),
    done: 'extended'
  },
  {
    name: 'refund',
    method: 'refund',
    call: (s, a) => s.refund(a, 'sub-1'),
    stored: subscriptionOf(),
    effect: subscriptionOf({ givesAccess: false, refundedAt: AFTER }),
    done: 'refunded'
  }
]

describe.each(ROWS)('a management $name read-back while another refresh is in flight', (row) => {
  it('shows the state after the write, not the state an older refresh read before it', async () => {
    // Scenario: while the write is made, an unrelated refresh starts and reads the state from
    // before it; the write changes the state, and the held read is released after that.
    const parts = harness()
    const { source, context, service } = parts
    source.setCapabilities('play_store', { operations: [row.name], managementReference: null })
    await parts.seed(ACCOUNT, snapshotOf(ACCOUNT, [row.stored]))
    jest.spyOn(source, row.method).mockImplementation(async () => {
      const release = source.delayNextRead()
      void context.refresher.refresh(ACCOUNT).catch(() => undefined)
      await tick()
      source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [row.effect], [], AFTER))
      setImmediate(release)
      return ACCEPTED
    })
    const result = await row.call(service, ACCOUNT)
    expect(result.outcome).toBe(row.done)
    expect('snapshot' in result && result.snapshot).toMatchObject({ subscriptions: [row.effect] })
  })
})

/** The state of the account with one subscription whose period ends at the given instant. */
function endingAt(end: string, sourceUpdatedAt: string): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: ACCOUNT.accountId, source: 'fake', fetchedAt: BEFORE }),
    subscriptions: [subscriptionOf({ currentPeriodEnd: end })],
    sourceUpdatedAt
  }
}

const PRE_EVENT = endingAt('2026-02-01T00:00:00.000Z', BEFORE)
const POST_EVENT = endingAt('2026-03-01T00:00:00.000Z', AFTER)

describe('a verified webhook while another refresh is in flight', () => {
  it('stores the state after the event, and answers success only then', async () => {
    // Scenario: a refresh started before the event holds the state from before it; the source
    // changes; the webhook's own read must not join the older one.
    const source = new FakeSubscriptionSource()
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const clock = new ManualClock(BEFORE)
    const options = resolveOptions({ source, store, clock, accountResolver: () => null })
    const bridge = new ObserverBridge(null, clock)
    const refresher = new SnapshotRefresher(source, store, clock, null, null, bridge)
    const wait: DeadlineWait = () => new Promise<void>(() => undefined)
    const processor = new WebhookProcessor(source, store, clock, options, refresher, bridge, wait)
    source.setAccount(ACCOUNT, PRE_EVENT)
    const release = source.delayNextRead()
    void refresher.refresh(ACCOUNT).catch(() => undefined)
    await tick()
    source.setAccount(ACCOUNT, POST_EVENT)
    const outcome = processor.process(
      source.buildRequest({
        eventId: 'evt-1',
        accountIds: [ACCOUNT.accountId],
        kind: 'RENEWAL',
        eventTime: AFTER,
        environment: 'production'
      })
    )
    setImmediate(release)
    expect(await outcome).toStrictEqual({ kind: 'processed', accounts: 1 })
    const stored = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(stored?.snapshot.subscriptions[0]?.currentPeriodEnd).toBe('2026-03-01T00:00:00.000Z')
  })
})

describe('refreshes that join one another', () => {
  it('shares one source read between two concurrent refreshes', async () => {
    // Scenario: control: two callers that arrive while a read is held get that one read.
    const { source, context } = harness()
    source.setAccount(ACCOUNT, PRE_EVENT)
    const release = source.delayNextRead()
    const first = context.refresher.refresh(ACCOUNT)
    const second = context.refresher.refresh(ACCOUNT)
    await tick()
    release()
    await Promise.all([first, second])
    expect(source.readCount(ACCOUNT)).toBe(1)
  })
})

describe('refreshAfter', () => {
  it('starts a read of its own when the refresh in flight rejects', async () => {
    // Scenario: the older refresh fails; the read that follows it is not failed by it.
    const { source, context } = harness()
    source.setAccount(ACCOUNT, PRE_EVENT)
    const release = source.delayNextRead()
    source.failNextRead(new Error('older failed'))
    const older = context.refresher.refresh(ACCOUNT)
    await tick()
    const after = context.refresher.refreshAfter(ACCOUNT)
    release()
    await expect(older).rejects.toMatchObject({ code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE' })
    expect((await after).current.subscriptions[0]?.currentPeriodEnd).toBe(
      '2026-02-01T00:00:00.000Z'
    )
  })

  it('fails on its own read, not on the older one', async () => {
    // Scenario: the older refresh works and the read that follows it fails.
    const { source, context } = harness()
    source.setAccount(ACCOUNT, PRE_EVENT)
    const release = source.delayNextRead()
    const older = context.refresher.refresh(ACCOUNT)
    await tick()
    const after = context.refresher.refreshAfter(ACCOUNT)
    source.failNextRead(new Error('own read failed'))
    release()
    await older
    await expect(after).rejects.toMatchObject({ code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE' })
  })

  it('shares one read between refreshes that follow the same older one', async () => {
    // Scenario: three callers wait for one held read and read once between them.
    const { source, context } = harness()
    source.setAccount(ACCOUNT, PRE_EVENT)
    const release = source.delayNextRead()
    const older = context.refresher.refresh(ACCOUNT)
    await tick()
    const callers = [1, 2, 3].map(() => context.refresher.refreshAfter(ACCOUNT))
    release()
    await Promise.all([older, ...callers])
    expect(source.readCount(ACCOUNT)).toBe(2)
  })

  it('serves two management operations on one account at once, each with its own effect', async () => {
    // Scenario: an extension and a refund of two records at the same time, with a refresh in flight.
    const parts = harness()
    const { source, service, context } = parts
    source.setCapabilities('play_store', {
      operations: ['extend', 'refund'],
      managementReference: null
    })
    const stored = [subscriptionOf(), subscriptionOf({ subscriptionReference: 'sub-2' })]
    await parts.seed(ACCOUNT, snapshotOf(ACCOUNT, stored))
    const after = snapshotOf(
      ACCOUNT,
      [
        subscriptionOf({ currentPeriodEnd: '2026-02-08T00:00:00.000Z' }),
        subscriptionOf({ subscriptionReference: 'sub-2', givesAccess: false, refundedAt: AFTER })
      ],
      [],
      AFTER
    )
    source.setOperationResult('extend', 'play_store', ACCEPTED, () =>
      source.setAccount(ACCOUNT, after)
    )
    source.setOperationResult('refund', 'play_store', ACCEPTED)
    const release = source.delayNextRead()
    void context.refresher.refresh(ACCOUNT).catch(() => undefined)
    await tick()
    const both = Promise.all([
      service.extend(ACCOUNT, 'sub-1', { days: 7 }),
      service.refund(ACCOUNT, 'sub-2')
    ])
    setImmediate(release)
    const [extended, refunded] = await both
    expect(extended.outcome).toBe('extended')
    expect(refunded.outcome).toBe('refunded')
  })
})
