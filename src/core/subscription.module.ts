/**
 * @fileoverview The NestJS module. It resolves and validates the options once, when the
 * application boots, and provides the options, the source, the store and the clock, plus the cache
 * and the observer, each under its symbol token. An optional integration is
 * something the host passes in: the module imports no optional peer at run time.
 * @layer core
 */
import { Module } from '@nestjs/common'
import type { DynamicModule, FactoryProvider, InjectionToken, Type } from '@nestjs/common'

import {
  SUBSCRIPTION_CACHE,
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OBSERVER,
  SUBSCRIPTION_OPTIONS,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_STORE,
  SubscriptionError
} from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { SnapshotCache } from './cache/snapshot-cache'
import { EntitlementGuard } from './guard/entitlement.guard'
import { ChangeDispatcher } from './notifications/change-dispatcher'
import { ObserverBridge } from './observer/observer-bridge'
import { resolveOptions } from './options/resolve-options'
import type {
  ResolvedSubscriptionOptions,
  SubscriptionModuleAsyncOptions,
  SubscriptionCache,
  SubscriptionModuleOptions
} from './options/subscription-options.types'
import { Reconciler } from './reconciliation/reconciler'
import { SnapshotRefresher } from './refresh/snapshot-refresher'
import { SubscriptionService } from './subscription.service'

/** The path `forRootAsync` names when its factory rejects; the factory's own error is dropped. */
const FACTORY_PATH = 'useFactory'

/** A provider that hands out one field of the resolved options under its own token. */
function derived(
  provide: symbol,
  pick: (options: ResolvedSubscriptionOptions) => unknown
): FactoryProvider {
  return { provide, useFactory: pick, inject: [SUBSCRIPTION_OPTIONS] }
}

/** The providers every configuration has. */
function baseProviders(): FactoryProvider[] {
  return [
    derived(SUBSCRIPTION_SOURCE, (options) => options.source),
    derived(SUBSCRIPTION_STORE, (options) => options.store),
    derived(SUBSCRIPTION_CLOCK, (options) => options.clock)
  ]
}

/** Whether a value passed as the store is an injection token rather than a store instance. */
function isToken(value: unknown): value is InjectionToken {
  return typeof value === 'string' || typeof value === 'symbol' || typeof value === 'function'
}

/**
 * Runs the host's factory. A rejection or a throw becomes a configuration error that names the
 * factory and nothing more, because what the factory raised may hold a connection string or a key.
 */
async function runFactory(
  factory: SubscriptionModuleAsyncOptions['useFactory'],
  args: readonly unknown[]
): Promise<unknown> {
  try {
    return await Reflect.apply(factory, undefined, args)
  } catch {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID, {
      optionPaths: [FACTORY_PATH]
    })
  }
}

/**
 * The classes the library provides for itself. They are built from the tokens above, so they
 * follow whichever configuration the host chose.
 */
const OWN_CLASSES: readonly Type[] = [
  SnapshotRefresher,
  Reconciler,
  SubscriptionService,
  EntitlementGuard
]

/**
 * The snapshot cache: built over the host's cache when there is one, and `null` when there is not,
 * so the read path carries no cache code for a host that configured none.
 */
const SNAPSHOT_CACHE_PROVIDER: FactoryProvider = {
  provide: SnapshotCache,
  useFactory: (
    cache: SubscriptionCache | null | undefined,
    options: ResolvedSubscriptionOptions,
    bridge: ObserverBridge
  ): SnapshotCache | null => {
    const host = cache ?? null
    return host === null ? null : new SnapshotCache(host, options.cacheTtlMs, options.clock, bridge)
  },
  inject: [{ token: SUBSCRIPTION_CACHE, optional: true }, SUBSCRIPTION_OPTIONS, ObserverBridge]
}

/** The bridge to the host's observer; a no-op when the host set none. */
const OBSERVER_BRIDGE_PROVIDER: FactoryProvider = {
  provide: ObserverBridge,
  useFactory: (options: ResolvedSubscriptionOptions): ObserverBridge =>
    new ObserverBridge(options.observer, options.clock),
  inject: [SUBSCRIPTION_OPTIONS]
}

/**
 * The change dispatcher: built when the host set a hook, and `null` when it did not, so a host
 * without a hook stores no change and runs no delivery code.
 */
const CHANGE_DISPATCHER_PROVIDER: FactoryProvider = {
  provide: ChangeDispatcher,
  useFactory: (
    options: ResolvedSubscriptionOptions,
    bridge: ObserverBridge
  ): ChangeDispatcher | null =>
    options.onChange === null
      ? null
      : new ChangeDispatcher(options.onChange, options.store, options.logger, bridge),
  inject: [SUBSCRIPTION_OPTIONS, ObserverBridge]
}

/**
 * Puts the pieces together as a dynamic module; every token provider it lists is exported, and
 * so are the service and the guard. The refresher is provided for the library's own use and is not exported.
 */
function assemble(
  global: boolean | undefined,
  imports: DynamicModule['imports'],
  providers: FactoryProvider[]
): DynamicModule {
  return {
    module: SubscriptionModule,
    global: global ?? false,
    imports: imports ?? [],
    providers: [
      ...providers,
      SNAPSHOT_CACHE_PROVIDER,
      OBSERVER_BRIDGE_PROVIDER,
      CHANGE_DISPATCHER_PROVIDER,
      ...OWN_CLASSES
    ],
    exports: [
      ...providers.map((provider) => provider.provide),
      SubscriptionService,
      EntitlementGuard
    ]
  }
}

/**
 * Configures the library once. `forRoot` takes the options; `forRootAsync` takes a factory, so the
 * options can come from the host's own configuration. Either way an invalid configuration stops
 * the boot with one `SubscriptionError` that names every offending option and none of its values.
 */
@Module({})
export class SubscriptionModule {
  /**
   * Configures the module with options known when the module is built. The store may be an
   * instance or the injection token of a provider the host registers.
   *
   * @param options The module options.
   * @returns The dynamic module.
   */
  static forRoot(options: SubscriptionModuleOptions): DynamicModule {
    const tokenStore = isToken(options.store)
    const optionsProvider: FactoryProvider = {
      provide: SUBSCRIPTION_OPTIONS,
      useFactory: (injectedStore?: unknown): ResolvedSubscriptionOptions =>
        resolveOptions({ ...options, store: tokenStore ? injectedStore : options.store }),
      inject: tokenStore ? [options.store] : []
    }
    const optional: FactoryProvider[] = []
    if (options.cache !== undefined) optional.push(derived(SUBSCRIPTION_CACHE, (o) => o.cache))
    if (options.observer !== undefined) {
      optional.push(derived(SUBSCRIPTION_OBSERVER, (o) => o.observer))
    }
    return assemble(options.global, options.imports, [
      optionsProvider,
      ...baseProviders(),
      ...optional
    ])
  }

  /**
   * Configures the module from a factory. The cache and the observer cannot be known before the
   * factory runs, so both tokens are always provided here, holding `null` when the host set none.
   *
   * @param options The factory, what it injects, the modules it needs and whether the module is
   *   global.
   * @returns The dynamic module.
   */
  static forRootAsync(options: SubscriptionModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider = {
      provide: SUBSCRIPTION_OPTIONS,
      useFactory: async (...args: unknown[]): Promise<ResolvedSubscriptionOptions> =>
        resolveOptions(await runFactory(options.useFactory, args)),
      inject: [...(options.inject ?? [])]
    }
    const providers = [
      optionsProvider,
      ...baseProviders(),
      derived(SUBSCRIPTION_CACHE, (o) => o.cache),
      derived(SUBSCRIPTION_OBSERVER, (o) => o.observer)
    ]
    return assemble(options.global, options.imports, providers)
  }
}
