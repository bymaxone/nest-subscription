/**
 * @fileoverview The management operations, end to end through a real application: the fake source
 * is scripted per origin and per operation, the result of an operation is the snapshot read back,
 * the host's hook is told through the normal refresh path, and a record of another account or
 * tenant is refused before any source is reached.
 * @layer e2e
 */
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import {
  SUBSCRIPTION_ERROR_CODES,
  SubscriptionError,
  SubscriptionModule,
  SubscriptionService,
  type AccountReference,
  type ExtendRequest,
  type ManagedRecord,
  type ManagementOperation,
  type SubscriptionSource,
  type SubscriptionChangeNotification
} from '@bymax-one/nest-subscription'
import {
  createEmptySnapshot,
  type NonRenewingPurchaseRecord,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import { changeProductSpec } from '../../src/core/management/change-product'
import { extendSpec } from '../../src/core/management/extend'
import { REFUND } from '../../src/core/management/refund'
import { RESUME } from '../../src/core/management/resume'
import { STOP_RENEWAL } from '../../src/core/management/stop-renewal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-02T00:00:00.000Z'
const OWNER: AccountReference = { accountId: 'sentinel-acc-1', tenantId: 'tenant-a' }

/** A renewing Google Play subscription. */
const SUBSCRIPTION: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'play_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: '',
  currentPeriodStart: T0,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: 'https://manage.example/sub-1'
}

/** A lifetime purchase from Google Play. */
const PURCHASE: NonRenewingPurchaseRecord = {
  purchaseReference: 'pur-1',
  entitlementNames: ['pro'],
  givesAccess: true,
  origin: 'play_store',
  environment: 'production',
  productReference: 'lifetime',
  purchasedAt: T0,
  accessUntil: null,
  refundedAt: null
}

/** The state of the owner's account as the source reports it at `at`. */
function stateOf(
  account: AccountReference,
  subscription: SubscriptionRecord,
  at: string
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: T0
    }),
    subscriptions: [subscription],
    nonRenewingPurchases: [PURCHASE],
    sourceUpdatedAt: at
  }
}

/** An application over a scripted source, with the owner's account already stored. */
async function boot(hookThrows = false): Promise<{
  app: TestingModule
  source: FakeSubscriptionSource
  service: SubscriptionService
  notified: SubscriptionChangeNotification[]
}> {
  const source = new FakeSubscriptionSource()
  const notified: SubscriptionChangeNotification[] = []
  const app = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source,
        store: new InMemorySubscriptionStore({ logger: () => undefined }),
        clock: new ManualClock(T0),
        multiTenant: true,
        accountResolver: () => null,
        onChange: (notification) => {
          notified.push(notification)
          if (hookThrows) throw new Error('the host hook failed')
        }
      })
    ]
  }).compile()
  const service = app.get(SubscriptionService)
  source.setAccount(OWNER, stateOf(OWNER, SUBSCRIPTION, T0))
  await service.refresh(OWNER)
  notified.length = 0
  return { app, source, service, notified }
}

describe('management: stop renewal', () => {
  it('stops a Google Play renewal with one source call and returns the snapshot read back, and the hook hears will_not_renew', async () => {
    // Scenario: the origin can stop; the source accepts and its next read shows will renew no.
    const { app, source, service, notified } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    source.setAccount(OWNER, stateOf(OWNER, { ...SUBSCRIPTION, willRenew: 'no' }, T1))
    const result = await service.stopRenewal(OWNER, 'sub-1')
    expect(result.outcome).toBe('stopped')
    if (!('snapshot' in result)) throw new Error('the source took the request')
    expect(result.snapshot.subscriptions[0]?.willRenew).toBe('no')
    expect(source.stopRenewalCalls).toBe(1)
    expect(notified.flatMap((entry) => entry.changes.map((change) => change.kind))).toContain(
      'will_not_renew'
    )
    await app.close()
  })

  it('returns the management reference and calls nothing where a server cannot stop the renewal', async () => {
    // Scenario: an App Store subscription; the answer is a value carrying the reference.
    const { app, source, service } = await boot()
    source.setAccount(OWNER, stateOf(OWNER, { ...SUBSCRIPTION, origin: 'app_store' }, T1))
    await service.refresh(OWNER)
    source.setCapabilities('app_store', {
      operations: [],
      managementReference: 'https://apps.example/manage'
    })
    expect(await service.stopRenewal(OWNER, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://apps.example/manage'
    })
    expect(source.stopRenewalCalls).toBe(0)
    await app.close()
  })

  it('reports not stopped when the source accepted and the read-back still shows a renewing subscription', async () => {
    // Scenario: the request is accepted and nothing changed at the source.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    source.setAccount(OWNER, stateOf(OWNER, SUBSCRIPTION, T1))
    const result = await service.stopRenewal(OWNER, 'sub-1')
    expect(result.outcome).toBe('not_stopped')
    await app.close()
  })

  it.each([
    ['another account', { accountId: 'sentinel-acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'sentinel-acc-1', tenantId: 'tenant-b' }]
  ])('refuses a record of %s, for both kinds, and reaches no source', async (_label, caller) => {
    // Scenario: SEC10 across accounts and tenants, with a subscription and a purchase.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    const reads = source.totalReads
    for (const reference of ['sub-1', 'pur-1']) {
      await expect(service.stopRenewal(caller, reference)).rejects.toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
      })
      await expect(service.getCapabilities(caller, reference)).rejects.toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
      })
    }
    expect(source.totalOperationCalls).toBe(0)
    expect(source.totalReads).toBe(reads)
    await app.close()
  })

  it('reads capabilities per origin through the service', async () => {
    // Scenario: the capability answer is the one scripted for the origin of the record.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal', 'refund'],
      managementReference: 'https://manage.example/sub-1'
    })
    const answer = await service.getCapabilities(OWNER, 'sub-1')
    expect(answer.possible.stop_renewal).toBe(true)
    expect(answer.possible.resume).toBe(false)
    expect(await service.getManagementReference(OWNER, 'pur-1')).toBe(
      'https://manage.example/sub-1'
    )
    await app.close()
  })
})

describe('management: refusals and failures', () => {
  it('refuses a blank reference as invalid input and an unknown one as an unknown account', async () => {
    // Scenario: neither reaches a source.
    const { app, source, service } = await boot()
    await expect(service.stopRenewal(OWNER, ' ')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    await expect(service.stopRenewal(OWNER, 'sub-404')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    })
    expect(source.totalOperationCalls).toBe(0)
    await app.close()
  })

  it('does not ask a source to stop the renewal of a purchase, and says where the person acts', async () => {
    // Scenario: the origin can stop renewals; a non-renewing purchase renews nothing.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: 'https://manage.example/pur'
    })
    expect(await service.stopRenewal(OWNER, 'pur-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/pur'
    })
    expect(source.totalOperationCalls).toBe(0)
    await app.close()
  })

  it('reports not stopped when the read-back no longer holds the subscription', async () => {
    // Scenario: once the source accepted, its next read has no such subscription.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' }, () =>
      source.setAccount(OWNER, { ...stateOf(OWNER, SUBSCRIPTION, T1), subscriptions: [] })
    )
    expect((await service.stopRenewal(OWNER, 'sub-1')).outcome).toBe('not_stopped')
    await app.close()
  })

  it('surfaces each kind of source failure as the source-unavailable code, and keeps a library error', async () => {
    // Scenario: the adapter rejects, throws at once, fails the capability query, or the read that
    // precedes the write fails; a library error from the adapter keeps its own code.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    jest.spyOn(source, 'stopRenewal').mockRejectedValueOnce(new Error('upstream'))
    await expect(service.stopRenewal(OWNER, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    jest.spyOn(source, 'stopRenewal').mockImplementationOnce(() => {
      throw new Error('upstream')
    })
    await expect(service.stopRenewal(OWNER, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    jest
      .spyOn(source, 'stopRenewal')
      .mockRejectedValueOnce(new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT))
    await expect(service.stopRenewal(OWNER, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    jest.spyOn(source, 'capabilities').mockRejectedValueOnce(new Error('upstream'))
    await expect(service.getCapabilities(OWNER, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    source.failNextRead(new Error('read failed'))
    await expect(service.stopRenewal(OWNER, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    await app.close()
  })
})

/** One operation of FR36 as a row: how it is called, and the state the source shows afterwards. */
interface Operation {
  readonly name: ManagementOperation
  readonly done: string
  readonly notDone: string
  readonly call: (
    service: SubscriptionService,
    account: AccountReference,
    reference: string
  ) => Promise<{ readonly outcome: string }>
  readonly effect: SubscriptionRecord
}

const OPERATIONS: readonly Operation[] = [
  {
    name: 'stop_renewal',
    done: 'stopped',
    notDone: 'not_stopped',
    call: (service, account, reference) => service.stopRenewal(account, reference),
    effect: { ...SUBSCRIPTION, willRenew: 'no' }
  },
  {
    name: 'resume',
    done: 'resumed',
    notDone: 'not_resumed',
    call: (service, account, reference) => service.resume(account, reference),
    effect: { ...SUBSCRIPTION, willRenew: 'yes' }
  },
  {
    name: 'change_product',
    done: 'product_changed',
    notDone: 'product_not_changed',
    call: (service, account, reference) => service.changeProduct(account, reference, 'pro_annual'),
    effect: { ...SUBSCRIPTION, productReference: 'pro_annual' }
  },
  {
    name: 'extend',
    done: 'extended',
    notDone: 'not_extended',
    call: (service, account, reference) => service.extend(account, reference, { days: 7 }),
    effect: { ...SUBSCRIPTION, currentPeriodEnd: '2026-02-08T00:00:00.000Z' }
  },
  {
    name: 'refund',
    done: 'refunded',
    notDone: 'not_refunded',
    call: (service, account, reference) => service.refund(account, reference),
    effect: { ...SUBSCRIPTION, givesAccess: false, refundedAt: T1 }
  }
]

describe.each(OPERATIONS)('management: $name through the module', (operation) => {
  it('returns the snapshot read back, and not done when the read-back shows nothing', async () => {
    // Scenario: the result follows the read after the write: unchanged in the first call, and the
    // effect in the second.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: [operation.name],
      managementReference: null
    })
    source.setOperationResult(operation.name, 'play_store', { outcome: 'accepted' })
    source.setAccount(OWNER, stateOf(OWNER, SUBSCRIPTION, T1))
    const unchanged = await operation.call(service, OWNER, 'sub-1')
    source.setOperationResult(operation.name, 'play_store', { outcome: 'accepted' }, () =>
      source.setAccount(OWNER, stateOf(OWNER, operation.effect, '2026-01-03T00:00:00.000Z'))
    )
    const effective = await operation.call(service, OWNER, 'sub-1')
    expect([unchanged.outcome, effective.outcome]).toStrictEqual(
      operation.name === 'resume'
        ? [operation.done, operation.done]
        : [operation.notDone, operation.done]
    )
    expect(source.operationCalls(operation.name)).toBe(2)
    await app.close()
  })

  it('asks the person to act, with the reference, where the origin cannot do it', async () => {
    // Scenario: nothing is possible for the origin; nothing is asked of the source.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: [],
      managementReference: 'https://manage.example/sub-1'
    })
    expect(await operation.call(service, OWNER, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/sub-1'
    })
    expect(source.totalOperationCalls).toBe(0)
    await app.close()
  })

  it.each([
    ['another account', { accountId: 'sentinel-acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'sentinel-acc-1', tenantId: 'tenant-b' }]
  ])(
    'refuses a subscription and a purchase of %s and reaches no source',
    async (_label, caller) => {
      // Scenario: SEC10 for this operation.
      const { app, source, service } = await boot()
      source.setCapabilities('play_store', {
        operations: [operation.name],
        managementReference: null
      })
      for (const reference of ['sub-1', 'pur-1']) {
        await expect(operation.call(service, caller, reference)).rejects.toMatchObject({
          code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
        })
      }
      expect(source.totalOperationCalls).toBe(0)
      await app.close()
    }
  )
})

describe('management: purchases and input', () => {
  it('refunds a purchase, and refuses a bad extension or product before any call', async () => {
    // Scenario: the purchase is refunded through the same flow; bad input never reaches a source.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['refund', 'extend', 'change_product'],
      managementReference: null
    })
    source.setOperationResult('refund', 'play_store', { outcome: 'accepted' })
    source.setAccount(OWNER, {
      ...stateOf(OWNER, SUBSCRIPTION, T1),
      nonRenewingPurchases: [{ ...PURCHASE, refundedAt: T1, givesAccess: false }]
    })
    expect((await service.refund(OWNER, 'pur-1')).outcome).toBe('refunded')
    await expect(service.extend(OWNER, 'sub-1', { days: 0 })).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    const holder: object = { value: null }
    const untyped: ExtendRequest = Reflect.get(holder, 'value')
    await expect(service.extend(OWNER, 'sub-1', untyped)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    await expect(service.changeProduct(OWNER, 'sub-1', ' ')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    expect(source.totalOperationCalls).toBe(1)
    await app.close()
  })
})

describe('management: a non-renewing purchase', () => {
  it("reaches the source for a refund only, whatever the capabilities list, and answers the others as the person's", async () => {
    // Scenario: every operation is listed for the origin; four of them do not apply to a
    // purchase, and a refund with no scripted answer is the person's, with no reference.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal', 'resume', 'change_product', 'extend', 'refund'],
      managementReference: null
    })
    const answers = await Promise.all(
      OPERATIONS.map(async (operation) => (await operation.call(service, OWNER, 'pur-1')).outcome)
    )
    expect(answers).toStrictEqual(
      OPERATIONS.map((operation) =>
        operation.name === 'refund' ? 'person_must_act' : 'person_must_act'
      )
    )
    expect(source.operationCalls('refund')).toBe(1)
    expect(source.totalOperationCalls).toBe(1)
    await app.close()
  })
})

describe('management: the public surface', () => {
  it('adds exactly the capability query, the management reference and the five operations to the service', () => {
    // Scenario: the methods of the service are the reads, the refresh, the reconciliation and
    // these seven, and nothing else is public.
    expect(Object.getOwnPropertyNames(SubscriptionService.prototype).sort()).toStrictEqual([
      'changeProduct',
      'constructor',
      'extend',
      'getCapabilities',
      'getManagementReference',
      'getSnapshot',
      'hasEntitlement',
      'reconcile',
      'refresh',
      'refund',
      'resume',
      'stopRenewal'
    ])
  })
})

describe('management: a read-back that fails, and the order of the flow', () => {
  it.each(OPERATIONS)(
    'returns unconfirmed, with no snapshot and no error, for $name',
    async (operation) => {
      // Scenario: the source accepted and the read that should confirm it rejects; the host must
      // not repeat the operation, and the result says so without an error.
      const { app, source, service } = await boot()
      source.setCapabilities('play_store', {
        operations: [operation.name],
        managementReference: null
      })
      source.setOperationResult(operation.name, 'play_store', { outcome: 'accepted' }, () =>
        source.failNextRead(new Error('read-back down'))
      )
      expect(await operation.call(service, OWNER, 'sub-1')).toStrictEqual({
        outcome: 'unconfirmed'
      })
      expect(source.operationCalls(operation.name)).toBe(1)
      await app.close()
    }
  )

  it('reads the account afresh before the write, so a renewal the store has not seen is not the extension', async () => {
    // Scenario: the source already shows a later period end than the stored snapshot; the write
    // changes nothing further.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', { operations: ['extend'], managementReference: null })
    source.setOperationResult('extend', 'play_store', { outcome: 'accepted' })
    const renewed = { ...SUBSCRIPTION, currentPeriodEnd: '2026-03-03T00:00:00.000Z' }
    source.setAccount(OWNER, stateOf(OWNER, renewed, T1))
    expect((await service.extend(OWNER, 'sub-1', { days: 7 })).outcome).toBe('not_extended')
    await app.close()
  })

  it('refuses a record the fresh read no longer holds, and writes nothing', async () => {
    // Scenario: the record is in the stored snapshot and gone at the source.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', { operations: ['extend'], managementReference: null })
    source.setOperationResult('extend', 'play_store', { outcome: 'accepted' })
    source.setAccount(OWNER, { ...stateOf(OWNER, SUBSCRIPTION, T1), subscriptions: [] })
    await expect(service.extend(OWNER, 'sub-1', { days: 7 })).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    })
    expect(source.totalOperationCalls).toBe(0)
    await app.close()
  })

  it('reads nothing and writes nothing where a server cannot do the operation', async () => {
    // Scenario: the person must act; the source is not read, not even afresh.
    const { app, source, service } = await boot()
    const reads = source.totalReads
    expect((await service.refund(OWNER, 'sub-1')).outcome).toBe('person_must_act')
    expect(source.totalReads).toBe(reads)
    expect(source.totalOperationCalls).toBe(0)
    await app.close()
  })

  it('returns the result of an operation whose change hook fails, on both reads', async () => {
    // Scenario: the host's hook throws on the fresh read and on the read-back; neither fails the
    // operation.
    const { app, source, service } = await boot(true)
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' }, () =>
      source.setAccount(OWNER, stateOf(OWNER, { ...SUBSCRIPTION, willRenew: 'no' }, T1))
    )
    source.setAccount(OWNER, stateOf(OWNER, { ...SUBSCRIPTION, productReference: 'other' }, T1))
    expect((await service.stopRenewal(OWNER, 'sub-1')).outcome).toBe('stopped')
    await app.close()
  })

  it('answers the fallback of each operation for a record or an adapter it does not apply to', async () => {
    // Scenario: the specs answer the person's, with no reference, and say they do not apply.
    const { app, source } = await boot()
    const specs = [
      STOP_RENEWAL,
      RESUME,
      changeProductSpec('pro_annual'),
      extendSpec({ days: 1 }),
      REFUND
    ]
    const lacking: SubscriptionSource = {
      name: 'minimal',
      readAccount: () => Promise.reject(new Error('not read')),
      verifyWebhook: () => Promise.resolve({ accepted: false }),
      capabilities: () => Promise.resolve({ operations: [], managementReference: null }),
      stopRenewal: () => Promise.resolve({ outcome: 'accepted' })
    }
    for (const spec of specs) {
      const target: ManagedRecord =
        spec.operation === 'stop_renewal'
          ? { kind: 'purchase', record: PURCHASE }
          : { kind: 'subscription', record: SUBSCRIPTION }
      expect(await spec.ask(lacking, OWNER, target)).toStrictEqual({
        outcome: 'customer_action_required',
        managementReference: null
      })
      expect(spec.applies(lacking, target.kind)).toBe(false)
      expect(spec.applies(source, 'subscription')).toBe(true)
    }
    await app.close()
  })
})

describe('management: reads that start after the write', () => {
  it('shows the state after the write when a refresh that began before it is still in flight', async () => {
    // Scenario: a refresh reads the state from before the write and is released after it; the
    // read-back does not join it.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', { operations: ['extend'], managementReference: null })
    const effect = { ...SUBSCRIPTION, currentPeriodEnd: '2026-02-08T00:00:00.000Z' }
    jest.spyOn(source, 'extend').mockImplementation(async () => {
      const release = source.delayNextRead()
      void service.refresh(OWNER).catch(() => undefined)
      await new Promise((resolve) => setImmediate(resolve))
      source.setAccount(OWNER, stateOf(OWNER, effect, '2026-01-03T00:00:00.000Z'))
      setImmediate(release)
      return { outcome: 'accepted' }
    })
    expect((await service.extend(OWNER, 'sub-1', { days: 7 })).outcome).toBe('extended')
    await app.close()
  })

  it('reads on its own when the refresh in flight fails', async () => {
    // Scenario: the older refresh rejects; the operation's read is not failed by it.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', { operations: ['extend'], managementReference: null })
    source.setOperationResult('extend', 'play_store', { outcome: 'accepted' })
    const release = source.delayNextRead()
    source.failNextRead(new Error('older failed'))
    const older = service.refresh(OWNER).catch((error: unknown) => error)
    await new Promise((resolve) => setImmediate(resolve))
    const operation = service.extend(OWNER, 'sub-1', { days: 7 })
    release()
    expect(await older).toBeInstanceOf(SubscriptionError)
    expect((await operation).outcome).toBe('not_extended')
    await app.close()
  })

  it('serves two operations on one account at once while a refresh is in flight', async () => {
    // Scenario: both wait for the same older refresh and share the read that follows it.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal', 'extend'],
      managementReference: null
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    source.setOperationResult('extend', 'play_store', { outcome: 'accepted' })
    const release = source.delayNextRead()
    void service.refresh(OWNER).catch(() => undefined)
    await new Promise((resolve) => setImmediate(resolve))
    const both = Promise.all([
      service.stopRenewal(OWNER, 'sub-1'),
      service.extend(OWNER, 'sub-1', { days: 7 })
    ])
    setImmediate(release)
    expect((await both).map((result) => result.outcome)).toStrictEqual([
      'not_stopped',
      'not_extended'
    ])
    await app.close()
  })
})
