/**
 * @fileoverview The option types of the module: what the host fills in, what an asynchronous
 * factory returns and the frozen form the library reads. Types only.
 * @layer core
 */
import type { InjectionToken, ModuleMetadata } from '@nestjs/common'

import type {
  Clock,
  SubscriptionSource,
  SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import type { SubscriptionChange, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import type { AccountResolver } from '../guard/account-resolver.types'
import type { SubscriptionLogger } from '../logging/subscription-logger'
import type { SubscriptionObserver } from '../observer/observer.types'

/** What the guard does when it cannot show a snapshot current: refuse, or trust the last one. */
export type SubscriptionFailPolicy = 'refuse' | 'last_known_state'

/**
 * What the host's hook receives after a snapshot changed and was stored. Delivery is at least
 * once: the same change can reach the hook more than once, always with the same key, so the
 * host's reaction must be idempotent on `changes[].key`.
 */
export interface SubscriptionChangeNotification {
  /**
   * The snapshot before the change. It is `null` on a redelivery, which carries no previous state,
   * and on the first delivery for an account that had no stored snapshot.
   */
  readonly previous: SubscriptionSnapshot | null
  /** The snapshot after the change. */
  readonly current: SubscriptionSnapshot
  /** What changed, each with its stable key. */
  readonly changes: readonly SubscriptionChange[]
  /** Whether this is a repeated delivery of changes the host was already offered. */
  readonly redelivery: boolean
}

/** The hook the host supplies to be told about changes. */
export type SubscriptionChangeHook = (notification: SubscriptionChangeNotification) => unknown

/**
 * The cache the host may provide. It stores strings, so the library never depends on a cache
 * client: the host adapts whichever one it uses.
 */
export interface SubscriptionCache {
  /** Reads a value, or `null` when none is stored. */
  get(key: string): Promise<string | null>
  /** Stores a value for `ttlMs` milliseconds. */
  set(key: string, value: string, ttlMs: number): Promise<void>
  /** Removes a value; a key that is not stored is not an error. */
  delete(key: string): Promise<void>
}

/**
 * The options a host passes, with the store as an instance. This is what an asynchronous factory
 * returns and what `resolveOptions` reads.
 */
export interface SubscriptionOptionsInput {
  /** The billing source, as an adapter factory returns it. */
  readonly source: SubscriptionSource
  /** The persistence port. */
  readonly store: SubscriptionStore
  /** Tells the guard which account a request belongs to. */
  readonly accountResolver: AccountResolver
  /**
   * Told about every stored change, after the store write has succeeded and never before it.
   * Delivery is at least once. The changes are stored with the snapshot as not delivered and
   * cleared only after the hook returns, so a hook that throws or rejects leaves the stored
   * snapshot in place and its changes pending, and the next reconciliation run calls it again
   * with the same change keys and `redelivery: true`; a crash between the write and the call, or
   * a failure to clear after a successful call, has the same effect. A redelivery carries the
   * current snapshot and the pending changes and no previous snapshot. A hook that throws is
   * contained: the failure is logged by its error code and reported to the observer, and never
   * reaches the operation that stored the change. Make the reaction idempotent on the change key.
   * Without a hook no change is stored.
   */
  readonly onChange?: SubscriptionChangeHook
  /**
   * What the guard does when it cannot show the snapshot current: the store cannot be read, or the
   * stored snapshot is older than `maxSnapshotAgeMs` and the guard, which never waits for the
   * source, has not seen it refreshed. Defaults to `refuse`, which denies access. A store that
   * answers with no record is not a failure: the account has no subscription and the guard
   * refuses it as such under both values.
   *
   * `last_known_state` trusts such a snapshot while it is strictly younger than
   * `lastKnownStateToleranceMs`. That extends access during an outage, including to an account
   * whose subscription was refunded or cancelled during it, until the snapshot is refreshed or
   * ages past the tolerance. Choose it only where that exposure is acceptable.
   */
  readonly failPolicy?: SubscriptionFailPolicy
  /**
   * How old a stored snapshot may be and still be trusted under `last_known_state`, in
   * milliseconds; a snapshot aged exactly this is not trusted. It applies to a snapshot older than
   * `maxSnapshotAgeMs`: a younger one is current and needs no tolerance, so a tolerance not above
   * `maxSnapshotAgeMs` adds nothing over `refuse`. Defaults to 72 hours, three times the default
   * `maxSnapshotAgeMs`, so the policy extends access for two days past the point a snapshot goes
   * stale.
   */
  readonly lastKnownStateToleranceMs?: number
  /** The age after which a snapshot is refreshed on its next read, in milliseconds. */
  readonly maxSnapshotAgeMs?: number
  /**
   * How long an entry of the snapshot cache lives, in milliseconds, a positive safe integer.
   * Defaults to 30 000. It has no effect without a `cache`.
   */
  readonly cacheTtlMs?: number
  /** Whether sandbox purchases grant access. Defaults to `false`. */
  readonly allowSandbox?: boolean
  /** Confirms that sandbox access is meant in a production environment. Defaults to `false`. */
  readonly confirmSandboxInProduction?: boolean
  /** Whether this is a production environment. The library reads no environment variable. */
  readonly isProduction?: boolean
  /** The optional cache in front of the store. */
  readonly cache?: SubscriptionCache
  /** The optional observer. */
  readonly observer?: SubscriptionObserver
  /**
   * Where the library writes its warnings. Defaults to a NestJS `Logger`. A line holds a fixed
   * sentence and an error code, and never an account, a tenant or a payload.
   */
  readonly logger?: SubscriptionLogger
  /**
   * How long processed event identifiers are kept for de-duplication, in milliseconds, a positive
   * safe integer. Defaults to 7 days. Identifiers older than this are purged by each
   * reconciliation run; the library starts no timer for it. Keep it longer than the longest span
   * in which the source can deliver the same event again.
   */
  readonly eventRetentionMs?: number
  /**
   * How long the receiver works on one notification before it answers with a temporary failure,
   * in milliseconds, a positive finite number not above 60 000 (the time after which RevenueCat
   * drops the connection). Defaults to 30 000.
   */
  readonly webhookDeadlineMs?: number
  /**
   * Whether the library mounts its webhook controller. Defaults to `false`. It needs
   * `webhookPath` and cannot be combined with `multiTenant`.
   */
  readonly webhookController?: boolean
  /**
   * The route of the webhook controller, chosen entirely by the host; there is no default. It is
   * required when `webhookController` is `true`. `forRootAsync` takes it as a static option of
   * its own, because routes are registered before a factory runs.
   */
  readonly webhookPath?: string
  /** Whether the host serves several tenants. Defaults to `false`. */
  readonly multiTenant?: boolean
  /** The time source. Defaults to the system clock; a test passes its own. */
  readonly clock?: Clock
}

/** The options of `SubscriptionModule.forRoot`: the input, with the store also as a token. */
export interface SubscriptionModuleOptions extends Omit<SubscriptionOptionsInput, 'store'> {
  /** The persistence port, or the injection token under which the host provides one. */
  readonly store: SubscriptionStore | InjectionToken
  /** The modules that provide what the options name, such as the module that provides the store. */
  readonly imports?: ModuleMetadata['imports']
  /** Whether the module is global. Defaults to `false`. */
  readonly global?: boolean
}

/** The options of `SubscriptionModule.forRootAsync`. */
export interface SubscriptionModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /** Providers whose values are passed to the factory, in order. */
  readonly inject?: readonly InjectionToken[]
  /** Builds the options. A rejection or an invalid result fails the boot. */
  readonly useFactory: (
    ...args: never[]
  ) => SubscriptionOptionsInput | Promise<SubscriptionOptionsInput>
  /** Whether the module is global. Defaults to `false`. */
  readonly global?: boolean
  /**
   * The route of the webhook controller. NestJS registers routes before a factory runs, so the
   * route is given here and not in the factory's result. Its presence mounts the controller; a
   * factory that sets `webhookController: false` beside it is refused at boot.
   */
  readonly webhookPath?: string
}

/** The form the library reads: every default applied, frozen, and nothing else carried. */
export interface ResolvedSubscriptionOptions {
  /** The billing source. */
  readonly source: SubscriptionSource
  /** The persistence port. */
  readonly store: SubscriptionStore
  /** Tells the guard which account a request belongs to. */
  readonly accountResolver: AccountResolver
  /** The change hook, or `null` when the host set none. */
  readonly onChange: SubscriptionChangeHook | null
  /** What the guard does when it cannot show a snapshot current. */
  readonly failPolicy: SubscriptionFailPolicy
  /** The tolerance of `last_known_state`, in milliseconds. */
  readonly lastKnownStateToleranceMs: number
  /** The age after which a snapshot is refreshed on its next read, in milliseconds. */
  readonly maxSnapshotAgeMs: number
  /** The lifetime of an entry of the snapshot cache, in milliseconds. */
  readonly cacheTtlMs: number
  /** Whether sandbox purchases grant access. */
  readonly allowSandbox: boolean
  /** Whether sandbox access in production is confirmed. */
  readonly confirmSandboxInProduction: boolean
  /** Whether this is a production environment. */
  readonly isProduction: boolean
  /** The cache, or `null` when the host set none. */
  readonly cache: SubscriptionCache | null
  /** The observer, or `null` when the host set none. */
  readonly observer: SubscriptionObserver | null
  /** Where the library writes its warnings. */
  readonly logger: SubscriptionLogger
  /** How long processed event identifiers are kept, in milliseconds. */
  readonly eventRetentionMs: number
  /** How long the receiver works on one notification before answering, in milliseconds. */
  readonly webhookDeadlineMs: number
  /** Whether the webhook controller is mounted. */
  readonly webhookController: boolean
  /** The route of the webhook controller, or `null` when the host set none. */
  readonly webhookPath: string | null
  /** Whether the host serves several tenants. */
  readonly multiTenant: boolean
  /** The time source. */
  readonly clock: Clock
}
