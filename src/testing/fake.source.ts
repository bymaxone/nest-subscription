/**
 * @fileoverview A scriptable billing source for tests. A test sets an account's state, queues a
 * notification, delays or fails the next read and counts reads, all without a network. It
 * implements the public source port and nothing more: a host can write an equivalent from the
 * root's types alone.
 * @layer testing
 */
import { createHash } from 'node:crypto'

import type {
  AccountReference,
  Clock,
  SourceCapabilities,
  SourceNotification,
  StopRenewalResult,
  SubscriptionSource,
  WebhookRequest,
  WebhookVerification
} from '@bymax-one/nest-subscription'

import {
  SUBSCRIPTION_ENVIRONMENTS,
  createEmptySnapshot,
  type SubscriptionOrigin,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '../shared'

/** Options of {@link FakeSubscriptionSource}. */
export interface FakeSourceOptions {
  /** The source name stored on the snapshots it makes. Defaults to `fake`. */
  readonly name?: string
  /** The time source for the snapshots of unknown accounts. Defaults to the system clock. */
  readonly clock?: Clock
}

/** The header that carries the signature of a request built by the fake source. */
const SIGNATURE_HEADER = 'x-fake-signature'

/** The capabilities a subscription has until a test scripts them: none. */
const NO_CAPABILITIES: SourceCapabilities = { operations: [], managementReference: null }

/** The system clock, for a fake source built without one. */
const SYSTEM_CLOCK: Clock = { now: () => new Date() }

/** A value kept per account without ever joining tenant and account into one string. */
class PerAccount<V> {
  readonly #byTenant = new Map<string | undefined, Map<string, V>>()

  get(account: AccountReference): V | undefined {
    return this.#byTenant.get(account.tenantId)?.get(account.accountId)
  }

  set(account: AccountReference, value: V): void {
    const accounts = this.#byTenant.get(account.tenantId) ?? new Map<string, V>()
    this.#byTenant.set(account.tenantId, accounts)
    accounts.set(account.accountId, value)
  }
}

/** The signature of a body: a digest a test cannot get right by accident. */
function sign(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

/** Whether a parsed value has the shape of a notification. */
function isNotification(value: unknown): value is SourceNotification {
  // `Object` wraps a primitive and turns `null` into an empty object, so a value that is not an
  // object has none of the fields below and is refused with them.
  const candidate: Record<string, unknown> = Object(value)
  return (
    typeof candidate['eventId'] === 'string' &&
    Array.isArray(candidate['accountIds']) &&
    candidate['accountIds'].every((id) => typeof id === 'string') &&
    typeof candidate['kind'] === 'string' &&
    typeof candidate['eventTime'] === 'string' &&
    SUBSCRIPTION_ENVIRONMENTS.some((environment) => environment === candidate['environment'])
  )
}

/** The notification a body holds, or `undefined` when the body is not one. */
function parseNotification(body: Uint8Array): SourceNotification | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
    return isNotification(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * A scripted `SubscriptionSource`. An account no test has set reads as an account the source does
 * not know. Reads can be counted, delayed by a promise the test resolves, and failed once.
 */
export class FakeSubscriptionSource implements SubscriptionSource {
  readonly name: string
  readonly #clock: Clock
  readonly #states = new PerAccount<SubscriptionSnapshot>()
  readonly #reads = new PerAccount<number>()
  readonly #capabilities = new Map<SubscriptionOrigin, SourceCapabilities>()
  readonly #stopResults = new Map<SubscriptionOrigin, StopRenewalResult>()
  readonly #queued: WebhookRequest[] = []
  readonly #gates: Array<Promise<void>> = []
  readonly #failures: unknown[] = []
  #totalReads = 0
  #stopRenewalCalls = 0

  /** @param options The source name and the clock for the snapshots of unknown accounts. */
  constructor(options: FakeSourceOptions = {}) {
    this.name = options.name ?? 'fake'
    this.#clock = options.clock ?? SYSTEM_CLOCK
  }

  /** Sets the snapshot the source returns for an account until it is set again. */
  setAccount(account: AccountReference, snapshot: SubscriptionSnapshot): void {
    this.#states.set(account, snapshot)
  }

  /** Makes the next read reject with the given error. Several calls queue several failures. */
  failNextRead(error: unknown): void {
    this.#failures.push(error)
  }

  /**
   * Holds the next read until the returned function is called. Several calls hold several reads,
   * in order; no timer is involved.
   */
  delayNextRead(): () => void {
    let release!: () => void
    this.#gates.push(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    return release
  }

  /** How many times the account was read. */
  readCount(account: AccountReference): number {
    return this.#reads.get(account) ?? 0
  }

  /** How many reads the source served in all, whatever the account. */
  get totalReads(): number {
    return this.#totalReads
  }

  /** How many times a renewal stop was asked. */
  get stopRenewalCalls(): number {
    return this.#stopRenewalCalls
  }

  /** Sets what `capabilities` answers for every subscription bought from an origin. */
  setCapabilities(origin: SubscriptionOrigin, capabilities: SourceCapabilities): void {
    this.#capabilities.set(origin, capabilities)
  }

  /** Sets what `stopRenewal` answers for every subscription bought from an origin. */
  setStopRenewalResult(origin: SubscriptionOrigin, result: StopRenewalResult): void {
    this.#stopResults.set(origin, result)
  }

  /** Builds the signed request that `verifyWebhook` accepts for a notification. */
  buildRequest(notification: SourceNotification): WebhookRequest {
    const rawBody = new TextEncoder().encode(JSON.stringify(notification))
    return { rawBody, headers: { [SIGNATURE_HEADER]: sign(rawBody) } }
  }

  /** Queues a notification and returns its request; `nextQueuedRequest` hands them out in order. */
  queueNotification(notification: SourceNotification): WebhookRequest {
    const request = this.buildRequest(notification)
    this.#queued.push(request)
    return request
  }

  /** Removes and returns the oldest queued request, or `undefined` when none is queued. */
  nextQueuedRequest(): WebhookRequest | undefined {
    return this.#queued.shift()
  }

  async readAccount(account: AccountReference): Promise<SubscriptionSnapshot> {
    this.#totalReads += 1
    this.#reads.set(account, this.readCount(account) + 1)
    await this.#gates.shift()
    if (this.#failures.length > 0) {
      throw this.#failures.shift()
    }
    return (
      this.#states.get(account) ??
      createEmptySnapshot({
        accountId: account.accountId,
        ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
        source: this.name,
        fetchedAt: this.#clock.now().toISOString()
      })
    )
  }

  verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    const notification =
      request.headers[SIGNATURE_HEADER] === sign(request.rawBody)
        ? parseNotification(request.rawBody)
        : undefined
    return Promise.resolve(
      notification === undefined ? { accepted: false } : { accepted: true, notification }
    )
  }

  capabilities(subscription: SubscriptionRecord): SourceCapabilities {
    return this.#capabilities.get(subscription.origin) ?? NO_CAPABILITIES
  }

  stopRenewal(
    _account: AccountReference,
    subscription: SubscriptionRecord
  ): Promise<StopRenewalResult> {
    this.#stopRenewalCalls += 1
    return Promise.resolve(
      this.#stopResults.get(subscription.origin) ?? {
        outcome: 'customer_action_required',
        managementReference: subscription.managementReference
      }
    )
  }
}
