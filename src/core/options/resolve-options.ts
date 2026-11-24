/**
 * @fileoverview Turns the options a host passed into the frozen form the library reads. The
 * resolved object is built field by field, so nothing the host added rides along and the host's
 * own object is never written to.
 * @layer core
 */
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

/**
 * Applies every default and returns the frozen options. The host's instances (source, store,
 * cache, observer, clock) are carried by reference and left as they are.
 *
 * @param input The options as the host passed them.
 * @returns The resolved options.
 */
export function resolveOptions(input: SubscriptionOptionsInput): ResolvedSubscriptionOptions {
  return Object.freeze({
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
    clock: input.clock ?? systemClock
  })
}
