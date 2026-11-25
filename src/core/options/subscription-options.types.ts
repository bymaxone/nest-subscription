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
import type {
  SubscriptionChange,
  SubscriptionErrorCode,
  SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import type { AccountResolver } from '../guard/account-resolver.types'

/** What the guard does when it cannot show a snapshot current: refuse, or trust the last one. */
export type SubscriptionFailPolicy = 'refuse' | 'last_known_state'

/** What the host's hook receives after a snapshot changed and was stored. */
export interface SubscriptionChangeNotification {
  /** The snapshot before the change; `null` on a redelivery, which carries no previous state. */
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

/** What the observer is told when a background refresh of a stale snapshot fails. */
export interface BackgroundRefreshFailure {
  /**
   * The code of the library error that ended the refresh, or `null` when the refresh ended with
   * an error that is not the library's, such as one a host's store raised. It never names the
   * account, and the error's text is not passed on.
   */
  readonly code: SubscriptionErrorCode | null
}

/** The optional observer the host provides to receive counters, timings and failures. */
export interface SubscriptionObserverOption {
  /**
   * Called when a refresh started in the background by a read of a stale snapshot fails. It may
   * return a promise; the library does not wait for it and ignores its rejection.
   */
  readonly onBackgroundRefreshFailure?: (failure: BackgroundRefreshFailure) => void | Promise<void>
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
  /** Told about every stored change. */
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
  readonly observer?: SubscriptionObserverOption
  /** How long processed event identifiers are kept, in milliseconds. */
  readonly eventRetentionMs?: number
  /** Whether the library mounts its webhook controller. Defaults to `false`. */
  readonly webhookController?: boolean
  /** The route of the webhook controller. */
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
  readonly observer: SubscriptionObserverOption | null
  /** How long processed event identifiers are kept, or `null` when the host set none. */
  readonly eventRetentionMs: number | null
  /** Whether the webhook controller is mounted. */
  readonly webhookController: boolean
  /** The route of the webhook controller, or `null` when the host set none. */
  readonly webhookPath: string | null
  /** Whether the host serves several tenants. */
  readonly multiTenant: boolean
  /** The time source. */
  readonly clock: Clock
}
