/**
 * @fileoverview The options of the RevenueCat adapter: their types, their validation and the
 * resolved form with every credential and webhook secret held in a `Secret`. Validation runs
 * before anything is built, reads each option by shape, and names offending options by path
 * without ever carrying a supplied value.
 * @layer revenuecat
 */
import { Secret, SubscriptionError, type Clock } from '@bymax-one/nest-subscription/internal'
import type { SecretInput } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'
import type { SubscriptionEnvironment } from '@bymax-one/nest-subscription/shared'

/** The base address of version 2 of the RevenueCat REST API. */
export const DEFAULT_BASE_URL = 'https://api.revenuecat.com/v2'

/** How far a signature's timestamp may be from the clock when none is set: five minutes. */
export const DEFAULT_SIGNATURE_TOLERANCE_MS = 300_000

/**
 * The largest tolerance accepted: one hour. RevenueCat retries a delivery for about 80 minutes and
 * signs each attempt afresh, so a tolerance sized to that window would accept a replay for as
 * long as the retries last.
 */
export const MAX_SIGNATURE_TOLERANCE_MS = 3_600_000

/** How long a request to RevenueCat may take when no limit is set. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

/** The largest request limit accepted: the 60 seconds after which RevenueCat drops a delivery. */
export const MAX_REQUEST_TIMEOUT_MS = 60_000

/** The `fetch` of the runtime, or a stand-in with the same call shape. */
export type RevenueCatFetch = (input: string, init: RequestInit) => Promise<Response>

/** The one method of the logger the adapter uses; the framework's `Logger` has it. */
export interface RevenueCatLogger {
  /** Writes one warning line. */
  warn(message: string): void
}

/** What the adapter tells the host about an event that names only anonymous identifiers. */
export interface UnidentifiedEvent {
  /** The event kind, as the adapter names it. It holds no identifier. */
  readonly kind: string
  /** Whether the event came from a production or a sandbox purchase. */
  readonly environment: SubscriptionEnvironment
}

/** The options of `revenueCatSource`. */
export interface RevenueCatSourceOptions {
  /** The RevenueCat project the API calls are made for. */
  readonly projectId: string
  /** The version 2 secret key, one value or `{ current, previous }` during a rotation. */
  readonly apiKey: SecretInput
  /**
   * The value of the `Authorization` header RevenueCat is configured to send with each webhook,
   * one value or `{ current, previous }`. Setting it turns the header check on.
   */
  readonly webhookAuthorization?: SecretInput
  /**
   * The signing secret of the webhook, one value or `{ current, previous }`. Setting it turns the
   * signature check on, over the raw bytes with a timestamp tolerance.
   */
  readonly webhookSigningSecret?: SecretInput
  /** How far a signature's timestamp may be from now, in milliseconds. Defaults to 300 000. */
  readonly signatureToleranceMs?: number
  /** How long one request to RevenueCat may take, in milliseconds. Defaults to 10 000. */
  readonly requestTimeoutMs?: number
  /** The `fetch` to call. Defaults to the runtime's; a test passes a stub. */
  readonly fetch?: RevenueCatFetch
  /**
   * The base address of the REST API, absolute, over HTTPS unless the host is a loopback address,
   * with no credentials, query or fragment. Defaults to the address of version 2.
   */
  readonly baseUrl?: string
  /** Whether sandbox purchases grant access. Defaults to `false`. */
  readonly allowSandbox?: boolean
  /** Confirms that sandbox access is meant in a production environment. Defaults to `false`. */
  readonly confirmSandboxInProduction?: boolean
  /** Whether this is a production environment. The adapter reads no environment variable. */
  readonly isProduction?: boolean
  /** The time source for signature timestamps and snapshots. Defaults to the system clock. */
  readonly clock?: Clock
  /** Where the adapter writes its warnings. Defaults to none. */
  readonly logger?: RevenueCatLogger
  /** Called, with no identifier, for an event that names only anonymous identifiers. */
  readonly onUnidentifiedEvent?: (event: UnidentifiedEvent) => void
}

/** The options after validation, with every secret held in a `Secret`. */
export interface ResolvedRevenueCatOptions {
  /** The RevenueCat project. */
  readonly projectId: string
  /** The base address of the API, without a trailing slash. */
  readonly baseUrl: string
  /** The API key. */
  readonly apiKey: Secret
  /** The accepted `Authorization` values of the webhook, or `null` when that check is off. */
  readonly webhookAuthorization: Secret | null
  /** The accepted signing secrets of the webhook, or `null` when that check is off. */
  readonly webhookSigningSecret: Secret | null
  /** The tolerance of a signature's timestamp, in milliseconds. */
  readonly signatureToleranceMs: number
  /** The time limit of one request, in milliseconds. */
  readonly requestTimeoutMs: number
  /** The `fetch` to call. */
  readonly fetch: RevenueCatFetch
  /** Whether sandbox purchases grant access. */
  readonly allowSandbox: boolean
  /** The time source. */
  readonly clock: Clock
  /** The logger, or `null` when the host set none. */
  readonly logger: RevenueCatLogger | null
  /** The host's callback for an unidentified event, or `null`. */
  readonly onUnidentifiedEvent: ((event: UnidentifiedEvent) => void) | null
}

/** A rule returns the path of the option it refuses, or nothing when the option is acceptable. */
type Rule = (options: object) => string | undefined

const SYSTEM_CLOCK: Clock = { now: () => new Date() }

function read(options: object, path: string): unknown {
  return Reflect.get(options, path)
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function isUsable(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFunction(value: unknown): boolean {
  return typeof value === 'function'
}

function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean'
}

/** A value `Secret.from` takes: a holder, a non-empty string, or a current and previous pair. */
function isSecretInput(value: unknown): boolean {
  if (value instanceof Secret || isUsable(value)) return true
  if (!isObject(value)) return false
  const previous = Reflect.get(value, 'previous')
  return isUsable(Reflect.get(value, 'current')) && (previous === undefined || isUsable(previous))
}

function isBoundedInteger(max: number): (value: unknown) => boolean {
  return (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
}

/**
 * A loopback host as `URL` spells it: `localhost`, an address of `127.0.0.0/8`, or `[::1]`. A host
 * name that ends in four dotted numbers is always an IPv4 address to the URL parser, which has
 * already normalised it, so the pattern needs no anchor at the start.
 */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /127(?:\.\d{1,3}){3}$/.test(hostname)
}

/**
 * The parsed address when `value` is an acceptable base address, and nothing otherwise: absolute,
 * HTTPS or plain HTTP to a loopback host only, and without credentials, query or fragment.
 */
function parseBaseUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined
  const url = new URL(value)
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))
  const plain = url.username === '' && url.password === '' && url.search === '' && url.hash === ''
  return secure && plain ? url : undefined
}

function required(path: string, accepts: (value: unknown) => boolean): Rule {
  return (options) => (accepts(read(options, path)) ? undefined : path)
}

function optional(path: string, accepts: (value: unknown) => boolean): Rule {
  return (options) => {
    const value = read(options, path)
    return value === undefined || accepts(value) ? undefined : path
  }
}

/** Sandbox access in production needs the second, separate confirming option (SEC07). */
const sandboxRule: Rule = (options) =>
  read(options, 'allowSandbox') === true &&
  read(options, 'isProduction') === true &&
  read(options, 'confirmSandboxInProduction') !== true
    ? 'confirmSandboxInProduction'
    : undefined

const RULES: readonly Rule[] = [
  required('projectId', (value) => isUsable(value) && value.length <= 255),
  required('apiKey', isSecretInput),
  optional('webhookAuthorization', isSecretInput),
  optional('webhookSigningSecret', isSecretInput),
  optional('signatureToleranceMs', isBoundedInteger(MAX_SIGNATURE_TOLERANCE_MS)),
  optional('requestTimeoutMs', isBoundedInteger(MAX_REQUEST_TIMEOUT_MS)),
  optional('fetch', isFunction),
  optional('baseUrl', (value) => parseBaseUrl(value) !== undefined),
  optional('allowSandbox', isBoolean),
  optional('confirmSandboxInProduction', isBoolean),
  optional('isProduction', isBoolean),
  sandboxRule,
  optional('clock', (value) => isObject(value) && isFunction(Reflect.get(value, 'now'))),
  optional('logger', (value) => isObject(value) && isFunction(Reflect.get(value, 'warn'))),
  optional('onUnidentifiedEvent', isFunction)
]

/** The validated address with its trailing slashes removed, so a path can be appended to it. */
function normalizeBaseUrl(value: string | undefined): string {
  const url = new URL(value ?? DEFAULT_BASE_URL)
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** Calls the runtime's `fetch`, looked up at call time. */
function runtimeFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init)
}

function secretOrNull(value: SecretInput | undefined): Secret | null {
  return value === undefined ? null : Secret.from(value)
}

/**
 * Checks the options against every rule and throws one `SubscriptionError` that names each
 * offending option. No function the host supplied is called, and no supplied value is read into
 * the error.
 */
function assertOptions(input: unknown): asserts input is RevenueCatSourceOptions {
  const paths = isObject(input)
    ? [...new Set(RULES.map((rule) => rule(input)))].filter(
        (path): path is string => path !== undefined
      )
    : ['options']
  if (paths.length > 0) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID, { optionPaths: paths })
  }
}

/**
 * Validates the options and returns them resolved, with every secret held in a `Secret`. Nothing
 * is built, read from the network or logged before the whole input has been checked.
 *
 * @param input The options exactly as the host passed them.
 * @throws SubscriptionError with the invalid-configuration code and the paths of the offending
 *   options; no supplied value reaches the error.
 */
export function resolveRevenueCatOptions(input: unknown): ResolvedRevenueCatOptions {
  assertOptions(input)
  return {
    projectId: input.projectId,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: Secret.from(input.apiKey),
    webhookAuthorization: secretOrNull(input.webhookAuthorization),
    webhookSigningSecret: secretOrNull(input.webhookSigningSecret),
    signatureToleranceMs: input.signatureToleranceMs ?? DEFAULT_SIGNATURE_TOLERANCE_MS,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    fetch: input.fetch ?? runtimeFetch,
    allowSandbox: input.allowSandbox ?? false,
    clock: input.clock ?? SYSTEM_CLOCK,
    logger: input.logger ?? null,
    onUnidentifiedEvent: input.onUnidentifiedEvent ?? null
  }
}
