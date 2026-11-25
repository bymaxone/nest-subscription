/**
 * @fileoverview The source port: the one interface every billing adapter implements. Types only,
 * so a host writes an adapter with nothing imported beyond these declarations.
 * @layer internal
 */
import type {
  SubscriptionEnvironment,
  SubscriptionRecord,
  SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

/** An account of the host, as every port names it. */
export interface AccountReference {
  /** The tenant of the account; absent when the host is not multi-tenant. */
  readonly tenantId?: string | undefined
  /** The account identifier. It must not be empty or blank. */
  readonly accountId: string
}

/** A webhook request exactly as it arrived: the raw bytes, before any parsing, and its headers. */
export interface WebhookRequest {
  /** The request body as received. Verification runs over these bytes. */
  readonly rawBody: Uint8Array
  /** The request headers; a header that was not sent is `undefined`. */
  readonly headers: Readonly<Record<string, string | undefined>>
}

/** A webhook notification that passed verification. It is a trigger to read, never a state. */
export interface SourceNotification {
  /** Unique identifier of the event, used to recognise a repeated delivery. */
  readonly eventId: string
  /** The accounts the event concerns, as the host names them. */
  readonly accountIds: readonly string[]
  /** The kind of change, as the source names it. A kind the library does not know is accepted. */
  readonly kind: string
  /** When the event happened, as an ISO 8601 string. */
  readonly eventTime: string
  /** Whether the event came from a production or a sandbox purchase. */
  readonly environment: SubscriptionEnvironment
}

/**
 * The outcome of verifying a webhook request. A refusal carries no reason: which check failed is
 * never told to the caller of the webhook.
 */
export type WebhookVerification =
  | { readonly accepted: false }
  | { readonly accepted: true; readonly notification: SourceNotification }

/** A management operation an adapter can perform at the source. */
export type ManagementOperation = 'stop_renewal'

/** What can be done with one subscription, which depends on where it was purchased. */
export interface SourceCapabilities {
  /** The operations the adapter can perform for this subscription. */
  readonly operations: readonly ManagementOperation[]
  /** Where the person manages the subscription, when the source provides one. */
  readonly managementReference: string | null
}

/**
 * The result of asking the source to stop a renewal. Where a server cannot do it, that is a
 * result and not an error: the person must act, and the management reference says where.
 */
export type StopRenewalResult =
  | {
      /** The source stopped the renewal; the snapshot is the state read back afterwards. */
      readonly outcome: 'stopped'
      readonly snapshot: SubscriptionSnapshot
    }
  | {
      /** The source does not allow a server to do it. */
      readonly outcome: 'customer_action_required'
      readonly managementReference: string | null
    }

/**
 * The one interface every adapter implements. The two adapters the library ships and an adapter a
 * host writes are registered the same way and use no private entry.
 *
 * An adapter never returns a state it inferred from a webhook payload alone when it can read the
 * source instead: a notification only says that something changed, and the state comes from
 * `readAccount`.
 */
export interface SubscriptionSource {
  /** The name of this source, stored on every snapshot it produces. */
  readonly name: string

  /**
   * Reads the current state of one account from the source. An account the source does not know
   * is a snapshot with no entitlements and no subscriptions, not an error. A source that cannot
   * be reached rejects. The snapshot's `accountId` and `tenantId` are those of the account asked
   * for (no `tenantId` when none was given), and every instant in it is an ISO 8601 instant with
   * a zone; the library refuses a snapshot that is not, as a failure to read the source.
   */
  readAccount(account: AccountReference): Promise<SubscriptionSnapshot>

  /**
   * Verifies an incoming webhook request from its raw bytes and headers and returns a refusal
   * or the parsed notification. It never throws for a request that fails a check.
   */
  verifyWebhook(request: WebhookRequest): Promise<WebhookVerification>

  /** Declares what can be done with one subscription, which depends on its origin. */
  capabilities(subscription: SubscriptionRecord): SourceCapabilities

  /**
   * Asks the source to stop the renewal of a subscription the caller has already shown belongs
   * to the account. Reports what happened at the source, not what was asked.
   */
  stopRenewal(
    account: AccountReference,
    subscription: SubscriptionRecord
  ): Promise<StopRenewalResult>
}
