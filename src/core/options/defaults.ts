/**
 * @fileoverview The default of every option the specification fixes, each with its source.
 * @layer core
 */

/** One hour in milliseconds, the unit the 24-hour defaults are written in. */
const HOUR_MS = 3_600_000

/** The fail policy when none is set: refuse access (SEC04). */
export const DEFAULT_FAIL_POLICY = 'refuse'

/** How long a stored snapshot is trusted under `last_known_state`: 24 hours (D12, FR31). */
export const DEFAULT_LAST_KNOWN_STATE_TOLERANCE_MS = 24 * HOUR_MS

/** The age after which a snapshot is refreshed on its next read: 24 hours (D12, FR25). */
export const DEFAULT_MAX_SNAPSHOT_AGE_MS = 24 * HOUR_MS

/** How long an entry of the snapshot cache lives when none is set: 30 seconds (D34, FR23). */
export const DEFAULT_CACHE_TTL_MS = 30_000

/** Whether sandbox purchases grant access when none is set: they do not (SEC07, FR13). */
export const DEFAULT_ALLOW_SANDBOX = false

/** Whether the webhook controller is mounted when none is set: it is not (D10, FR17). */
export const DEFAULT_WEBHOOK_CONTROLLER = false
