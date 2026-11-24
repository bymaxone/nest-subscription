/**
 * @fileoverview Type-level expectations for the two ports: a host implements each with nothing
 * but type imports, and a signature that changes fails to compile here.
 * @layer internal
 */
import type { SubscriptionRecord, SubscriptionSnapshot } from '../shared'
import type { Clock } from './clock'
import type {
  AccountReference,
  SourceCapabilities,
  StopRenewalResult,
  SubscriptionSource,
  WebhookVerification
} from './source.port'
import type { KeyPage, StoredSnapshot, SubscriptionStore } from './store.port'

const snapshot: SubscriptionSnapshot = {
  accountId: 'a',
  entitlements: [],
  subscriptions: [],
  source: 'minimal',
  sourceCustomer: null,
  fetchedAt: '2026-01-01T00:00:00.000Z',
  sourceUpdatedAt: null
}

const record: SubscriptionRecord = {
  subscriptionReference: 's1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'web',
  environment: 'production',
  productReference: 'pro',
  billingInterval: 'month',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: null,
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** The smallest source a host could write: it imports types only. */
const source: SubscriptionSource = {
  name: 'minimal',
  readAccount: (account: AccountReference): Promise<SubscriptionSnapshot> =>
    Promise.resolve({ ...snapshot, accountId: account.accountId }),
  verifyWebhook: (): Promise<WebhookVerification> => Promise.resolve({ accepted: false }),
  capabilities: (): SourceCapabilities => ({ operations: [], managementReference: null }),
  stopRenewal: (): Promise<StopRenewalResult> =>
    Promise.resolve({ outcome: 'customer_action_required', managementReference: null })
}

/** The smallest store a host could write: it imports types only. */
const store: SubscriptionStore = {
  getSnapshot: (): Promise<StoredSnapshot | null> => Promise.resolve(null),
  putSnapshot: (): Promise<boolean> => Promise.resolve(true),
  clearPendingChanges: (): Promise<void> => Promise.resolve(),
  listKeysWithPendingChanges: (): Promise<KeyPage> =>
    Promise.resolve({ keys: [], nextCursor: null }),
  markEventProcessed: (): Promise<boolean> => Promise.resolve(true),
  forgetEvent: (): Promise<void> => Promise.resolve(),
  deleteEventsOlderThan: (): Promise<void> => Promise.resolve(),
  listStaleKeys: (): Promise<KeyPage> => Promise.resolve({ keys: [], nextCursor: null })
}

const clock: Clock = { now: () => new Date('2026-01-01T00:00:00.000Z') }

describe('ports', () => {
  it('lets a host implement the source port from types alone', async () => {
    // Scenario: a minimal source reads an account and refuses a webhook without a reason.
    expect((await source.readAccount({ accountId: 'x' })).accountId).toBe('x')
    expect(await source.verifyWebhook({ rawBody: new Uint8Array(), headers: {} })).toEqual({
      accepted: false
    })
    expect(source.capabilities(record)).toEqual({ operations: [], managementReference: null })
    expect(await source.stopRenewal({ accountId: 'x' }, record)).toEqual({
      outcome: 'customer_action_required',
      managementReference: null
    })
  })

  it('lets a host implement the store port from types alone', async () => {
    // Scenario: a minimal store answers every method of the port.
    expect(await store.getSnapshot('k')).toBeNull()
    expect(await store.putSnapshot('k', snapshot, [], '2026-01-01T00:00:00.000Z')).toBe(true)
    expect(await store.listStaleKeys('2026-01-01T00:00:00.000Z', 10, null)).toEqual({
      keys: [],
      nextCursor: null
    })
  })

  it('lets a host supply its own clock', () => {
    // Scenario: a fixed clock is a one-method object.
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})
