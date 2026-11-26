/**
 * @fileoverview `revenueCatSource`: the factory that returns RevenueCat as a billing source. The
 * adapter reads a customer from version 2 of the REST API, verifies webhooks by the header and by
 * the signature, filters sandbox purchases itself, and turns an event into the accounts to read.
 * Everything it holds, credentials and webhook secrets included, is in `#private` fields, so no
 * serialization, spread or inspection of the adapter reaches a secret (SEC05).
 * @layer revenuecat
 */
import type {
  AccountReference,
  ManagedRecord,
  OperationResult,
  SourceCapabilities,
  SubscriptionSource,
  WebhookRequest,
  WebhookVerification
} from '@bymax-one/nest-subscription/internal'
import type {
  SubscriptionEnvironment,
  SubscriptionRecord,
  SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { readRevenueCatAccount } from './read/read-account'
import type { RevenueCatReadContext } from './read/read-context'
import { RevenueCatHttp } from './revenuecat-http'
import {
  resolveRevenueCatOptions,
  type ResolvedRevenueCatOptions,
  type RevenueCatSourceOptions
} from './revenuecat.options'
import { parseEvent } from './webhook/parse-event'
import { REFUSED, isAuthentic, reportWeakMethod } from './webhook/verify-webhook'

/** The name stored on every snapshot this source makes. */
export const REVENUECAT_SOURCE_NAME = 'revenuecat'

/** The line written for an event that names no account the host can have. */
export const UNIDENTIFIED_EVENT_LINE =
  'A RevenueCat event named only anonymous identifiers, so no account was refreshed.'

/** The adapter. It is built by {@link revenueCatSource}. */
class RevenueCatSource implements SubscriptionSource {
  readonly name = REVENUECAT_SOURCE_NAME
  readonly #options: ResolvedRevenueCatOptions
  readonly #context: RevenueCatReadContext

  constructor(options: ResolvedRevenueCatOptions) {
    this.#options = options
    this.#context = {
      http: new RevenueCatHttp({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        timeoutMs: options.requestTimeoutMs,
        fetch: options.fetch
      }),
      projectId: options.projectId,
      sourceName: REVENUECAT_SOURCE_NAME,
      allowSandbox: options.allowSandbox,
      clock: options.clock
    }
  }

  readAccount(account: AccountReference): Promise<SubscriptionSnapshot> {
    return readRevenueCatAccount(this.#context, account)
  }

  verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    if (!isAuthentic(this.#options, request)) return Promise.resolve(REFUSED)
    const { notification, unidentified } = parseEvent(request.rawBody, this.#options.clock.now())
    if (unidentified) this.#reportUnidentified(notification.kind, notification.environment)
    return Promise.resolve({ accepted: true, notification })
  }

  capabilities(_account: AccountReference, target: ManagedRecord): Promise<SourceCapabilities> {
    return Promise.resolve({
      operations: [],
      managementReference: target.kind === 'subscription' ? target.record.managementReference : null
    })
  }

  stopRenewal(
    _account: AccountReference,
    subscription: SubscriptionRecord
  ): Promise<OperationResult> {
    return Promise.resolve({
      outcome: 'customer_action_required',
      managementReference: subscription.managementReference
    })
  }

  /** Records an event that named no account, with no identifier, and never fails the request. */
  #reportUnidentified(kind: string, environment: SubscriptionEnvironment): void {
    try {
      this.#options.logger?.warn(UNIDENTIFIED_EVENT_LINE)
    } catch {
      // A logger that fails must not fail the verification.
    }
    try {
      this.#options.onUnidentifiedEvent?.({ kind, environment })
    } catch {
      // A callback that fails must not fail the verification.
    }
  }
}

/**
 * Creates the RevenueCat source. The options are validated before anything else happens; when only
 * the static authorization header is configured, the weaker method is reported once through the
 * logger.
 *
 * @param options The project, the credentials, the webhook secrets and the settings.
 * @throws SubscriptionError with the invalid-configuration code, naming the offending options.
 */
export function revenueCatSource(options: RevenueCatSourceOptions): SubscriptionSource {
  const resolved = resolveRevenueCatOptions(options)
  reportWeakMethod(resolved)
  return new RevenueCatSource(resolved)
}
