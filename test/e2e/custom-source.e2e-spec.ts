/**
 * @fileoverview A billing source written the way a host writes one: against the types of the root
 * entry point only, with no import from the internal bundle and no private member. It proves the
 * source port is implementable from outside the package and runs through the port.
 * @layer e2e
 */
import type {
  AccountReference,
  SourceCapabilities,
  StopRenewalResult,
  SubscriptionRecord,
  SubscriptionSnapshot,
  SubscriptionSource,
  WebhookRequest,
  WebhookVerification
} from '@bymax-one/nest-subscription'

const REFUSED_BODY = 'refuse'

const RECORD: SubscriptionRecord = {
  subscriptionReference: 's1',
  status: 'active',
  givesAccess: true,
  willRenew: 'no',
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

/** A host's own adapter: it knows two accounts and accepts one literal body. */
class HostSource implements SubscriptionSource {
  readonly name = 'host'

  readAccount(account: AccountReference): Promise<SubscriptionSnapshot> {
    return Promise.resolve({
      accountId: account.accountId,
      entitlements: [],
      subscriptions: [],
      source: this.name,
      sourceCustomer: null,
      fetchedAt: '2026-01-01T00:00:00.000Z',
      sourceUpdatedAt: null
    })
  }

  verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    const body = new TextDecoder().decode(request.rawBody)
    return Promise.resolve(
      body === REFUSED_BODY
        ? { accepted: false }
        : {
            accepted: true,
            notification: {
              eventId: body,
              accountIds: ['acc_1'],
              kind: 'CUSTOM',
              eventTime: '2026-01-01T00:00:00.000Z',
              environment: 'production'
            }
          }
    )
  }

  capabilities(): SourceCapabilities {
    return { operations: ['stop_renewal'], managementReference: null }
  }

  stopRenewal(account: AccountReference): Promise<StopRenewalResult> {
    return this.readAccount(account).then((snapshot) => ({ outcome: 'stopped', snapshot }))
  }
}

describe('a source written against root exports only', () => {
  const source: SubscriptionSource = new HostSource()
  const request = (body: string): WebhookRequest => ({
    rawBody: new TextEncoder().encode(body),
    headers: {}
  })

  it('reads an account through the port', async () => {
    // Scenario: the host's adapter answers a read with a snapshot of the model.
    expect((await source.readAccount({ accountId: 'acc_1' })).source).toBe('host')
  })

  it('accepts and refuses webhook requests through the port without a reason', async () => {
    // Scenario: one body is accepted and parsed, the other is refused with no reason attached.
    const accepted = await source.verifyWebhook(request('evt_1'))
    expect(accepted.accepted && accepted.notification.eventId).toBe('evt_1')
    expect(await source.verifyWebhook(request(REFUSED_BODY))).toEqual({ accepted: false })
  })

  it('declares capabilities and stops a renewal through the port', async () => {
    // Scenario: the capabilities name the operation, and the stop returns the state read back.
    expect(source.capabilities(RECORD).operations).toEqual(['stop_renewal'])
    const stopped = await source.stopRenewal({ accountId: 'acc_1' }, RECORD)
    expect(stopped.outcome).toBe('stopped')
  })
})
