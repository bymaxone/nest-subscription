/**
 * @fileoverview A small client over the runtime's `fetch` for the RevenueCat REST API. It adds the
 * bearer credential, bounds each request with a time limit, refuses redirects so the credential
 * never travels to another host, and maps every failure to the library's errors with a fixed
 * message: no key, identifier, address or response body reaches an error. It never retries.
 * @layer revenuecat
 */
import { SubscriptionError, type Secret } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import type { RevenueCatFetch } from './revenuecat.options'

/** What the client needs from the resolved options. */
export interface RevenueCatHttpConfig {
  /** The base address, without a trailing slash. */
  readonly baseUrl: string
  /** The API key. */
  readonly apiKey: Secret
  /** The time limit of one request, in milliseconds. */
  readonly timeoutMs: number
  /** The `fetch` to call. */
  readonly fetch: RevenueCatFetch
}

/** The query parameters of a request. */
export type RevenueCatQuery = Readonly<Record<string, string>>

/** The status of RevenueCat's answer for a resource it has no record of. */
const NOT_FOUND = 404

/**
 * Percent-encodes one path segment, so an identifier can never add or end a segment.
 *
 * @throws SubscriptionError with the account-unknown code for `.` and `..`: a URL resolves those
 *   as steps of the path even when they are percent-encoded, so no such identifier can be sent.
 */
export function encodeSegment(value: string): string {
  if (value === '.' || value === '..') {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
  }
  return encodeURIComponent(value)
}

/** The error of a failed call: the source could not be read, with no detail that could leak. */
function unavailable(): SubscriptionError {
  return new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
}

/** The client of the RevenueCat REST API. */
export class RevenueCatHttp {
  readonly #baseUrl: string
  readonly #apiKey: Secret
  readonly #timeoutMs: number
  readonly #fetch: RevenueCatFetch

  /** @param config The address, the credential, the time limit and the `fetch` to use. */
  constructor(config: RevenueCatHttpConfig) {
    this.#baseUrl = config.baseUrl
    this.#apiKey = config.apiKey
    this.#timeoutMs = config.timeoutMs
    this.#fetch = config.fetch
  }

  /**
   * Reads a resource and returns its parsed body as `unknown`: shaping it is the caller's job.
   *
   * @param path The path after the base address, with every identifier already encoded.
   * @param query The query parameters, if any.
   * @throws SubscriptionError with the account-unknown code for a 404, and with the
   *   source-unavailable code for a network error, a timeout, a redirect, a 429, a 5xx, any other
   *   non-success status, or a body that is not JSON.
   */
  get(path: string, query?: RevenueCatQuery): Promise<unknown> {
    return this.#send(path, query, { method: 'GET' })
  }

  /**
   * Sends a request and returns the parsed answer as `unknown`.
   *
   * @param path The path after the base address, with every identifier already encoded.
   * @param body The value to send as JSON; none is sent, and no content type, when it is absent.
   * @throws SubscriptionError as {@link RevenueCatHttp.get} does.
   */
  post(path: string, body?: unknown): Promise<unknown> {
    return this.#send(path, undefined, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  }

  async #send(
    path: string,
    query: RevenueCatQuery | undefined,
    init: { readonly method: string; readonly body?: string }
  ): Promise<unknown> {
    const search = query === undefined ? '' : `?${new URLSearchParams(query).toString()}`
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey.reveal()}`,
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' })
    }
    let response: Response
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}${search}`, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs)
      })
    } catch {
      throw unavailable()
    }
    return this.#parse(response)
  }

  async #parse(response: Response): Promise<unknown> {
    if (!response.ok) {
      try {
        await response.body?.cancel()
      } catch {
        // A body that cannot be released changes nothing: the status decides.
      }
      throw response.status === NOT_FOUND
        ? new SubscriptionError(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
        : unavailable()
    }
    try {
      const parsed: unknown = await response.json()
      return parsed
    } catch {
      throw unavailable()
    }
  }
}
