/**
 * @fileoverview Pins the order of the shared operation flow: the record is found in the stored
 * snapshot, an operation a server cannot do ends there with no read and no write, and otherwise
 * the account is read afresh and the write is asked about that fresh record, so a change that
 * happened by itself is never read as the effect of the write. A read-back that fails after an
 * accepted write is a result of its own, `unconfirmed`, never an error.
 * @layer core
 */
import type {
  AccountReference,
  ManagementOperation,
  OperationResult,
  SubscriptionSource
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'
import { FakeSubscriptionSource } from '@bymax-one/nest-subscription/testing'

import {
  ACCOUNT,
  harness,
  purchaseOf,
  snapshotOf,
  subscriptionOf
} from './management.builders.spec'
import type { SubscriptionService } from '../subscription.service'
import { changeProductSpec } from './change-product'
import { extendSpec } from './extend'
import { REFUND } from './refund'
import { RESUME } from './resume'
import { STOP_RENEWAL } from './stop-renewal'

const LATER = '2026-01-02T00:00:00.000Z'
const ACCEPTED: OperationResult = { outcome: 'accepted' }

/** One operation: its port method and how the service is asked to perform it. */
interface Operation {
  readonly name: ManagementOperation
  readonly method: 'stopRenewal' | 'resume' | 'changeProduct' | 'extend' | 'refund'
  readonly call: (
    service: SubscriptionService,
    account: AccountReference
  ) => Promise<{ outcome: string }>
}

const OPERATIONS: readonly Operation[] = [
  { name: 'stop_renewal', method: 'stopRenewal', call: (s, a) => s.stopRenewal(a, 'sub-1') },
  { name: 'resume', method: 'resume', call: (s, a) => s.resume(a, 'sub-1') },
  {
    name: 'change_product',
    method: 'changeProduct',
    call: (s, a) => s.changeProduct(a, 'sub-1', 'pro_annual')
  },
  { name: 'extend', method: 'extend', call: (s, a) => s.extend(a, 'sub-1', { days: 7 }) },
  { name: 'refund', method: 'refund', call: (s, a) => s.refund(a, 'sub-1') }
]

/** Makes the next call of an operation answer `accepted`, after running `effect` at the source. */
function accepting(
  source: FakeSubscriptionSource,
  method: Operation['method'],
  effect: () => void = () => undefined
): void {
  jest.spyOn(source, method).mockImplementation(() => {
    effect()
    return Promise.resolve(ACCEPTED)
  })
}

/** A harness whose Google Play origin can do every operation, with a stored subscription. */
async function ready(
  record: SubscriptionRecord = subscriptionOf({ willRenew: 'no' })
): Promise<ReturnType<typeof harness>> {
  const parts = harness()
  parts.source.setCapabilities('play_store', {
    operations: ['stop_renewal', 'resume', 'change_product', 'extend', 'refund'],
    managementReference: 'https://manage.example/sub-1'
  })
  await parts.seed(ACCOUNT, snapshotOf(ACCOUNT, [record], [purchaseOf()]))
  return parts
}

describe('performOperation: a read-back that fails after an accepted write', () => {
  it.each(OPERATIONS)(
    'returns unconfirmed with no snapshot, and no error, for $name',
    async (operation) => {
      // Scenario: the source accepted the request and the read that should confirm it rejects.
      const { source, service } = await ready()
      accepting(source, operation.method, () => source.failNextRead(new Error('read-back down')))
      const result = await operation.call(service, ACCOUNT)
      expect(result).toStrictEqual({ outcome: 'unconfirmed' })
    }
  )
})

describe('performOperation: a stored snapshot ordered after the read', () => {
  const FUTURE = '2027-01-01T00:00:00.000Z'
  const extended = subscriptionOf({ currentPeriodEnd: '2026-02-08T00:00:00.000Z' })

  it('judges the operation on what was read from the source, not on the stored snapshot', async () => {
    // Scenario: the stored snapshot is stamped later than anything this process reads, as one
    // written by an instance whose clock is ahead; the source applies the write.
    const { source, service, store } = await ready(subscriptionOf())
    accepting(source, 'extend', () =>
      source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [extended], [purchaseOf()], null))
    )
    jest.spyOn(store, 'getSnapshot').mockResolvedValue({
      snapshot: snapshotOf(ACCOUNT, [subscriptionOf()], [purchaseOf()], FUTURE),
      pendingChanges: []
    })
    const result = await service.extend(ACCOUNT, 'sub-1', { days: 7 })
    expect(result).toMatchObject({ outcome: 'extended', snapshot: { subscriptions: [extended] } })
  })

  it('asks the source about the record it read, not about the stored one', async () => {
    // Scenario: the source holds a later period end than the superseding stored snapshot.
    const { source, service, store } = await ready(subscriptionOf())
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [extended], [purchaseOf()], null))
    jest.spyOn(store, 'getSnapshot').mockResolvedValue({
      snapshot: snapshotOf(ACCOUNT, [subscriptionOf()], [purchaseOf()], FUTURE),
      pendingChanges: []
    })
    accepting(source, 'extend')
    await service.extend(ACCOUNT, 'sub-1', { days: 7 })
    expect(jest.mocked(source.extend).mock.calls[0]?.[1]).toStrictEqual(extended)
  })
})

describe('performOperation: the record is asked about from a fresh read', () => {
  it('reports not extended when a fresh read before the write already shows the later period end', async () => {
    // Scenario: a renewal the stored snapshot has not seen; the write changes nothing further.
    const { source, service } = await ready(subscriptionOf())
    const renewed = subscriptionOf({ currentPeriodEnd: '2026-03-03T00:00:00.000Z' })
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [renewed], [purchaseOf()], LATER))
    accepting(source, 'extend')
    expect((await service.extend(ACCOUNT, 'sub-1', { days: 7 })).outcome).toBe('not_extended')
  })

  it('reports not refunded when a fresh read before the write already shows no access', async () => {
    // Scenario: the subscription expired since the last read; the refund changes nothing further.
    const { source, service } = await ready(subscriptionOf())
    const expired = subscriptionOf({ givesAccess: false, status: 'expired' })
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [expired], [purchaseOf()], LATER))
    accepting(source, 'refund')
    expect((await service.refund(ACCOUNT, 'sub-1')).outcome).toBe('not_refunded')
  })

  it('refuses a record missing from the fresh read as an unknown account and writes nothing', async () => {
    // Scenario: the record is gone at the source between the stored read and the fresh one.
    const { source, service } = await ready(subscriptionOf())
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [], [], LATER))
    accepting(source, 'extend')
    await expect(service.extend(ACCOUNT, 'sub-1', { days: 7 })).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    })
    expect(jest.mocked(source.extend)).not.toHaveBeenCalled()
  })

  it('fails as source-unavailable and writes nothing when the fresh read fails', async () => {
    // Scenario: the read that precedes the write rejects.
    const { source, service } = await ready(subscriptionOf())
    accepting(source, 'extend')
    source.failNextRead(new Error('fresh read down'))
    await expect(service.extend(ACCOUNT, 'sub-1', { days: 7 })).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(jest.mocked(source.extend)).not.toHaveBeenCalled()
  })
})

describe('performOperation: a source that declines the request', () => {
  it('falls back to the capability reference when the declining answer carries none', async () => {
    // Scenario: the adapter lists the operation, and the call answers customer action required
    // with no reference of its own.
    const { source, service } = await ready(subscriptionOf())
    source.setOperationResult('refund', 'play_store', {
      outcome: 'customer_action_required',
      managementReference: null
    })
    expect(await service.refund(ACCOUNT, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/sub-1'
    })
  })
})

describe('performOperation: an operation a server cannot do', () => {
  it.each(OPERATIONS)('makes no read and no write for $name', async (operation) => {
    // Scenario: the capability answer lacks the operation; the person acts, and nothing is read.
    const { source, service } = await ready(subscriptionOf())
    source.setCapabilities('play_store', {
      operations: [],
      managementReference: 'https://manage.example/sub-1'
    })
    const reads = source.totalReads
    expect(await operation.call(service, ACCOUNT)).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/sub-1'
    })
    expect(source.totalReads).toBe(reads)
    expect(source.totalOperationCalls).toBe(0)
  })
})

describe('the operation specs', () => {
  const subscription = { kind: 'subscription', record: subscriptionOf() } as const
  const purchase = { kind: 'purchase', record: purchaseOf() } as const
  const minimal: SubscriptionSource = {
    name: 'minimal',
    readAccount: () => Promise.reject(new Error('not read')),
    verifyWebhook: () => Promise.resolve({ accepted: false }),
    capabilities: () => Promise.resolve({ operations: [], managementReference: null }),
    stopRenewal: () => Promise.resolve({ outcome: 'accepted' })
  }
  const specs = [
    STOP_RENEWAL,
    RESUME,
    changeProductSpec('pro_annual'),
    extendSpec({ days: 1 }),
    REFUND
  ]

  it.each(specs)(
    'answers that $operation does not apply to a record or an adapter it lacks',
    async (spec) => {
      // Scenario: the fallback answer is the person's, with no reference, and `applies` agrees.
      const lacking = spec.operation === 'stop_renewal' ? purchase : subscription
      expect(await spec.ask(minimal, ACCOUNT, lacking)).toStrictEqual({
        outcome: 'customer_action_required',
        managementReference: null
      })
      expect(spec.applies(minimal, lacking.kind)).toBe(false)
    }
  )

  it('applies stop renewal to a subscription only, and refund to either kind, when the adapter has it', () => {
    // Scenario: the kinds each operation accepts.
    expect(STOP_RENEWAL.applies(minimal, 'subscription')).toBe(true)
    expect(STOP_RENEWAL.applies(minimal, 'purchase')).toBe(false)
    const full = new FakeSubscriptionSource()
    for (const spec of specs.slice(1, 4)) {
      expect(spec.applies(full, 'subscription')).toBe(true)
      expect(spec.applies(full, 'purchase')).toBe(false)
    }
    expect(REFUND.applies(full, 'subscription')).toBe(true)
    expect(REFUND.applies(full, 'purchase')).toBe(true)
  })
})
