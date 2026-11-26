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
  type ManagementOperation,
  type SubscriptionChangeNotification
} from '@bymax-one/nest-subscription'
import {
  createEmptySnapshot,
  type NonRenewingPurchaseRecord,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-02T00:00:00.000Z'
const OWNER: AccountReference = { accountId: 'acc-1', tenantId: 'tenant-a' }

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
async function boot(): Promise<{
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
    if (result.outcome === 'person_must_act') throw new Error('the source took the request')
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
    ['another account', { accountId: 'acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'acc-1', tenantId: 'tenant-b' }]
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
    // Scenario: the source accepted and its next read has no such subscription.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: ['stop_renewal'],
      managementReference: null
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    source.setAccount(OWNER, { ...stateOf(OWNER, SUBSCRIPTION, T1), subscriptions: [] })
    expect((await service.stopRenewal(OWNER, 'sub-1')).outcome).toBe('not_stopped')
    await app.close()
  })

  it('surfaces each kind of source failure as the source-unavailable code, and keeps a library error', async () => {
    // Scenario: the adapter rejects, throws at once, fails the capability query, or the read-back
    // fails; a library error from the adapter keeps its own code.
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
    // Scenario: one call, one refresh; the result follows the source's next read in both cases.
    const { app, source, service } = await boot()
    source.setCapabilities('play_store', {
      operations: [operation.name],
      managementReference: null
    })
    source.setOperationResult(operation.name, 'play_store', { outcome: 'accepted' })
    source.setAccount(OWNER, stateOf(OWNER, SUBSCRIPTION, T1))
    const unchanged = await operation.call(service, OWNER, 'sub-1')
    source.setAccount(OWNER, stateOf(OWNER, operation.effect, '2026-01-03T00:00:00.000Z'))
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
    ['another account', { accountId: 'acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'acc-1', tenantId: 'tenant-b' }]
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
    await expect(service.changeProduct(OWNER, 'sub-1', ' ')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    expect(source.totalOperationCalls).toBe(1)
    await app.close()
  })
})
