/**
 * @fileoverview The default time source: the system clock, behind the same port a test replaces.
 * @layer core
 */
import type { Clock } from '@bymax-one/nest-subscription/internal'

/** The clock the module uses when the host passes none. */
export const systemClock: Clock = Object.freeze({ now: () => new Date() })
