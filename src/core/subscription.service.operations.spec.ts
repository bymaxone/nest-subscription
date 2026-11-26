/**
 * @fileoverview Pins every management operation through the service on the shared flow, table
 * driven: the ownership check refuses a foreign record of either kind and reaches no source, a
 * possible operation makes one call and returns the snapshot read back, an accepted request the
 * read-back contradicts is reported as not done, and an operation a server cannot do, or an
 * adapter does not implement, is the person's with the management reference.
 * @layer core
 */
import type {
  AccountReference,
  ExtendRequest,
  ManagementOperation
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type NonRenewingPurchaseRecord,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import {
  ACCOUNT,
  harness,
  purchaseOf,
  snapshotOf,
  subscriptionOf,
  type Harness
} from './management/management.builders.spec'
import type { SubscriptionService } from './subscription.service'
import type { FakeSubscriptionSource } from '@bymax-one/nest-subscription/testing'

/** One operation as a table row: how it is called, and what the read-back must show. */
interface Row {
  readonly operation: ManagementOperation
  readonly done: string
  readonly notDone: string
  readonly call: (
    service: SubscriptionService,
    account: AccountReference,
    ref: string
  ) => Promise<{ outcome: string }>
  /** The subscription as the source reports it once the operation took effect. */
  readonly effect: SubscriptionRecord
  /** The kinds of record the operation applies to. */
  readonly kinds: readonly ('subscription' | 'purchase')[]
  /** Makes the next call of the operation at the source reject. */
  readonly reject: (source: FakeSubscriptionSource, error: Error) => void
  /** Removes the operation from the adapter, or `null` when the port requires it. */
  readonly remove: ((source: FakeSubscriptionSource) => void) | null
}

/** Removes an optional method from an adapter, as an adapter that never wrote it lacks it. */
function without(method: string): (source: FakeSubscriptionSource) => void {
  return (source) => void Object.defineProperty(source, method, { value: undefined })
}

const EXTENSION: ExtendRequest = { days: 7 }

const ROWS: readonly Row[] = [
  {
    operation: 'stop_renewal',
    done: 'stopped',
    notDone: 'not_stopped',
    call: (service, account, ref) => service.stopRenewal(account, ref),
    effect: subscriptionOf({ willRenew: 'no' }),
    kinds: ['subscription'],
    reject: (source, error) => void jest.spyOn(source, 'stopRenewal').mockRejectedValueOnce(error),
    remove: null
  },
  {
    operation: 'resume',
    done: 'resumed',
    notDone: 'not_resumed',
    call: (service, account, ref) => service.resume(account, ref),
    effect: subscriptionOf({ willRenew: 'yes' }),
    kinds: ['subscription'],
    reject: (source, error) => void jest.spyOn(source, 'resume').mockRejectedValueOnce(error),
    remove: without('resume')
  },
  {
    operation: 'change_product',
    done: 'product_changed',
    notDone: 'product_not_changed',
    call: (service, account, ref) => service.changeProduct(account, ref, 'pro_annual'),
    effect: subscriptionOf({ productReference: 'pro_annual' }),
    kinds: ['subscription'],
    reject: (source, error) =>
      void jest.spyOn(source, 'changeProduct').mockRejectedValueOnce(error),
    remove: without('changeProduct')
  },
  {
    operation: 'extend',
    done: 'extended',
    notDone: 'not_extended',
    call: (service, account, ref) => service.extend(account, ref, EXTENSION),
    effect: subscriptionOf({ currentPeriodEnd: '2026-02-08T00:00:00.000Z' }),
    kinds: ['subscription'],
    reject: (source, error) => void jest.spyOn(source, 'extend').mockRejectedValueOnce(error),
    remove: without('extend')
  },
  {
    operation: 'refund',
    done: 'refunded',
    notDone: 'not_refunded',
    call: (service, account, ref) => service.refund(account, ref),
    effect: subscriptionOf({ givesAccess: false, refundedAt: '2026-01-02T00:00:00.000Z' }),
    kinds: ['subscription', 'purchase'],
    reject: (source, error) => void jest.spyOn(source, 'refund').mockRejectedValueOnce(error),
    remove: without('refund')
  }
]

/** The subscription that renews on the stored snapshot, before any operation: will renew `yes`
 * except for resume, which starts from a subscription that does not renew. */
function before(row: Row): SubscriptionRecord {
  return row.operation === 'resume' ? subscriptionOf({ willRenew: 'no' }) : subscriptionOf()
}

/** A harness whose Google Play origin can do the operation and accepts the request. */
async function possible(row: Row): Promise<Harness> {
  const parts = harness()
  parts.source.setCapabilities('play_store', {
    operations: [row.operation],
    managementReference: 'https://manage.example/sub-1'
  })
  parts.source.setOperationResult(row.operation, 'play_store', { outcome: 'accepted' })
  await parts.seed(ACCOUNT, snapshotOf(ACCOUNT, [before(row)], [purchaseOf()]))
  return parts
}

/** The state the source reports at a later instant, with the given subscription. */
function later(
  subscription: SubscriptionRecord,
  purchase: NonRenewingPurchaseRecord = purchaseOf()
): SubscriptionSnapshot {
  return snapshotOf(ACCOUNT, [subscription], [purchase], '2026-01-02T00:00:00.000Z')
}

describe.each(ROWS)('SubscriptionService.$operation', (row) => {
  it('makes one source call, refreshes and returns the snapshot read back as the result', async () => {
    // Scenario: the origin can do it; the source's next read shows the effect, and the result
    // is that read, not the request.
    const { source, service } = await possible(row)
    source.setAccount(ACCOUNT, later(row.effect))
    const reads = source.readCount(ACCOUNT)
    const result = await row.call(service, ACCOUNT, 'sub-1')
    expect(result.outcome).toBe(row.done)
    expect(source.operationCalls(row.operation)).toBe(1)
    expect(source.totalOperationCalls).toBe(1)
    expect(source.readCount(ACCOUNT)).toBe(reads + 1)
    expect('snapshot' in result && result.snapshot).toMatchObject({
      sourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      subscriptions: [row.effect]
    })
  })

  it('reports not done when the source accepted and the read-back shows no effect', async () => {
    // Scenario: the next read is the state from before the request.
    const { source, service } = await possible(row)
    source.setAccount(ACCOUNT, later(before(row)))
    const result = await row.call(service, ACCOUNT, 'sub-1')
    expect(result.outcome).toBe(row.notDone)
    expect(source.operationCalls(row.operation)).toBe(1)
  })

  it('reports not done when the read-back no longer holds the record', async () => {
    // Scenario: the next read has neither the subscription nor the purchase.
    const { source, service } = await possible(row)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [], [], '2026-01-02T00:00:00.000Z'))
    expect((await row.call(service, ACCOUNT, 'sub-1')).outcome).toBe(row.notDone)
  })

  it('calls nothing and returns the management reference where the origin cannot do it', async () => {
    // Scenario: the capability answer lacks the operation.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', {
      operations: ROWS.map((other) => other.operation).filter((name) => name !== row.operation),
      managementReference: 'https://manage.example/sub-1'
    })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [before(row)], [purchaseOf()]))
    expect(await row.call(service, ACCOUNT, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/sub-1'
    })
    expect(source.totalOperationCalls).toBe(0)
  })

  it('answers that the person must act when the adapter lists the operation but implements none', async () => {
    // Scenario: an adapter that names the operation without a method for it; stop renewal is
    // required by the port, so it has no such adapter.
    const parts = await possible(row)
    if (row.remove === null) return
    row.remove(parts.source)
    expect(await row.call(parts.service, ACCOUNT, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/sub-1'
    })
    expect(parts.source.totalOperationCalls).toBe(0)
  })

  it('returns what the source says when it declines a request the capabilities allowed', async () => {
    // Scenario: the call itself answers customer action required with its own reference.
    const { source, service } = await possible(row)
    source.setOperationResult(row.operation, 'play_store', {
      outcome: 'customer_action_required',
      managementReference: 'https://play.example/manage'
    })
    expect(await row.call(service, ACCOUNT, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://play.example/manage'
    })
    expect(source.operationCalls(row.operation)).toBe(1)
  })

  it.each([
    ['another account', { accountId: 'acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'acc-1', tenantId: 'tenant-b' }]
  ])('refuses a record of %s, of either kind, and reaches no source', async (_label, caller) => {
    // Scenario: SEC10 for this operation across accounts and tenants, subscription and purchase.
    const { source, seed, service } = harness(true)
    source.setCapabilities('play_store', {
      operations: [row.operation],
      managementReference: null
    })
    const owner = { accountId: 'acc-1', tenantId: 'tenant-a' }
    await seed(owner, snapshotOf(owner, [before(row)], [purchaseOf()]))
    const asked = jest.spyOn(source, 'capabilities')
    const reads = source.totalReads
    for (const reference of ['sub-1', 'pur-1']) {
      await expect(row.call(service, caller, reference)).rejects.toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
      })
    }
    expect(asked).not.toHaveBeenCalled()
    expect(source.totalOperationCalls).toBe(0)
    expect(source.totalReads).toBe(reads)
  })

  it('acts on a non-renewing purchase only where the operation applies to one', async () => {
    // Scenario: a purchase of an origin that allows the operation; only refund reaches the source.
    const { source, service } = await possible(row)
    const result = await row.call(service, ACCOUNT, 'pur-1')
    expect(source.operationCalls(row.operation)).toBe(row.kinds.includes('purchase') ? 1 : 0)
    expect(result.outcome).toBe(row.kinds.includes('purchase') ? row.notDone : 'person_must_act')
  })

  it('fails as source-unavailable and leaves the stored snapshot as it was when the call fails', async () => {
    // Scenario: the operation rejects; no refresh happens.
    const { source, service, store } = await possible(row)
    const stored = structuredClone(await store.getSnapshot('acc-1'))
    row.reject(source, new Error('upstream'))
    const reads = source.totalReads
    await expect(row.call(service, ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(source.totalReads).toBe(reads)
    expect(await store.getSnapshot('acc-1')).toStrictEqual(stored)
  })
})

describe('SubscriptionService input validation', () => {
  it.each([[''], ['  ']])(
    'refuses the blank product %j before anything is read or asked',
    async (product) => {
      // Scenario: change product validates the target product first.
      const { source, service } = harness()
      const asked = jest.spyOn(source, 'capabilities')
      await expect(service.changeProduct(ACCOUNT, 'sub-1', product)).rejects.toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
      })
      expect(asked).not.toHaveBeenCalled()
    }
  )

  it('refuses a product that is not a string', async () => {
    // Scenario: a loose caller passes a number.
    const { service } = harness()
    const holder: object = { value: 4 }
    const loose: string = Reflect.get(holder, 'value')
    await expect(service.changeProduct(ACCOUNT, 'sub-1', loose)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
  })

  it.each([
    ['zero days', { days: 0 }],
    ['a fraction of a day', { days: 1.5 }],
    ['a negative number', { days: -3 }],
    ['not a number', { days: Number.NaN }],
    ['an unsafe integer', { days: Number.MAX_SAFE_INTEGER + 1 }],
    ['an unknown reason', { days: 3, reason: 'because' }]
  ])('refuses an extension of %s before anything is read or asked', async (_label, extension) => {
    // Scenario: only whole days of at least one and a known reason pass.
    const { source, service } = harness()
    const asked = jest.spyOn(source, 'capabilities')
    const loose: ExtendRequest = {
      days: Reflect.get(extension, 'days'),
      reason: Reflect.get(extension, 'reason')
    }
    await expect(service.extend(ACCOUNT, 'sub-1', loose)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    expect(asked).not.toHaveBeenCalled()
  })

  it('refuses an extension whose days are not a number', async () => {
    // Scenario: a loose caller passes text.
    const { service } = harness()
    const holder: object = { days: '3' }
    const loose: ExtendRequest = { days: Reflect.get(holder, 'days') }
    await expect(service.extend(ACCOUNT, 'sub-1', loose)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
  })

  it('passes a well-formed extension, with each known reason, to the source unchanged', async () => {
    // Scenario: the request the adapter receives is the caller's, copied.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', { operations: ['extend'], managementReference: null })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    const extend = jest.spyOn(source, 'extend')
    for (const reason of [
      'undeclared',
      'customer_satisfaction',
      'other',
      'service_issue_or_outage'
    ] as const) {
      await service.extend(ACCOUNT, 'sub-1', { days: 2, reason })
      expect(extend).toHaveBeenLastCalledWith(ACCOUNT, subscriptionOf(), { days: 2, reason })
    }
    await service.extend(ACCOUNT, 'sub-1', { days: 2 })
    expect(extend).toHaveBeenLastCalledWith(ACCOUNT, subscriptionOf(), { days: 2 })
  })

  it('passes the target product to the source', async () => {
    // Scenario: the adapter receives the product the caller named.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', {
      operations: ['change_product'],
      managementReference: null
    })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    const change = jest.spyOn(source, 'changeProduct')
    await service.changeProduct(ACCOUNT, 'sub-1', 'pro_annual')
    expect(change).toHaveBeenCalledWith(ACCOUNT, subscriptionOf(), 'pro_annual')
  })
})

describe('SubscriptionService.refund: what the read-back must show', () => {
  it.each([
    ['a refund instant', purchaseOf({ refundedAt: '2026-01-02T00:00:00.000Z' }), true],
    ['access that is gone', purchaseOf({ givesAccess: false }), true],
    ['no change', purchaseOf(), false]
  ])('of a purchase with %s is refunded: %s', async (_label, after, refunded) => {
    // Scenario: the purchase's own read-back decides, never the request.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', { operations: ['refund'], managementReference: null })
    source.setOperationResult('refund', 'play_store', { outcome: 'accepted' })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [], [purchaseOf()]))
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [], [after], '2026-01-02T00:00:00.000Z'))
    expect((await service.refund(ACCOUNT, 'pur-1')).outcome).toBe(
      refunded ? 'refunded' : 'not_refunded'
    )
  })

  it('is not refunded when a purchase that never gave access still gives none', async () => {
    // Scenario: access that was not there before cannot be shown to have been revoked.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', { operations: ['refund'], managementReference: null })
    source.setOperationResult('refund', 'play_store', { outcome: 'accepted' })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [], [purchaseOf({ givesAccess: false })]))
    source.setAccount(
      ACCOUNT,
      snapshotOf(ACCOUNT, [], [purchaseOf({ givesAccess: false })], '2026-01-02T00:00:00.000Z')
    )
    expect((await service.refund(ACCOUNT, 'pur-1')).outcome).toBe('not_refunded')
  })
})

describe('SubscriptionService.extend: what the read-back must show', () => {
  it.each([
    ['later', '2026-02-02T00:00:00.000Z', 'extended'],
    ['the same', '2026-02-01T00:00:00.000Z', 'not_extended'],
    ['earlier', '2026-01-20T00:00:00.000Z', 'not_extended']
  ])('a current period ending %s is %s', async (_label, end, outcome) => {
    // Scenario: only a later end counts, by how much is the source's to say.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', { operations: ['extend'], managementReference: null })
    source.setOperationResult('extend', 'play_store', { outcome: 'accepted' })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    source.setAccount(ACCOUNT, later(subscriptionOf({ currentPeriodEnd: end })))
    expect((await service.extend(ACCOUNT, 'sub-1', { days: 1 })).outcome).toBe(outcome)
  })
})
