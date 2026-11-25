/**
 * @fileoverview Pins when `SubscriptionModule` mounts the webhook controller: never by default,
 * at the host's route when `forRoot` switches it on, at the route `forRootAsync` was given, and
 * with a boot error naming the option for every combination it refuses.
 * @layer core
 */
import type { FactoryProvider } from '@nestjs/common'

import { SUBSCRIPTION_OPTIONS, SubscriptionError } from '@bymax-one/nest-subscription/internal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore
} from '@bymax-one/nest-subscription/testing'

import type { SubscriptionOptionsInput } from './options/subscription-options.types'
import { SubscriptionModule } from './subscription.module'
import { SubscriptionWebhookController } from './webhook/webhook.controller'

function input(extra: Partial<SubscriptionOptionsInput> = {}): SubscriptionOptionsInput {
  return {
    source: new FakeSubscriptionSource(),
    store: new InMemorySubscriptionStore({ logger: () => undefined }),
    accountResolver: () => null,
    ...extra
  }
}

/** The options provider of a dynamic module. */
function optionsProvider(module: { providers?: unknown }): FactoryProvider {
  const all: unknown[] = Array.isArray(module.providers) ? module.providers : []
  const found = all.find(
    (candidate): candidate is FactoryProvider =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'provide' in candidate &&
      candidate.provide === SUBSCRIPTION_OPTIONS
  )
  if (found === undefined) throw new Error('no options provider')
  return found
}

/** The route a mounted controller class is registered at. */
function routeOf(controller: unknown): unknown {
  return typeof controller === 'function' ? Reflect.getMetadata('path', controller) : undefined
}

describe('SubscriptionModule.forRoot controller', () => {
  it('mounts no controller by default', () => {
    // Scenario: with the switch off no route is registered.
    expect(SubscriptionModule.forRoot(input()).controllers).toStrictEqual([])
  })

  it.each(['hooks/billing', 'a', '/leading', 'a/b/c.d'])(
    'mounts no controller for the route %s when the switch is off',
    (route) => {
      // Scenario: a route alone does not switch the controller on.
      const module = SubscriptionModule.forRoot(input({ webhookPath: route }))
      expect(module.controllers).toStrictEqual([])
    }
  )

  it('mounts one controller at the route when the switch is on', () => {
    // Scenario: the one POST route exists at the route the host chose.
    const module = SubscriptionModule.forRoot(
      input({ webhookController: true, webhookPath: 'hooks/billing' })
    )
    expect(module.controllers).toHaveLength(1)
    expect(routeOf(module.controllers?.[0])).toBe('hooks/billing')
    expect(Object.getPrototypeOf(module.controllers?.[0])).toBe(SubscriptionWebhookController)
  })

  it.each([
    ['no route', {}],
    ['a route that is not valid', { webhookPath: 'a b' }]
  ])('mounts nothing and refuses at boot, naming webhookPath, with %s', (_name, extra) => {
    // Scenario: the switch is on but there is no usable route; no class is mounted at a guess and
    // the option provider stops the boot.
    const module = SubscriptionModule.forRoot(input({ webhookController: true, ...extra }))
    expect(module.controllers).toStrictEqual([])
    expect(() => optionsProvider(module).useFactory()).toThrow(/Offending options: webhookPath\./)
  })

  it('refuses the controller in a multi-tenant host at boot, naming webhookController', () => {
    // Scenario: the controller has no authenticated tenant to give.
    const module = SubscriptionModule.forRoot(
      input({ webhookController: true, webhookPath: 'hooks', multiTenant: true })
    )
    expect(() => optionsProvider(module).useFactory()).toThrow(
      /Offending options: webhookController\./
    )
  })
})

describe('SubscriptionModule.forRootAsync controller', () => {
  it('mounts no controller without a route', () => {
    // Scenario: with no static route the switch stays off.
    const module = SubscriptionModule.forRootAsync({ useFactory: () => input() })
    expect(module.controllers).toStrictEqual([])
  })

  it('mounts the controller at the static route and switches it on in the resolved options', async () => {
    // Scenario: the route is known when the module is built; the factory need not repeat it.
    const module = SubscriptionModule.forRootAsync({
      webhookPath: 'hooks/billing',
      useFactory: () => input()
    })
    expect(routeOf(module.controllers?.[0])).toBe('hooks/billing')
    await expect(optionsProvider(module).useFactory()).resolves.toMatchObject({
      webhookController: true,
      webhookPath: 'hooks/billing'
    })
  })

  it('accepts a factory that also switches the controller on', async () => {
    // Scenario: the factory agrees with the static route.
    const module = SubscriptionModule.forRootAsync({
      webhookPath: 'hooks/billing',
      useFactory: () => input({ webhookController: true })
    })
    await expect(optionsProvider(module).useFactory()).resolves.toMatchObject({
      webhookController: true
    })
  })

  it('refuses at boot a factory that switches the controller off beside a route', async () => {
    // Scenario: a route exists in the module, so a factory that says off contradicts it.
    const module = SubscriptionModule.forRootAsync({
      webhookPath: 'hooks/billing',
      useFactory: () => input({ webhookController: false })
    })
    await expect(optionsProvider(module).useFactory()).rejects.toThrow(
      /Offending options: webhookController\./
    )
  })

  it('refuses at boot a factory that switches the controller on with no route', async () => {
    // Scenario: the factory cannot give the route, which NestJS needs before it runs.
    const module = SubscriptionModule.forRootAsync({
      useFactory: () => input({ webhookController: true })
    })
    await expect(optionsProvider(module).useFactory()).rejects.toThrow(
      /Offending options: webhookPath\./
    )
  })

  /** What a combination of a static route and a factory result comes to. */
  type Outcome = 'mounted' | 'no controller' | readonly string[]

  const COMBINATIONS: ReadonlyArray<
    readonly [string, string | undefined, Partial<SubscriptionOptionsInput>, Outcome]
  > = [
    ['no route, nothing set', undefined, {}, 'no controller'],
    ['no route, the switch off', undefined, { webhookController: false }, 'no controller'],
    ['no route, the switch on', undefined, { webhookController: true }, ['webhookPath']],
    ['no route, a path only', undefined, { webhookPath: 'hooks' }, ['webhookPath']],
    [
      'no route, the switch on and a path',
      undefined,
      { webhookController: true, webhookPath: 'hooks' },
      ['webhookPath']
    ],
    [
      'no route, the switch off and a path',
      undefined,
      { webhookController: false, webhookPath: 'hooks' },
      ['webhookPath']
    ],
    ['a route, nothing set', 'hooks', {}, 'mounted'],
    ['a route, the switch on', 'hooks', { webhookController: true }, 'mounted'],
    ['a route, the switch off', 'hooks', { webhookController: false }, ['webhookController']],
    ['a route, the same path', 'hooks', { webhookPath: 'hooks' }, 'mounted'],
    ['a route, another path', 'hooks', { webhookPath: 'other' }, ['webhookPath']],
    [
      'a route, the switch on and the same path',
      'hooks',
      { webhookController: true, webhookPath: 'hooks' },
      'mounted'
    ],
    [
      'a route, the switch on and another path',
      'hooks',
      { webhookController: true, webhookPath: 'other' },
      ['webhookPath']
    ],
    [
      'a route, the switch off and the same path',
      'hooks',
      { webhookController: false, webhookPath: 'hooks' },
      ['webhookController']
    ],
    [
      'a route, the switch off and another path',
      'hooks',
      { webhookController: false, webhookPath: 'other' },
      ['webhookController', 'webhookPath']
    ]
  ]

  it.each(COMBINATIONS)(
    'ends as the table says with %s',
    async (_name, route, factory, outcome) => {
      // Scenario: every combination of a static route, the factory's switch and the factory's path
      // ends in one of three ways: mounted at the static route, refused at boot naming the
      // options that contradict it (D43), or no controller. The route is fixed when the module is
      // built, so a route only a factory names can never be mounted and is refused, not ignored.
      const module = SubscriptionModule.forRootAsync({
        ...(route === undefined ? {} : { webhookPath: route }),
        useFactory: () => input(factory)
      })
      const resolving = optionsProvider(module).useFactory()
      if (typeof outcome !== 'string') {
        await expect(resolving).rejects.toMatchObject({ optionPaths: outcome })
        return
      }
      const resolved = await resolving
      expect(resolved.webhookController).toBe(outcome === 'mounted')
      expect(module.controllers).toHaveLength(outcome === 'mounted' ? 1 : 0)
      expect(routeOf(module.controllers?.[0])).toBe(outcome === 'mounted' ? route : undefined)
    }
  )

  it('refuses a static route that is not valid when the module is built', () => {
    // Scenario: the mistake stops the application where the module is declared.
    const build = (): unknown =>
      SubscriptionModule.forRootAsync({ webhookPath: 'a b', useFactory: () => input() })
    expect(build).toThrow(SubscriptionError)
    expect(build).toThrow(/Offending options: webhookPath\./)
  })

  it('leaves a factory result that is not an object to the options validation', async () => {
    // Scenario: the route is not merged into something that is not an options object.
    const module = SubscriptionModule.forRootAsync({
      webhookPath: 'hooks/billing',
      useFactory: () => null as never
    })
    await expect(optionsProvider(module).useFactory()).rejects.toThrow(
      /Offending options: options\./
    )
  })
})
