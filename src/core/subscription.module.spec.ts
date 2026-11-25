/**
 * @fileoverview Pins the shape of the dynamic modules `SubscriptionModule` builds and runs each
 * provider factory directly, without booting an application: which tokens exist for which
 * configuration, what each provider injects, and what a failing factory raises.
 * @layer core
 */
import type { FactoryProvider } from '@nestjs/common'
import {
  SUBSCRIPTION_CACHE,
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OBSERVER,
  SUBSCRIPTION_OPTIONS,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_STORE,
  SubscriptionError
} from '@bymax-one/nest-subscription/internal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore
} from '@bymax-one/nest-subscription/testing'

import type { SubscriptionOptionsInput } from './options/subscription-options.types'
import { SnapshotRefresher } from './refresh/snapshot-refresher'
import { SubscriptionModule } from './subscription.module'
import { SubscriptionService } from './subscription.service'

const SENTINEL = 'sentinel-secret-0b8e6d14'
const STORE_TOKEN = Symbol('HOST_STORE')

function input(): SubscriptionOptionsInput {
  return {
    source: new FakeSubscriptionSource(),
    store: new InMemorySubscriptionStore(),
    accountResolver: () => null
  }
}

/** The token providers of a module; the library's own classes are listed apart. */
function providersOf(module: { providers?: unknown }): FactoryProvider[] {
  const all: unknown[] = Array.isArray(module.providers) ? module.providers : []
  return all.filter((candidate): candidate is FactoryProvider => typeof candidate === 'object')
}

function provider(module: { providers?: unknown }, token: symbol): FactoryProvider {
  const found = providersOf(module).find((candidate) => candidate.provide === token)
  if (found === undefined) throw new Error('no such provider')
  return found
}

describe('SubscriptionModule.forRoot', () => {
  it('provides the options, the source, the store and the clock under their symbol tokens', () => {
    // Scenario: a minimal configuration lists exactly the four tokens that always exist.
    const module = SubscriptionModule.forRoot(input())
    expect(providersOf(module).map((candidate) => candidate.provide)).toEqual([
      SUBSCRIPTION_OPTIONS,
      SUBSCRIPTION_SOURCE,
      SUBSCRIPTION_STORE,
      SUBSCRIPTION_CLOCK
    ])
    expect(module.exports).toEqual([
      SUBSCRIPTION_OPTIONS,
      SUBSCRIPTION_SOURCE,
      SUBSCRIPTION_STORE,
      SUBSCRIPTION_CLOCK,
      SubscriptionService
    ])
    expect(module.module).toBe(SubscriptionModule)
  })

  it('provides the refresher and the service as classes and exports the service only', () => {
    // Scenario: both classes are providers of the module; a host injects the service, and the
    // refresher stays inside the module.
    const module = SubscriptionModule.forRoot(input())
    expect(module.providers).toContain(SnapshotRefresher)
    expect(module.providers).toContain(SubscriptionService)
    expect(module.exports).toContain(SubscriptionService)
    expect(module.exports).not.toContain(SnapshotRefresher)
  })

  it('provides the cache and the observer only when they are configured', () => {
    // Scenario: with each configured, its token appears; without, it does not.
    const cache = { get: jest.fn(), set: jest.fn(), delete: jest.fn() }
    const both = SubscriptionModule.forRoot({ ...input(), cache, observer: {} })
    const tokens = providersOf(both).map((candidate) => candidate.provide)
    expect(tokens).toContain(SUBSCRIPTION_CACHE)
    expect(tokens).toContain(SUBSCRIPTION_OBSERVER)
    const onlyCache = providersOf(SubscriptionModule.forRoot({ ...input(), cache })).map(
      (candidate) => candidate.provide
    )
    expect(onlyCache).toContain(SUBSCRIPTION_CACHE)
    expect(onlyCache).not.toContain(SUBSCRIPTION_OBSERVER)
    const onlyObserver = providersOf(SubscriptionModule.forRoot({ ...input(), observer: {} })).map(
      (candidate) => candidate.provide
    )
    expect(onlyObserver).toContain(SUBSCRIPTION_OBSERVER)
    expect(onlyObserver).not.toContain(SUBSCRIPTION_CACHE)
  })

  it('hands out the configured cache and observer through their providers', () => {
    // Scenario: the providers return the host's own objects.
    const cache = { get: jest.fn(), set: jest.fn(), delete: jest.fn() }
    const observer = {}
    const module = SubscriptionModule.forRoot({ ...input(), cache, observer })
    const resolved = provider(module, SUBSCRIPTION_OPTIONS).useFactory()
    expect(provider(module, SUBSCRIPTION_CACHE).useFactory(resolved)).toBe(cache)
    expect(provider(module, SUBSCRIPTION_OBSERVER).useFactory(resolved)).toBe(observer)
  })

  it('lists the modules to import, and none by default', () => {
    // Scenario: the modules that provide the store token are carried over.
    const imports = [SubscriptionModule]
    expect(SubscriptionModule.forRoot({ ...input(), imports }).imports).toEqual(imports)
    expect(SubscriptionModule.forRoot(input()).imports).toEqual([])
  })

  it('is not global unless the host asks', () => {
    // Scenario: the default, then the explicit choice.
    expect(SubscriptionModule.forRoot(input()).global).toBe(false)
    expect(SubscriptionModule.forRoot({ ...input(), global: true }).global).toBe(true)
  })

  it('makes every derived provider explicit about what it injects', () => {
    // Scenario: each derived provider injects the options token and nothing implicit.
    const module = SubscriptionModule.forRoot(input())
    for (const token of [SUBSCRIPTION_SOURCE, SUBSCRIPTION_STORE, SUBSCRIPTION_CLOCK]) {
      expect(provider(module, token).inject).toEqual([SUBSCRIPTION_OPTIONS])
    }
    expect(provider(module, SUBSCRIPTION_OPTIONS).inject).toEqual([])
  })

  it('resolves the options once and derives the source, the store and the clock from them', () => {
    // Scenario: the options provider validates and resolves; the derived providers pick fields.
    const given = input()
    const clock = { now: () => new Date(0) }
    const module = SubscriptionModule.forRoot({ ...given, clock })
    const resolved = provider(module, SUBSCRIPTION_OPTIONS).useFactory()
    expect(provider(module, SUBSCRIPTION_SOURCE).useFactory(resolved)).toBe(given.source)
    expect(provider(module, SUBSCRIPTION_STORE).useFactory(resolved)).toBe(given.store)
    expect(provider(module, SUBSCRIPTION_CLOCK).useFactory(resolved)).toBe(clock)
  })

  it('injects the store from the token the host gives and resolves with the injected instance', () => {
    // Scenario: the store is a token; the options provider injects it and uses what it receives.
    const store = new InMemorySubscriptionStore()
    const module = SubscriptionModule.forRoot({ ...input(), store: STORE_TOKEN })
    const optionsProvider = provider(module, SUBSCRIPTION_OPTIONS)
    expect(optionsProvider.inject).toEqual([STORE_TOKEN])
    expect(optionsProvider.useFactory(store).store).toBe(store)
  })

  it.each([
    ['a string token', 'HOST_STORE'],
    ['a class token', class HostStore {}]
  ])('treats %s as a token to inject', (_name, token) => {
    // Scenario: every token form Nest accepts is injected rather than validated as an instance.
    const optionsProvider = provider(
      SubscriptionModule.forRoot({ ...input(), store: token }),
      SUBSCRIPTION_OPTIONS
    )
    expect(optionsProvider.inject).toEqual([token])
  })

  it('fails with the aggregated error when the options are invalid', () => {
    // Scenario: the options provider refuses a missing source and a sentinel in the wrong shape.
    const module = SubscriptionModule.forRoot({
      ...input(),
      source: undefined,
      webhookPath: SENTINEL + '?'
    } as never)
    expect(() => provider(module, SUBSCRIPTION_OPTIONS).useFactory()).toThrow(SubscriptionError)
    try {
      provider(module, SUBSCRIPTION_OPTIONS).useFactory()
    } catch (error) {
      expect(String(error)).toContain('Offending options: source, webhookPath.')
      expect(String(error)).not.toContain(SENTINEL)
    }
  })

  it('does not change the options object the host passed', () => {
    // Scenario: the host's object and its store are untouched after the factory ran.
    const options = Object.freeze({ ...input(), webhookPath: SENTINEL })
    const before = { ...options }
    provider(SubscriptionModule.forRoot(options), SUBSCRIPTION_OPTIONS).useFactory()
    expect({ ...options }).toEqual(before)
  })
})

describe('SubscriptionModule.forRootAsync', () => {
  it('lists the modules to import, what to inject and the global flag', () => {
    // Scenario: the structural parts of the async options are carried over.
    const imports = [SubscriptionModule]
    const module = SubscriptionModule.forRootAsync({
      imports,
      inject: ['A', 'B'],
      global: true,
      useFactory: input
    })
    expect(module.imports).toEqual(imports)
    expect(module.global).toBe(true)
    expect(provider(module, SUBSCRIPTION_OPTIONS).inject).toEqual(['A', 'B'])
  })

  it('defaults to no imports, no injection and a module that is not global', () => {
    // Scenario: only the factory is given.
    const module = SubscriptionModule.forRootAsync({ useFactory: input })
    expect(module.imports).toEqual([])
    expect(module.global).toBe(false)
    expect(provider(module, SUBSCRIPTION_OPTIONS).inject).toEqual([])
  })

  it('provides every token, the cache and the observer holding null when none is set', () => {
    // Scenario: the factory result is not known when the module is built, so all tokens exist.
    const module = SubscriptionModule.forRootAsync({ useFactory: input })
    expect(providersOf(module).map((candidate) => candidate.provide)).toEqual([
      SUBSCRIPTION_OPTIONS,
      SUBSCRIPTION_SOURCE,
      SUBSCRIPTION_STORE,
      SUBSCRIPTION_CLOCK,
      SUBSCRIPTION_CACHE,
      SUBSCRIPTION_OBSERVER
    ])
    expect(module.exports).toHaveLength(7)
  })

  it('hands the injected values to the factory and resolves what it returns', async () => {
    // Scenario: the factory receives the injected values in order and its result is resolved.
    const useFactory = jest.fn((first: string, second: string) => ({
      ...input(),
      webhookPath: `${first}/${second}`
    }))
    const module = SubscriptionModule.forRootAsync({ inject: ['a', 'b'], useFactory })
    const resolved = await provider(module, SUBSCRIPTION_OPTIONS).useFactory('a', 'b')
    expect(useFactory).toHaveBeenCalledWith('a', 'b')
    expect(resolved.webhookPath).toBe('a/b')
    const options = provider(module, SUBSCRIPTION_OPTIONS)
    const resolvedOptions = await options.useFactory()
    expect(provider(module, SUBSCRIPTION_CACHE).useFactory(resolvedOptions)).toBeNull()
    expect(provider(module, SUBSCRIPTION_OBSERVER).useFactory(resolvedOptions)).toBeNull()
  })

  it('accepts a factory that returns a promise', async () => {
    // Scenario: an asynchronous factory.
    const module = SubscriptionModule.forRootAsync({ useFactory: () => Promise.resolve(input()) })
    await expect(provider(module, SUBSCRIPTION_OPTIONS).useFactory()).resolves.toMatchObject({
      failPolicy: 'refuse'
    })
  })

  it('fails with the aggregated error when the factory returns invalid options', async () => {
    // Scenario: the factory returns a missing store and a sentinel in the wrong shape.
    const module = SubscriptionModule.forRootAsync({
      useFactory: () =>
        ({
          ...input(),
          store: undefined,
          webhookPath: `${SENTINEL}?`
        }) as never
    })
    const failure = provider(module, SUBSCRIPTION_OPTIONS).useFactory()
    await expect(failure).rejects.toThrow('Offending options: store, webhookPath.')
    await expect(failure).rejects.not.toThrow(SENTINEL)
  })

  it.each([
    ['rejects', () => Promise.reject(new Error(`password=${SENTINEL}`))],
    [
      'throws',
      () => {
        throw new Error(`password=${SENTINEL}`)
      }
    ]
  ])(
    'names only the factory when it %s and carries nothing it raised',
    async (_name, useFactory) => {
      // Scenario: the factory fails with a message holding a secret; the boot error shows none.
      const module = SubscriptionModule.forRootAsync({ useFactory })
      let caught: unknown
      try {
        await provider(module, SUBSCRIPTION_OPTIONS).useFactory()
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(SubscriptionError)
      expect(String(caught)).toContain('Offending options: useFactory.')
      expect(String(caught)).not.toContain(SENTINEL)
      expect(caught).not.toHaveProperty('cause')
    }
  )
})
