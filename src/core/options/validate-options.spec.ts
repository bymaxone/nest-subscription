/**
 * @fileoverview Pins `validateOptions`: one table row per rule with valid and invalid values, the
 * aggregation of several problems into one error, the sandbox-in-production refusal, and that no
 * supplied value ever reaches the error.
 * @layer core
 */
import { inspect } from 'node:util'

import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore
} from '@bymax-one/nest-subscription/testing'
import { validateOptions } from './validate-options'

const SENTINEL = 'sentinel-value-7f3a91c2'

function valid(): Record<string, unknown> {
  return {
    source: new FakeSubscriptionSource(),
    store: new InMemorySubscriptionStore(),
    accountResolver: () => null
  }
}

function problems(options: unknown): SubscriptionError {
  try {
    validateOptions(options)
  } catch (error) {
    if (error instanceof SubscriptionError) return error
    throw error
  }
  throw new Error('the options were accepted')
}

/** A source that has every method of the port except one. */
function sourceWithout(method: string): Record<string, unknown> {
  const source: Record<string, unknown> = {
    name: 'x',
    readAccount: () => undefined,
    verifyWebhook: () => undefined,
    capabilities: () => undefined,
    stopRenewal: () => undefined
  }
  delete source[method]
  return source
}

/** A store that has every method of the port except one. */
function storeWithout(method: string): Record<string, unknown> {
  const store: Record<string, unknown> = {}
  for (const name of [
    'getSnapshot',
    'putSnapshot',
    'clearPendingChanges',
    'listKeysWithPendingChanges',
    'markEventProcessed',
    'forgetEvent',
    'deleteEventsOlderThan',
    'listStaleKeys'
  ]) {
    store[name] = () => undefined
  }
  delete store[method]
  return store
}

interface Row {
  readonly path: string
  readonly good: Record<string, unknown>
  readonly bad: readonly unknown[]
}

const ROWS: readonly Row[] = [
  {
    path: 'source',
    good: {},
    bad: [
      undefined,
      null,
      SENTINEL,
      { name: SENTINEL },
      sourceWithout('name'),
      sourceWithout('readAccount'),
      sourceWithout('verifyWebhook'),
      sourceWithout('capabilities'),
      sourceWithout('stopRenewal'),
      { ...sourceWithout('name'), name: 42 }
    ]
  },
  {
    path: 'store',
    good: {},
    bad: [
      undefined,
      SENTINEL,
      Symbol(SENTINEL),
      { getSnapshot: SENTINEL },
      storeWithout('getSnapshot'),
      storeWithout('putSnapshot'),
      storeWithout('clearPendingChanges'),
      storeWithout('listKeysWithPendingChanges'),
      storeWithout('markEventProcessed'),
      storeWithout('forgetEvent'),
      storeWithout('deleteEventsOlderThan'),
      storeWithout('listStaleKeys')
    ]
  },
  { path: 'accountResolver', good: {}, bad: [undefined, SENTINEL, { resolve: SENTINEL }] },
  { path: 'onChange', good: { onChange: () => undefined }, bad: [SENTINEL, null, {}] },
  {
    path: 'failPolicy',
    good: { failPolicy: 'last_known_state' },
    bad: [SENTINEL, null, 1, 'Refuse']
  },
  {
    path: 'lastKnownStateToleranceMs',
    good: { lastKnownStateToleranceMs: 1 },
    bad: [SENTINEL, null, -1, 0, Number.NaN, Number.POSITIVE_INFINITY]
  },
  {
    path: 'maxSnapshotAgeMs',
    good: { maxSnapshotAgeMs: 1 },
    bad: [SENTINEL, null, -1, 0, Number.NaN, Number.POSITIVE_INFINITY]
  },
  {
    path: 'cacheTtlMs',
    good: { cacheTtlMs: 1 },
    bad: [
      SENTINEL,
      null,
      -1,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1
    ]
  },
  {
    path: 'eventRetentionMs',
    good: { eventRetentionMs: 1 },
    bad: [
      SENTINEL,
      null,
      -1,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1
    ]
  },
  {
    path: 'webhookDeadlineMs',
    good: { webhookDeadlineMs: 60_000 },
    bad: [SENTINEL, null, -1, 0, 60_001, Number.NaN, Number.POSITIVE_INFINITY]
  },
  { path: 'allowSandbox', good: { allowSandbox: true }, bad: [SENTINEL, null, 1, 'true'] },
  {
    path: 'confirmSandboxInProduction',
    good: { confirmSandboxInProduction: true },
    bad: [SENTINEL, null, 1]
  },
  { path: 'isProduction', good: { isProduction: true }, bad: [SENTINEL, null, 0] },
  {
    path: 'webhookController',
    good: { webhookController: true, webhookPath: 'hooks/billing' },
    bad: [SENTINEL, null, 'on']
  },
  { path: 'multiTenant', good: { multiTenant: true }, bad: [SENTINEL, null, 'yes'] },
  {
    path: 'webhookPath',
    good: { webhookPath: 'billing/webhook' },
    bad: [SENTINEL + ' x', '', null, 5, 'a b', 'a?b', 'a#b', '/', '//']
  },
  {
    path: 'cache',
    good: { cache: { get: () => 1, set: () => 1, delete: () => 1 } },
    bad: [
      SENTINEL,
      null,
      { get: () => 1, set: () => 1 },
      { get: () => 1, delete: () => 1 },
      { set: () => 1, delete: () => 1 },
      { get: SENTINEL, set: SENTINEL, delete: SENTINEL }
    ]
  },
  { path: 'observer', good: { observer: {} }, bad: [SENTINEL, null, 3] },
  {
    path: 'logger',
    good: { logger: { warn: () => 1 } },
    bad: [SENTINEL, null, {}, { warn: SENTINEL }]
  },
  {
    path: 'clock',
    good: { clock: { now: () => new Date(0) } },
    bad: [SENTINEL, null, {}, { now: SENTINEL }]
  }
]

describe('validateOptions', () => {
  it('accepts the three required options alone', () => {
    // Scenario: a source, a store and a resolver are all a host has to pass.
    expect(() => validateOptions(valid())).not.toThrow()
  })

  it('ignores a key that is not an option, so an unknown key is neither accepted nor refused', () => {
    // Scenario: keys the validator has no rule for do not stop the boot and are never named.
    expect(() => validateOptions({ ...valid(), signingSecret: SENTINEL, extra: 1 })).not.toThrow()
  })

  it.each(ROWS)('accepts a valid $path', ({ good }) => {
    // Scenario: the row's valid value is added to the minimal options.
    expect(() => validateOptions({ ...valid(), ...good })).not.toThrow()
  })

  describe.each(ROWS)('the rule for $path', ({ path, bad }) => {
    it.each(bad.map((value, index) => [index, value] as const))(
      'refuses invalid value #%i and names only this option',
      (_index, value) => {
        // Scenario: the option is set to a value the rule refuses; the error names this option
        // and no other.
        const options = { ...valid(), [path]: value }
        if (value === undefined) delete options[path]
        const error = problems(options)
        expect(error.code).toBe('SUBSCRIPTION_CONFIG_INVALID')
        expect(error.optionPaths).toEqual([path])
        expect(error.message).toContain(path)
      }
    )
  })

  it.each([undefined, null, SENTINEL, 7, Symbol(SENTINEL)])(
    'refuses options that are not an object (%s)',
    (value) => {
      // Scenario: the whole options value has the wrong type; the error names the options as such.
      const error = problems(value)
      expect(error.optionPaths).toEqual(['options'])
    }
  )

  it('names every offending option once, in a stable order', () => {
    // Scenario: five rules fail at once; the order is the order of the rules, not of the input.
    const error = problems({
      multiTenant: SENTINEL,
      clock: SENTINEL,
      accountResolver: SENTINEL,
      store: SENTINEL,
      source: SENTINEL
    })
    expect(error.optionPaths).toEqual([
      'source',
      'store',
      'accountResolver',
      'multiTenant',
      'clock'
    ])
    expect(error.message).toBe(
      'An option is invalid. Offending options: source, store, accountResolver, multiTenant, clock.'
    )
  })

  it('refuses the last-known-state policy with a tolerance that is not positive', () => {
    // Scenario: the policy is last known state and the tolerance is zero or negative.
    for (const tolerance of [0, -5]) {
      const error = problems({
        ...valid(),
        failPolicy: 'last_known_state',
        lastKnownStateToleranceMs: tolerance
      })
      expect(error.optionPaths).toEqual(['lastKnownStateToleranceMs'])
    }
  })

  it('refuses a negative tolerance under the refuse policy too', () => {
    // Scenario: a negative duration is refused whatever the policy.
    const error = problems({ ...valid(), failPolicy: 'refuse', lastKnownStateToleranceMs: -1 })
    expect(error.optionPaths).toEqual(['lastKnownStateToleranceMs'])
  })

  describe('sandbox access in production (SEC07)', () => {
    it('refuses it without the confirming option', () => {
      // Scenario: sandbox is allowed in an environment the host says is production.
      const error = problems({ ...valid(), allowSandbox: true, isProduction: true })
      expect(error.optionPaths).toEqual(['confirmSandboxInProduction'])
    })

    it('refuses it when the confirming option is false', () => {
      // Scenario: the confirming option is present but not true.
      const error = problems({
        ...valid(),
        allowSandbox: true,
        isProduction: true,
        confirmSandboxInProduction: false
      })
      expect(error.optionPaths).toEqual(['confirmSandboxInProduction'])
    })

    it('names the confirming option once when it is not a boolean', () => {
      // Scenario: the per-option shape rule and the sandbox rule both refuse the same option.
      const error = problems({
        ...valid(),
        allowSandbox: true,
        isProduction: true,
        confirmSandboxInProduction: 'yes'
      })
      expect(new Set(error.optionPaths).size).toBe(error.optionPaths.length)
      expect(error.optionPaths).toEqual(['confirmSandboxInProduction'])
      expect(error.message).toBe(
        'An option is invalid. Offending options: confirmSandboxInProduction.'
      )
    })

    it('accepts it with the confirming option', () => {
      // Scenario: the host confirms the combination explicitly.
      expect(() =>
        validateOptions({
          ...valid(),
          allowSandbox: true,
          isProduction: true,
          confirmSandboxInProduction: true
        })
      ).not.toThrow()
    })

    it.each([
      ['outside production', { allowSandbox: true, isProduction: false }],
      ['with sandbox access off', { allowSandbox: false, isProduction: true }],
      ['with neither set', {}]
    ])('accepts sandbox access %s without the confirming option', (_name, extra) => {
      // Scenario: only the combination of sandbox access and production needs the confirmation.
      expect(() => validateOptions({ ...valid(), ...extra })).not.toThrow()
    })
  })

  describe('agreement on sandbox access with the source', () => {
    /** A source that declares what it admits, as the RevenueCat adapter does. */
    const declaring = (admitsSandbox: unknown): Record<string, unknown> => ({
      ...valid(),
      source: Object.assign(new FakeSubscriptionSource(), { admitsSandbox })
    })

    it.each([
      ['the module allows and the source does not', true, false],
      ['the module refuses and the source allows', false, true]
    ])('refuses it when %s, naming allowSandbox and no value', (_name, module, admits) => {
      // Scenario: the host set the module option and the source says the opposite.
      const error = problems({ ...declaring(admits), allowSandbox: module })
      expect(error.optionPaths).toEqual(['allowSandbox'])
      expect(error.message).toBe('An option is invalid. Offending options: allowSandbox.')
      expect(String(error)).not.toMatch(/true|false/)
    })

    it.each([true, false])('accepts equal values (%s)', (value) => {
      // Scenario: the module and the source say the same.
      expect(() => validateOptions({ ...declaring(value), allowSandbox: value })).not.toThrow()
    })

    it.each([true, false])(
      'accepts a module that sets nothing beside a source that admits %s',
      (value) => {
        // Scenario: the README tells a host to set the option on the adapter alone.
        expect(() => validateOptions(declaring(value))).not.toThrow()
      }
    )

    it.each([true, false])(
      'accepts a source that declares nothing beside allowSandbox %s',
      (value) => {
        // Scenario: a custom source is never compared.
        expect(() => validateOptions({ ...valid(), allowSandbox: value })).not.toThrow()
      }
    )

    it('does not compare a declaration that is not a boolean', () => {
      // Scenario: only a boolean is a declaration.
      expect(() => validateOptions({ ...declaring('yes'), allowSandbox: true })).not.toThrow()
    })

    it('names allowSandbox once when its own shape is also wrong', () => {
      // Scenario: the shape rule and the agreement rule both refuse the same option.
      const error = problems({ ...declaring(true), allowSandbox: 'true' })
      expect(error.optionPaths).toEqual(['allowSandbox'])
    })
  })

  describe('the controller switch', () => {
    it.each([
      ['no route', {}],
      ['a route that is not valid', { webhookPath: 'a b' }]
    ])('refuses the controller with %s and names webhookPath', (_name, extra) => {
      // Scenario: there is no default route, so the controller needs one the host chose.
      const error = problems({ ...valid(), webhookController: true, ...extra })
      expect(error.optionPaths).toEqual(['webhookPath'])
    })

    it('refuses the controller in a multi-tenant host and names webhookController', () => {
      // Scenario: the controller has no authenticated tenant to give (SEC08).
      const error = problems({
        ...valid(),
        webhookController: true,
        webhookPath: 'hooks/billing',
        multiTenant: true
      })
      expect(error.optionPaths).toEqual(['webhookController'])
    })

    it.each([
      ['a route with the switch off', { webhookPath: 'hooks/billing' }],
      ['multi-tenant with the switch off', { multiTenant: true }],
      ['the switch off with no route', { webhookController: false }]
    ])('accepts %s', (_name, extra) => {
      // Scenario: only the combination of the switch with a missing route or tenancy is refused.
      expect(() => validateOptions({ ...valid(), ...extra })).not.toThrow()
    })
  })

  describe('values never reach the error', () => {
    it('keeps every supplied sentinel out of the message, the serialized form, the cause and the inspection', () => {
      // Scenario: every option is given a sentinel in the wrong shape; the error that names them
      // all contains the sentinel nowhere it can be read from.
      const everyWrong = {
        ...Object.fromEntries(ROWS.map((row) => [row.path, SENTINEL])),
        webhookPath: `${SENTINEL}?`
      }
      const error = problems(everyWrong)
      expect(error.optionPaths.length).toBe(ROWS.length)
      expect(error.message).not.toContain(SENTINEL)
      expect(JSON.stringify(error)).not.toContain(SENTINEL)
      expect(JSON.stringify(error.toJSON())).not.toContain(SENTINEL)
      expect(String(error.cause)).not.toContain(SENTINEL)
      expect('cause' in error).toBe(false)
      expect(inspect(error, { showHidden: true, depth: null })).not.toContain(SENTINEL)
    })

    it('keeps the sentinel of a rejected sandbox combination out of the error', () => {
      // Scenario: the combination rule names an option, never the supplied flags.
      const error = problems({
        ...valid(),
        allowSandbox: true,
        isProduction: true,
        webhookPath: SENTINEL + ' x'
      })
      expect(error.optionPaths).toEqual(['confirmSandboxInProduction', 'webhookPath'])
      expect(inspect(error, { showHidden: true })).not.toContain(SENTINEL)
    })
  })

  describe('shape checks', () => {
    it('does not call a source it refuses', () => {
      // Scenario: a source whose methods all throw if invoked is refused by shape alone.
      const trap = (): never => {
        throw new Error(SENTINEL)
      }
      const source = { name: 1, readAccount: trap, verifyWebhook: trap, capabilities: trap }
      const error = problems({ ...valid(), source })
      expect(error.optionPaths).toEqual(['source'])
    })

    it('leaves the options it reads equal to what they were', () => {
      // Scenario: the options object, the cache and the source and store are frozen, so a write
      // would throw, and the entries and the cache are compared with a copy taken before.
      const base = valid()
      const options = Object.freeze({
        ...base,
        source: Object.freeze(base['source']),
        store: Object.freeze(base['store']),
        cache: Object.freeze({ get: 1 })
      })
      const entries = Object.entries(options)
      const cacheBefore = structuredClone(options.cache)
      expect(() => validateOptions(options)).toThrow(SubscriptionError)
      expect(Object.entries(options)).toStrictEqual(entries)
      expect(options.cache).toStrictEqual(cacheBefore)
    })
  })
})
