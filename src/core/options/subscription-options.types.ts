/**
 * @fileoverview The option types of the module: what the host fills in, what an asynchronous
 * factory returns and the frozen form the library reads. Types only.
 * @layer core
 */
import type { ExecutionContext, InjectionToken, ModuleMetadata } from '@nestjs/common'

import type {
  Clock,
  SubscriptionSource,
  SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import type { SubscriptionChange, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

/** What the fail policy does when a snapshot is missing or the store cannot be read. */
export type SubscriptionFailPolicy = 'refuse' | 'last_known_state'

/** The account a request belongs to, as the host's resolver names it. */
export interface ResolvedAccountOption {
  /** The account identifier. */
  readonly accountId: string
  /** The tenant of the account; absent when the host is not multi-tenant. */
  readonly tenantId?: string | undefined
}

/**
 * Gives the guard the account of a request. It returns `null` for a request that carries no
 * account, which the guard refuses as unauthenticated.
 */
export type AccountResolverOption = (
  context: ExecutionContext
) => ResolvedAccountOption | null | Promise<ResolvedAccountOption | null>

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

/** The optional observer the host provides to receive counters and timings. */
export type SubscriptionObserverOption = object

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
  readonly accountResolver: AccountResolverOption
  /** Told about every stored change. */
  readonly onChange?: SubscriptionChangeHook
  /** What to do when a snapshot is missing or the store is down. Defaults to `refuse`. */
  readonly failPolicy?: SubscriptionFailPolicy
  /**
   * How old a stored snapshot may be and still be trusted under `last_known_state`, in
   * milliseconds. Defaults to 24 hours.
   */
  readonly lastKnownStateToleranceMs?: number
  /** The age after which a snapshot is refreshed on its next read, in milliseconds. */
  readonly maxSnapshotAgeMs?: number
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
  readonly accountResolver: AccountResolverOption
  /** The change hook, or `null` when the host set none. */
  readonly onChange: SubscriptionChangeHook | null
  /** What to do when a snapshot is missing or the store is down. */
  readonly failPolicy: SubscriptionFailPolicy
  /** The tolerance of `last_known_state`, in milliseconds. */
  readonly lastKnownStateToleranceMs: number
  /** The age after which a snapshot is refreshed on its next read, in milliseconds. */
  readonly maxSnapshotAgeMs: number
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
