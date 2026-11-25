/**
 * @fileoverview Turns the options a host passed into the frozen form the library reads. The
 * resolved object is built field by field, so nothing the host added rides along and the host's
 * own object is never written to.
 * @layer core
 */
import { Logger } from '@nestjs/common'

import {
  DEFAULT_ALLOW_SANDBOX,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_EVENT_RETENTION_MS,
  DEFAULT_FAIL_POLICY,
  DEFAULT_LAST_KNOWN_STATE_TOLERANCE_MS,
  DEFAULT_MAX_SNAPSHOT_AGE_MS,
  DEFAULT_WEBHOOK_CONTROLLER,
  DEFAULT_WEBHOOK_DEADLINE_MS
} from './defaults'
import type {
  ResolvedSubscriptionOptions,
  SubscriptionOptionsInput
} from './subscription-options.types'
import { systemClock } from '../system-clock'
import { validateOptions } from './validate-options'

/** The context a default logger line is written under. */
const LOGGER_CONTEXT = 'NestSubscription'

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
 * Builds the frozen form field by field, so nothing the host added rides along and the host's own
 * object is never touched. The options hold no credential: an adapter's factory keeps its own in a
 * `Secret`, and the source reaches the module as that finished object.
 */
function build(input: SubscriptionOptionsInput): ResolvedSubscriptionOptions {
  return Object.freeze({
    source: input.source,
    store: input.store,
    accountResolver: input.accountResolver,
    onChange: input.onChange ?? null,
    failPolicy: input.failPolicy ?? DEFAULT_FAIL_POLICY,
    lastKnownStateToleranceMs:
      input.lastKnownStateToleranceMs ?? DEFAULT_LAST_KNOWN_STATE_TOLERANCE_MS,
    maxSnapshotAgeMs: input.maxSnapshotAgeMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS,
    cacheTtlMs: input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    allowSandbox: input.allowSandbox ?? DEFAULT_ALLOW_SANDBOX,
    confirmSandboxInProduction: input.confirmSandboxInProduction ?? false,
    isProduction: input.isProduction ?? false,
    cache: input.cache ?? null,
    observer: input.observer ?? null,
    logger: input.logger ?? new Logger(LOGGER_CONTEXT),
    eventRetentionMs: input.eventRetentionMs ?? DEFAULT_EVENT_RETENTION_MS,
    webhookDeadlineMs: input.webhookDeadlineMs ?? DEFAULT_WEBHOOK_DEADLINE_MS,
    webhookController: input.webhookController ?? DEFAULT_WEBHOOK_CONTROLLER,
    webhookPath: input.webhookPath ?? null,
    multiTenant: input.multiTenant ?? false,
    clock: input.clock ?? systemClock
  })
}
