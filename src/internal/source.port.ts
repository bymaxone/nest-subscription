/**
 * @fileoverview The source port: the one interface every billing adapter implements. Types only,
 * so a host writes an adapter with nothing imported beyond these declarations.
 * @layer internal
 */
import type {
  NonRenewingPurchaseRecord,
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
export type ManagementOperation = 'stop_renewal' | 'resume' | 'change_product' | 'extend' | 'refund'

/**
 * A record an operation can act on, tagged with its kind. It is always taken from the
 * authenticated account's own snapshot, never built from an identifier a caller supplied.
 */
export type ManagedRecord =
  | { readonly kind: 'subscription'; readonly record: SubscriptionRecord }
  | { readonly kind: 'purchase'; readonly record: NonRenewingPurchaseRecord }

/** What can be done with one record, which depends on where it was purchased. */
export interface SourceCapabilities {
  /** The operations the adapter can perform for this record. */
  readonly operations: readonly ManagementOperation[]
  /** Where the person manages the record, when the source provides one. */
  readonly managementReference: string | null
}

/** The reason of an extension, for the origins that ask for one. */
export type ExtendReason =
  'undeclared' | 'customer_satisfaction' | 'other' | 'service_issue_or_outage'

/** The extension a caller asks for. */
export interface ExtendRequest {
  /** How many whole days the current period is extended by; at least 1. */
  readonly days: number
  /** The reason code, for the origins that require one. */
  readonly reason?: ExtendReason | undefined
}

/**
 * What a source says about a request it was given. Where a server cannot do it, that is a result
 * and not an error: the person must act, and the management reference says where. `accepted` only
 * says the source took the request. It is never the result of an operation, which is the state
 * read back afterwards.
 */
export type OperationResult =
  | {
      /** The source took the request. */
      readonly outcome: 'accepted'
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
   * Declares whether this source admits sandbox purchases. The module compares it with its own
   * `allowSandbox` at boot, only when the host set that option, and refuses a boot where the two
   * differ. A source that does not declare it is never compared.
   */
  readonly admitsSandbox?: boolean

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

  /**
   * Declares what can be done with one record of the account, which depends on its origin. It may
   * read the source to learn what the origin alone does not say, and it changes nothing.
   */
  capabilities(account: AccountReference, target: ManagedRecord): Promise<SourceCapabilities>

  /**
   * Asks the source to stop the renewal of a subscription the caller has already shown belongs
   * to the account. Reports what the source did with the request, not what became of the state.
   */
  stopRenewal(account: AccountReference, subscription: SubscriptionRecord): Promise<OperationResult>

  /** Asks the source to resume a renewal that was stopped. An adapter without it omits it. */
  resume?(account: AccountReference, subscription: SubscriptionRecord): Promise<OperationResult>

  /** Asks the source to change the product of a subscription. An adapter without it omits it. */
  changeProduct?(
    account: AccountReference,
    subscription: SubscriptionRecord,
    productReference: string
  ): Promise<OperationResult>

  /** Asks the source to extend the current period. An adapter without it omits it. */
  extend?(
    account: AccountReference,
    subscription: SubscriptionRecord,
    extension: ExtendRequest
  ): Promise<OperationResult>

  /** Asks the source to refund a subscription or a purchase. An adapter without it omits it. */
  refund?(account: AccountReference, target: ManagedRecord): Promise<OperationResult>
}
