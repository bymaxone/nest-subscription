/**
 * @fileoverview Refuses an invalid configuration at boot with one error that names every
 * offending option and carries no value. Each rule inspects its option by shape and returns the
 * option's path or nothing; the message is built from those paths alone, so no supplied value,
 * secret or otherwise, can reach it.
 * @layer core
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { MAX_WEBHOOK_DEADLINE_MS } from './defaults'
import type { SubscriptionOptionsInput } from './subscription-options.types'

/** The options as the host passed them: nothing is assumed about any field. */
type Candidate = object

/** A rule returns the path of the option it refuses, or nothing when the option is acceptable. */
type Rule = (options: Candidate) => string | undefined

/** The methods of the source port; a source is recognised by them and never called. */
const SOURCE_METHODS = ['readAccount', 'verifyWebhook', 'capabilities', 'stopRenewal'] as const

/** The methods of the store port. */
const STORE_METHODS = [
  'getSnapshot',
  'putSnapshot',
  'clearPendingChanges',
  'listKeysWithPendingChanges',
  'markEventProcessed',
  'forgetEvent',
  'deleteEventsOlderThan',
  'listStaleKeys'
] as const

/** The methods of the optional cache. */
const CACHE_METHODS = ['get', 'set', 'delete'] as const

/** The values of the fail policy. */
const FAIL_POLICIES: readonly unknown[] = ['refuse', 'last_known_state']

/** A route: optional leading slash, then segments of unreserved characters. */
const ROUTE = /^\/?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/

/** Whether a value is a route the controller can be mounted on. */
export function isWebhookRoute(value: unknown): value is string {
  return typeof value === 'string' && ROUTE.test(value)
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function read(options: Candidate, path: string): unknown {
  return Reflect.get(options, path)
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  return (
    isObject(value) && methods.every((method) => typeof Reflect.get(value, method) === 'function')
  )
}

function isSource(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof Reflect.get(value, 'name') === 'string' &&
    hasMethods(value, SOURCE_METHODS)
  )
}

function isPositiveSafeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isPositiveDuration(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** A positive finite number of milliseconds the source does not outlast. */
function isDeadline(value: unknown): boolean {
  return typeof value === 'number' && isPositiveDuration(value) && value <= MAX_WEBHOOK_DEADLINE_MS
}

/** A rule for an option that must be present and satisfy `accepts`. */
function required(path: string, accepts: (value: unknown) => boolean): Rule {
  return (options) => (accepts(read(options, path)) ? undefined : path)
}

/** A rule for an option that may be absent; when present it must satisfy `accepts`. */
function optional(path: string, accepts: (value: unknown) => boolean): Rule {
  return (options) => {
    const value = read(options, path)
    return value === undefined || accepts(value) ? undefined : path
  }
}

const isBoolean = (value: unknown): boolean => typeof value === 'boolean'

/** Sandbox access in production needs the second, separate confirming option (SEC07). */
const sandboxRule: Rule = (options) => {
  const refused =
    read(options, 'allowSandbox') === true &&
    read(options, 'isProduction') === true &&
    read(options, 'confirmSandboxInProduction') !== true
  return refused ? 'confirmSandboxInProduction' : undefined
}

/**
 * A host that sets `allowSandbox` on the module and whose source declares what it admits must say
 * the same on both: the source alone decides, so a difference is a belief the library cannot
 * honour. A source that does not declare it, and a module that does not set the option, are never
 * compared.
 */
const sandboxAgreementRule: Rule = (options) => {
  const allowed = read(options, 'allowSandbox')
  const source = read(options, 'source')
  const admitted = isObject(source) ? Reflect.get(source, 'admitsSandbox') : undefined
  return isBoolean(allowed) && isBoolean(admitted) && allowed !== admitted
    ? 'allowSandbox'
    : undefined
}

/** The controller needs a route of its own: the library has no default path (D41). */
const controllerRouteRule: Rule = (options) =>
  read(options, 'webhookController') === true && !isWebhookRoute(read(options, 'webhookPath'))
    ? 'webhookPath'
    : undefined

/** The controller sits outside authentication, so it has no tenant to give (SEC08). */
const controllerTenantRule: Rule = (options) =>
  read(options, 'webhookController') === true && read(options, 'multiTenant') === true
    ? 'webhookController'
    : undefined

/** Every rule, in the order the offending options are reported. */
const RULES: readonly Rule[] = [
  required('source', isSource),
  required('store', (value) => hasMethods(value, STORE_METHODS)),
  required('accountResolver', (value) => typeof value === 'function'),
  optional('onChange', (value) => typeof value === 'function'),
  optional('failPolicy', (value) => FAIL_POLICIES.includes(value)),
  optional('lastKnownStateToleranceMs', isPositiveDuration),
  optional('maxSnapshotAgeMs', isPositiveDuration),
  optional('cacheTtlMs', isPositiveSafeInteger),
  optional('eventRetentionMs', isPositiveSafeInteger),
  optional('webhookDeadlineMs', isDeadline),
  optional('allowSandbox', isBoolean),
  optional('confirmSandboxInProduction', isBoolean),
  optional('isProduction', isBoolean),
  sandboxRule,
  sandboxAgreementRule,
  optional('webhookController', isBoolean),
  optional('webhookPath', isWebhookRoute),
  controllerRouteRule,
  optional('multiTenant', isBoolean),
  controllerTenantRule,
  optional('cache', (value) => hasMethods(value, CACHE_METHODS)),
  optional('observer', isObject),
  optional('logger', (value) => hasMethods(value, ['warn'])),
  optional('clock', (value) => hasMethods(value, ['now']))
]

/**
 * Checks the options against every rule and throws one `SubscriptionError` that names each
 * offending option, in the order of the first rule that refuses it and each once, even when two
 * rules refuse the same option. Nothing the host supplied is read into the error, and no function
 * the host supplied is called.
 *
 * @param input The options exactly as the host passed them.
 * @throws SubscriptionError with the invalid-configuration code and the offending option paths.
 */
export function validateOptions(input: unknown): asserts input is SubscriptionOptionsInput {
  const paths = isObject(input)
    ? [...new Set(RULES.map((rule) => rule(input)))].filter(
        (path): path is string => path !== undefined
      )
    : ['options']
  if (paths.length > 0) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID, { optionPaths: paths })
  }
}
