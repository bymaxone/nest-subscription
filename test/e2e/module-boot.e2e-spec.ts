/**
 * @fileoverview Module boot, end to end: a NestJS application boots with the fake source and the
 * in-memory store through `forRoot` and `forRootAsync`, a wrong configuration stops the boot with
 * one error that names every option and none of its values, and the library runs with its
 * optional peers absent.
 * @layer e2e
 */
import { Inject, Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import {
  SUBSCRIPTION_CACHE,
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OBSERVER,
  SUBSCRIPTION_OPTIONS,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_STORE,
  SubscriptionError,
  SubscriptionModule
} from '@bymax-one/nest-subscription'
import type {
  Clock,
  ResolvedSubscriptionOptions,
  SubscriptionOptionsInput
} from '@bymax-one/nest-subscription'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore
} from '@bymax-one/nest-subscription/testing'

import { credentialedSource } from './fixtures/credentialed-source'
import {
  expectNoSentinel,
  outputsOf,
  ROTATED_SENTINEL,
  WEBHOOK_SENTINEL
} from './fixtures/sentinel-sweep'

// An import of an optional peer fails loudly: a boot that passes proves the library never loads one.
jest.mock('@bymax-one/nest-cache', () => {
  throw new Error('@bymax-one/nest-cache must not be loaded')
})
jest.mock('@bymax-one/nest-core', () => {
  throw new Error('@bymax-one/nest-core must not be loaded')
})

const SENTINEL = 'sentinel-wrong-shape-9d3e55b0'
const HOST_STORE = Symbol('HOST_STORE')
const HOST_SETTINGS = Symbol('HOST_SETTINGS')

function good(): SubscriptionOptionsInput {
  return {
    source: new FakeSubscriptionSource(),
    store: new InMemorySubscriptionStore(),
    accountResolver: () => null
  }
}

@Module({
  providers: [{ provide: HOST_SETTINGS, useValue: { path: 'billing/webhook' } }],
  exports: [HOST_SETTINGS]
})
class SettingsModule {}

/** A provider of a module that imports nothing, injecting the source token. */
@Injectable()
class SiblingConsumer {
  constructor(@Inject(SUBSCRIPTION_SOURCE) readonly source: unknown) {}
}

@Module({ providers: [SiblingConsumer] })
class SiblingModule {}

async function boot(module: ReturnType<typeof SubscriptionModule.forRoot>): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [module] }).compile()
}

async function refusal(module: ReturnType<typeof SubscriptionModule.forRoot>): Promise<unknown> {
  try {
    await (await boot(module)).close()
  } catch (error) {
    return error
  }
  throw new Error('the application booted')
}

describe('module boot', () => {
  it('boots through forRoot and provides the four tokens with the host objects', async () => {
    // Scenario: the fake source and the in-memory store go in; the tokens give them back.
    const options = good()
    const clock = { now: () => new Date(0) }
    const app = await boot(SubscriptionModule.forRoot({ ...options, clock }))
    expect(app.get(SUBSCRIPTION_SOURCE)).toBe(options.source)
    expect(app.get(SUBSCRIPTION_STORE)).toBe(options.store)
    expect(app.get(SUBSCRIPTION_CLOCK)).toBe(clock)
    const resolved = app.get<ResolvedSubscriptionOptions>(SUBSCRIPTION_OPTIONS)
    expect(resolved.failPolicy).toBe('refuse')
    expect(() => app.get(SUBSCRIPTION_CACHE)).toThrow()
    expect(() => app.get(SUBSCRIPTION_OBSERVER)).toThrow()
    await app.close()
  })

  it('provides the system clock when the host passes none', async () => {
    // Scenario: no clock option; the token gives a clock that reads the current time.
    const app = await boot(SubscriptionModule.forRoot(good()))
    const before = Date.now()
    const now = app.get<Clock>(SUBSCRIPTION_CLOCK).now().getTime()
    expect(now).toBeGreaterThanOrEqual(before)
    expect(now).toBeLessThanOrEqual(Date.now())
    await app.close()
  })

  it('provides the cache and the observer when they are configured', async () => {
    // Scenario: a host cache and a host observer are passed in and come back under their tokens.
    const cache = { get: jest.fn(), set: jest.fn(), delete: jest.fn() }
    const observer = {}
    const app = await boot(SubscriptionModule.forRoot({ ...good(), cache, observer }))
    expect(app.get(SUBSCRIPTION_CACHE)).toBe(cache)
    expect(app.get(SUBSCRIPTION_OBSERVER)).toBe(observer)
    await app.close()
  })

  it('boots through forRoot with the store given as the token of a provider the host registers', async () => {
    // Scenario: the host provides the store under its own token and names the token.
    const store = new InMemorySubscriptionStore()
    @Module({ providers: [{ provide: HOST_STORE, useValue: store }], exports: [HOST_STORE] })
    class StoreModule {}
    const app = await boot(
      SubscriptionModule.forRoot({ ...good(), store: HOST_STORE, imports: [StoreModule] })
    )
    expect(app.get(SUBSCRIPTION_STORE)).toBe(store)
    await app.close()
  })

  it('boots through forRootAsync with a factory that injects a provider of an imported module', async () => {
    // Scenario: the factory reads the host's settings through `inject`.
    const app = await boot(
      SubscriptionModule.forRootAsync({
        imports: [SettingsModule],
        inject: [HOST_SETTINGS],
        useFactory: (settings: { path: string }) => ({
          ...good(),
          cacheTtlMs: settings.path.length
        })
      })
    )
    const resolved = app.get<ResolvedSubscriptionOptions>(SUBSCRIPTION_OPTIONS)
    expect(resolved.cacheTtlMs).toBe('billing/webhook'.length)
    expect(app.get(SUBSCRIPTION_CACHE)).toBeNull()
    expect(app.get(SUBSCRIPTION_OBSERVER)).toBeNull()
    await app.close()
  })

  it('gives a provider of a sibling module the configured source when the module is global', async () => {
    // Scenario: the factory returns a promise and the module is global, so a provider of a module
    // that imports nothing injects the source token and receives the instance the factory built.
    const options = good()
    const app = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRootAsync({
          global: true,
          useFactory: () => Promise.resolve(options)
        }),
        SiblingModule
      ]
    }).compile()
    expect(app.get(SiblingConsumer).source).toBe(options.source)
    await app.close()
  })

  it('refuses to inject the source into a sibling module when the module is not global', async () => {
    // Scenario: the same sibling cannot resolve the token without the module being global, so the
    // previous case passes because of `global` and not because tokens leak.
    const compiling = Test.createTestingModule({
      imports: [
        SubscriptionModule.forRootAsync({ useFactory: () => Promise.resolve(good()) }),
        SiblingModule
      ]
    }).compile()
    await expect(compiling).rejects.toThrow(/SiblingConsumer/)
  })

  it('boots with @bymax-one/nest-cache and @bymax-one/nest-core absent from the module graph', async () => {
    // Scenario: both peers throw if imported (see the mocks above); every boot of this file passes.
    expect(() => require('@bymax-one/nest-cache')).toThrow('must not be loaded')
    expect(() => require('@bymax-one/nest-core')).toThrow('must not be loaded')
    const app = await boot(SubscriptionModule.forRoot(good()))
    expect(app.get(SUBSCRIPTION_SOURCE)).toBeDefined()
    await app.close()
  })
})

/** One invalid value per branch of the rules; every row names the one option it breaks. */
const INVALID: readonly (readonly [string, Record<string, unknown>])[] = [
  ['source', { source: SENTINEL }],
  ['source', { source: { name: 1 } }],
  ['source', { source: { name: 'x', readAccount: SENTINEL } }],
  ['store', { store: { getSnapshot: SENTINEL } }],
  ['store', { store: undefined }],
  ['accountResolver', { accountResolver: SENTINEL }],
  ['onChange', { onChange: SENTINEL }],
  ['failPolicy', { failPolicy: SENTINEL }],
  ['lastKnownStateToleranceMs', { lastKnownStateToleranceMs: 0 }],
  ['lastKnownStateToleranceMs', { lastKnownStateToleranceMs: SENTINEL }],
  ['maxSnapshotAgeMs', { maxSnapshotAgeMs: -1 }],
  ['eventRetentionMs', { eventRetentionMs: Number.NaN }],
  ['cacheTtlMs', { cacheTtlMs: 1.5 }],
  ['allowSandbox', { allowSandbox: SENTINEL }],
  ['confirmSandboxInProduction', { confirmSandboxInProduction: SENTINEL }],
  ['isProduction', { isProduction: SENTINEL }],
  ['confirmSandboxInProduction', { allowSandbox: true, isProduction: true }],
  ['webhookController', { webhookController: SENTINEL }],
  ['webhookPath', { webhookPath: `${SENTINEL}?` }],
  ['webhookPath', { webhookPath: 7 }],
  ['multiTenant', { multiTenant: SENTINEL }],
  ['cache', { cache: SENTINEL }],
  ['cache', { cache: { get: () => 1 } }],
  ['observer', { observer: SENTINEL }],
  ['clock', { clock: { now: SENTINEL } }],
  ['clock', { clock: SENTINEL }]
]

describe('module boot refuses a wrong configuration', () => {
  it.each(INVALID)('forRoot names %s and none of its value', async (path, override) => {
    // Scenario: one rule is broken with a sentinel; the boot fails with the aggregated error.
    const error = await refusal(SubscriptionModule.forRoot({ ...good(), ...override } as never))
    expect(error).toBeInstanceOf(SubscriptionError)
    const printed = `${String(error)} ${JSON.stringify(error)}`
    expect(printed).toContain(path)
    expect(printed).not.toContain(SENTINEL)
  })

  it.each(INVALID)('forRootAsync names %s and none of its value', async (path, override) => {
    // Scenario: the same configurations returned by a factory fail the boot the same way.
    const error = await refusal(
      SubscriptionModule.forRootAsync({ useFactory: () => ({ ...good(), ...override }) as never })
    )
    expect(error).toBeInstanceOf(SubscriptionError)
    expect(String(error)).toContain(path)
    expect(String(error)).not.toContain(SENTINEL)
  })

  it('names the options as a whole when the factory returns something that is not an object', async () => {
    // Scenario: the factory returns a string.
    const error = await refusal(
      SubscriptionModule.forRootAsync({ useFactory: () => SENTINEL as never })
    )
    expect((error as SubscriptionError).optionPaths).toEqual(['options'])
    expect(String(error)).not.toContain(SENTINEL)
  })

  it('lists every offending option of one configuration in one error', async () => {
    // Scenario: three options are wrong at once.
    const error = await refusal(
      SubscriptionModule.forRoot({
        ...good(),
        source: SENTINEL,
        failPolicy: SENTINEL,
        multiTenant: SENTINEL
      } as never)
    )
    expect((error as SubscriptionError).optionPaths).toEqual([
      'source',
      'failPolicy',
      'multiTenant'
    ])
    expect((error as SubscriptionError).code).toBe('SUBSCRIPTION_CONFIG_INVALID')
  })

  it('stops the boot when sandbox access is enabled in production without the confirmation', async () => {
    // Scenario: SEC07, then the same configuration with the second option.
    const unconfirmed = { ...good(), allowSandbox: true, isProduction: true }
    const error = await refusal(SubscriptionModule.forRoot(unconfirmed))
    expect((error as SubscriptionError).optionPaths).toEqual(['confirmSandboxInProduction'])
    const app = await boot(
      SubscriptionModule.forRoot({ ...unconfirmed, confirmSandboxInProduction: true })
    )
    expect(app.get<ResolvedSubscriptionOptions>(SUBSCRIPTION_OPTIONS).allowSandbox).toBe(true)
    await app.close()
  })

  it.each([
    ['the module allows and the source does not', true, false],
    ['the module refuses and the source allows', false, true]
  ])('stops the boot of both forms when %s', async (_name, module, admits) => {
    // Scenario: allowSandbox set on the module disagrees with what the source declares.
    const source = Object.assign(new FakeSubscriptionSource(), { admitsSandbox: admits })
    const options = { ...good(), source, allowSandbox: module }
    for (const form of [
      SubscriptionModule.forRoot(options),
      SubscriptionModule.forRootAsync({ useFactory: () => options })
    ]) {
      const error = await refusal(form)
      expect((error as SubscriptionError).code).toBe('SUBSCRIPTION_CONFIG_INVALID')
      expect((error as SubscriptionError).optionPaths).toEqual(['allowSandbox'])
    }
  })

  it('boots both forms when the module and the source agree on sandbox access', async () => {
    // Scenario: the same value on both sides, and the module option left unset.
    const source = Object.assign(new FakeSubscriptionSource(), { admitsSandbox: true })
    for (const options of [
      { ...good(), source, allowSandbox: true },
      { ...good(), source }
    ]) {
      const app = await boot(SubscriptionModule.forRoot(options))
      await app.close()
      const asyncApp = await boot(SubscriptionModule.forRootAsync({ useFactory: () => options }))
      await asyncApp.close()
    }
  })

  it('names only the factory when it rejects, with the secret it raised absent', async () => {
    // Scenario: a factory fails with a message that holds a secret.
    const error = await refusal(
      SubscriptionModule.forRootAsync({
        useFactory: () => Promise.reject(new Error(`token=${SENTINEL}`))
      })
    )
    expect((error as SubscriptionError).optionPaths).toEqual(['useFactory'])
    expect(String(error)).not.toContain(SENTINEL)
  })
})

describe('secret containment across the module', () => {
  it('shows no secret on any path of the resolved options or of any provider', async () => {
    // Scenario: both forms boot with a source that holds a rotation pair in a Secret; every token
    // is swept, and the sweep of the source and of the options reaches the Secret (its placeholder
    // is printed), so finding no sentinel is not vacuous.
    const withSecret: SubscriptionOptionsInput = {
      ...good(),
      source: credentialedSource(),
      cache: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
      observer: {}
    }
    const modules = [
      SubscriptionModule.forRoot(withSecret),
      SubscriptionModule.forRootAsync({ useFactory: () => withSecret })
    ]
    for (const module of modules) {
      expectNoSentinel(outputsOf(module))
      const app = await boot(module)
      for (const token of [
        SUBSCRIPTION_OPTIONS,
        SUBSCRIPTION_SOURCE,
        SUBSCRIPTION_STORE,
        SUBSCRIPTION_CLOCK,
        SUBSCRIPTION_CACHE,
        SUBSCRIPTION_OBSERVER
      ]) {
        expectNoSentinel(outputsOf(app.get<object>(token)))
      }
      for (const token of [SUBSCRIPTION_OPTIONS, SUBSCRIPTION_SOURCE]) {
        expect(JSON.stringify(app.get<object>(token))).toContain('[Secret]')
      }
      const source = app.get<ReturnType<typeof credentialedSource>>(SUBSCRIPTION_SOURCE)
      expect(source.credential.candidates()).toEqual([WEBHOOK_SENTINEL, ROTATED_SENTINEL])
      await app.close()
    }
  })

  it('does not change the options object the host passed', async () => {
    // Scenario: the host's object and its source keep their descriptors across a boot.
    const options = { ...good(), source: credentialedSource() }
    const descriptors = Object.getOwnPropertyDescriptors(options)
    const sourceDescriptors = Object.getOwnPropertyDescriptors(options.source)
    const app = await boot(SubscriptionModule.forRoot(options))
    expect(Object.getOwnPropertyDescriptors(options)).toEqual(descriptors)
    expect(Object.getOwnPropertyDescriptors(options.source)).toEqual(sourceDescriptors)
    await app.close()
  })
})
