/**
 * @fileoverview Turns the options a host passed into the frozen form the library reads. The
 * resolved object is built field by field, so nothing the host added rides along and the host's
 * own object is never written to.
 * @layer core
 */
import { Secret } from '@bymax-one/nest-subscription/internal'

import {
  DEFAULT_ALLOW_SANDBOX,
  DEFAULT_FAIL_POLICY,
  DEFAULT_LAST_KNOWN_STATE_TOLERANCE_MS,
  DEFAULT_MAX_SNAPSHOT_AGE_MS,
  DEFAULT_WEBHOOK_CONTROLLER
} from './defaults'
import type {
  ResolvedSubscriptionOptions,
  SubscriptionOptionsInput
} from './subscription-options.types'
import { systemClock } from '../system-clock'
import { validateOptions } from './validate-options'

/**
 * Validates the options, applies every default and returns the frozen options. The host's
 * instances (source, store, cache, observer, clock) are carried by reference and left as they are.
 *
 * @param candidate The options as the host passed them, checked before anything is read from them.
 * @returns The resolved options.
 * @throws SubscriptionError listing every offending option when the options are invalid.
 */
export function resolveOptions(candidate: unknown): ResolvedSubscriptionOptions {
  validateOptions(candidate)
  return build(candidate)
}

/**
 * Builds the frozen form field by field, so nothing the host added rides along. The webhook secret
 * is wrapped here, once, and is exposed only through an accessor made non-enumerable on the new
 * object: the host's own object is never touched.
 */
function build(input: SubscriptionOptionsInput): ResolvedSubscriptionOptions {
  const webhookSecret = input.webhookSecret === undefined ? null : Secret.from(input.webhookSecret)
  const resolved: ResolvedSubscriptionOptions = {
    source: input.source,
    store: input.store,
    accountResolver: input.accountResolver,
    onChange: input.onChange ?? null,
    failPolicy: input.failPolicy ?? DEFAULT_FAIL_POLICY,
    lastKnownStateToleranceMs:
      input.lastKnownStateToleranceMs ?? DEFAULT_LAST_KNOWN_STATE_TOLERANCE_MS,
    maxSnapshotAgeMs: input.maxSnapshotAgeMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS,
    allowSandbox: input.allowSandbox ?? DEFAULT_ALLOW_SANDBOX,
    confirmSandboxInProduction: input.confirmSandboxInProduction ?? false,
    isProduction: input.isProduction ?? false,
    cache: input.cache ?? null,
    observer: input.observer ?? null,
    eventRetentionMs: input.eventRetentionMs ?? null,
    webhookController: input.webhookController ?? DEFAULT_WEBHOOK_CONTROLLER,
    webhookPath: input.webhookPath ?? null,
    multiTenant: input.multiTenant ?? false,
    clock: input.clock ?? systemClock,
    get webhookSecret(): Secret | null {
      return webhookSecret
    }
  }
  Object.defineProperty(resolved, 'webhookSecret', { enumerable: false })
  return Object.freeze(resolved)
}
