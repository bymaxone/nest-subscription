/**
 * @fileoverview Pins the capability query and stop renewal through the service: the record is
 * found in the account's own snapshot before any source is asked, the answer comes from the
 * adapter each time, and the result of an operation is the snapshot read back, never the request.
 * @layer core
 */
import { SubscriptionError, encodeAccountKey } from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import {
  ACCOUNT,
  harness,
  purchaseOf,
  snapshotOf,
  subscriptionOf
} from './management/management.builders.spec'

const STOP_AND_REFUND = {
  operations: ['stop_renewal', 'refund'],
  managementReference: 'https://manage.example/sub-1'
} as const

describe('SubscriptionService capabilities', () => {
  it('answers, per operation, what the adapter says for the origin of the subscription', async () => {
    // Scenario: Google Play can stop and refund; an App Store record of the same account can do
    // nothing, and the answer follows the origin, not the account.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    await seed(
      ACCOUNT,
      snapshotOf(ACCOUNT, [
        subscriptionOf(),
        subscriptionOf({ subscriptionReference: 'sub-2', origin: 'app_store' })
      ])
    )
    expect(await service.getCapabilities(ACCOUNT, 'sub-1')).toStrictEqual({
      kind: 'subscription',
      possible: {
        stop_renewal: true,
        resume: false,
        change_product: false,
        extend: false,
        refund: true
      },
      managementReference: 'https://manage.example/sub-1'
    })
    expect((await service.getCapabilities(ACCOUNT, 'sub-2')).possible).toStrictEqual({
      stop_renewal: false,
      resume: false,
      change_product: false,
      extend: false,
      refund: false
    })
  })

  it('answers for a non-renewing purchase of the account', async () => {
    // Scenario: the purchase is a record of the account; the adapter is asked about it by kind.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', { operations: ['refund'], managementReference: null })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [], [purchaseOf()]))
    const answer = await service.getCapabilities(ACCOUNT, 'pur-1')
    expect(answer.kind).toBe('purchase')
    expect(answer.possible.refund).toBe(true)
    expect(answer.possible.stop_renewal).toBe(false)
  })

  it('asks the adapter again on every call and keeps nothing in the snapshot', async () => {
    // Scenario: the adapter's answer changes between two calls; the second call shows it and the
    // stored snapshot is the one that was seeded.
    const { source, store, seed, service } = harness()
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    const before = structuredClone((await store.getSnapshot(encodeAccountKey(ACCOUNT)))?.snapshot)
    expect((await service.getCapabilities(ACCOUNT, 'sub-1')).possible.refund).toBe(false)
    source.setCapabilities('play_store', STOP_AND_REFUND)
    expect((await service.getCapabilities(ACCOUNT, 'sub-1')).possible.refund).toBe(true)
    expect((await store.getSnapshot(encodeAccountKey(ACCOUNT)))?.snapshot).toStrictEqual(before)
  })

  it('returns the management reference, or null when the source gives none', async () => {
    // Scenario: one origin gives a reference, another does not.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    await seed(
      ACCOUNT,
      snapshotOf(ACCOUNT, [
        subscriptionOf(),
        subscriptionOf({ subscriptionReference: 'sub-2', origin: 'web' })
      ])
    )
    expect(await service.getManagementReference(ACCOUNT, 'sub-1')).toBe(
      'https://manage.example/sub-1'
    )
    expect(await service.getManagementReference(ACCOUNT, 'sub-2')).toBeNull()
  })

  it.each([
    ['another account', { accountId: 'acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'acc-1', tenantId: 'tenant-b' }]
  ])('refuses a record of %s without asking the adapter', async (_label, caller) => {
    // Scenario: the record exists, for someone else; the adapter is not reached.
    const { source, seed, service } = harness(true)
    const owner = { accountId: 'acc-1', tenantId: 'tenant-a' }
    await seed(owner, snapshotOf(owner, [subscriptionOf()], [purchaseOf()]))
    const asked = jest.spyOn(source, 'capabilities')
    for (const reference of ['sub-1', 'pur-1']) {
      await expect(service.getCapabilities(caller, reference)).rejects.toMatchObject({
        code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
      })
      await expect(service.getManagementReference(caller, reference)).rejects.toBeInstanceOf(
        SubscriptionError
      )
    }
    expect(asked).not.toHaveBeenCalled()
  })

  it('refuses a multi-tenant account without a tenant as invalid input', async () => {
    // Scenario: the tenant rule of the configuration applies before the lookup.
    const { service } = harness(true)
    await expect(service.getCapabilities(ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
  })

  it('reports an adapter that rejects as a source failure, and keeps a library error as it is', async () => {
    // Scenario: a plain rejection is wrapped with the original as cause; a SubscriptionError and a
    // synchronous throw are kept or wrapped the same way.
    const { source, seed, service } = harness()
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    const cause = new Error('boom')
    jest.spyOn(source, 'capabilities').mockRejectedValueOnce(cause)
    const failure: unknown = await service
      .getCapabilities(ACCOUNT, 'sub-1')
      .catch((e: unknown) => e)
    expect(failure).toMatchObject({ code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE, cause })
    jest
      .spyOn(source, 'capabilities')
      .mockRejectedValueOnce(new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID))
    await expect(service.getCapabilities(ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID
    })
    jest.spyOn(source, 'capabilities').mockImplementationOnce(() => {
      throw cause
    })
    await expect(service.getCapabilities(ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
  })
})

/** The state the source reports after the renewal was stopped. */
function stoppedState(): SubscriptionSnapshot {
  return snapshotOf(ACCOUNT, [subscriptionOf({ willRenew: 'no' })], [], '2026-01-02T00:00:00.000Z')
}

describe('SubscriptionService.stopRenewal', () => {
  it('calls the source once, refreshes and returns the snapshot read back, with will renew no', async () => {
    // Scenario: Google Play can stop; once the source accepts, its next read shows will renew no.
    // The account is read twice: before the write and after it.
    const { source, seed, service, store } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' }, () =>
      source.setAccount(ACCOUNT, stoppedState())
    )
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    const reads = source.readCount(ACCOUNT)
    const result = await service.stopRenewal(ACCOUNT, 'sub-1')
    expect(result.outcome).toBe('stopped')
    if (!('snapshot' in result)) throw new Error('the source took the request')
    expect(result.snapshot.subscriptions[0]?.willRenew).toBe('no')
    expect(source.stopRenewalCalls).toBe(1)
    expect(source.readCount(ACCOUNT)).toBe(reads + 2)
    expect(
      (await store.getSnapshot(encodeAccountKey(ACCOUNT)))?.snapshot.subscriptions[0]?.willRenew
    ).toBe('no')
  })

  it('reports not stopped when the source accepted and the read-back still shows a renewing subscription', async () => {
    // Scenario: the request is accepted but the next read is unchanged; the result says so.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    source.setAccount(
      ACCOUNT,
      snapshotOf(ACCOUNT, [subscriptionOf()], [], '2026-01-02T00:00:00.000Z')
    )
    const result = await service.stopRenewal(ACCOUNT, 'sub-1')
    expect(result.outcome).toBe('not_stopped')
    if (!('snapshot' in result)) throw new Error('the source took the request')
    expect(result.snapshot.subscriptions[0]?.willRenew).toBe('yes')
  })

  it('reports not stopped when the read-back no longer holds the subscription or is older than the stored one', async () => {
    // Scenario: once the source accepts, the record is gone from the read; then the source
    // reports an older state than the store holds, which the store keeps.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' }, () =>
      source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, [], [], '2026-01-06T00:00:00.000Z'))
    )
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()], [], '2026-01-05T00:00:00.000Z'))
    expect((await service.stopRenewal(ACCOUNT, 'sub-1')).outcome).toBe('not_stopped')
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()], [], '2026-01-07T00:00:00.000Z'))
    source.setAccount(ACCOUNT, stoppedState())
    expect((await service.stopRenewal(ACCOUNT, 'sub-1')).outcome).toBe('not_stopped')
  })

  it('calls nothing at the source where the adapter says a server cannot, and returns the management reference', async () => {
    // Scenario: nothing is scripted as possible; the answer is a value, not an error.
    const { source, seed, service } = harness()
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf({ origin: 'app_store' })]))
    source.setCapabilities('app_store', {
      operations: [],
      managementReference: 'https://apps.example/manage'
    })
    expect(await service.stopRenewal(ACCOUNT, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://apps.example/manage'
    })
    expect(source.totalOperationCalls).toBe(0)
  })

  it('returns what the source says when it declines a request the capabilities allowed', async () => {
    // Scenario: the adapter lists the operation, and the call itself answers customer action
    // required with its own reference.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    source.setOperationResult('stop_renewal', 'play_store', {
      outcome: 'customer_action_required',
      managementReference: 'https://play.example/manage'
    })
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    expect(await service.stopRenewal(ACCOUNT, 'sub-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://play.example/manage'
    })
    expect(source.stopRenewalCalls).toBe(1)
  })

  it('does not ask the source to stop the renewal of a non-renewing purchase', async () => {
    // Scenario: the origin can stop renewals, but a purchase renews nothing.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [], [purchaseOf()]))
    expect(await service.stopRenewal(ACCOUNT, 'pur-1')).toStrictEqual({
      outcome: 'person_must_act',
      managementReference: 'https://manage.example/sub-1'
    })
    expect(source.totalOperationCalls).toBe(0)
  })

  it.each([
    ['another account', { accountId: 'acc-2', tenantId: 'tenant-a' }],
    ['another tenant', { accountId: 'acc-1', tenantId: 'tenant-b' }]
  ])('refuses a subscription of %s and reaches no source', async (_label, caller) => {
    // Scenario: SEC10: the record exists for someone else; neither a capability query nor an
    // operation reaches the source.
    const { source, seed, service } = harness(true)
    source.setCapabilities('play_store', STOP_AND_REFUND)
    const owner = { accountId: 'acc-1', tenantId: 'tenant-a' }
    await seed(owner, snapshotOf(owner, [subscriptionOf()]))
    const asked = jest.spyOn(source, 'capabilities')
    await expect(service.stopRenewal(caller, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    })
    expect(asked).not.toHaveBeenCalled()
    expect(source.totalOperationCalls).toBe(0)
    expect(source.readCount(caller)).toBe(0)
  })

  it('surfaces a rejecting call, a call that throws at once and a failing fresh read as the source-unavailable code', async () => {
    // Scenario: each failure before the answer is the same code.
    const { source, seed, service } = harness()
    source.setCapabilities('play_store', STOP_AND_REFUND)
    await seed(ACCOUNT, snapshotOf(ACCOUNT, [subscriptionOf()]))
    jest.spyOn(source, 'stopRenewal').mockRejectedValueOnce(new Error('upstream'))
    await expect(service.stopRenewal(ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    jest.spyOn(source, 'stopRenewal').mockImplementationOnce(() => {
      throw new Error('upstream')
    })
    await expect(service.stopRenewal(ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    source.setOperationResult('stop_renewal', 'play_store', { outcome: 'accepted' })
    source.failNextRead(new Error('read failed'))
    await expect(service.stopRenewal(ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
  })

  it('refuses a multi-tenant account without a tenant before anything else', async () => {
    // Scenario: the tenant rule applies to operations as it does to reads.
    const { service, source } = harness(true)
    await expect(service.stopRenewal(ACCOUNT, 'sub-1')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    expect(source.totalOperationCalls).toBe(0)
  })
})
