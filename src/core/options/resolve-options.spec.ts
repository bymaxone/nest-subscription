/**
 * @fileoverview Pins the defaults `resolveOptions` applies against the specification, and that the
 * resolved form is frozen, complete and built without touching the host's object.
 * @layer core
 */
import { inspect } from 'node:util'

import { Secret } from '@bymax-one/nest-subscription/internal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore
} from '@bymax-one/nest-subscription/testing'
import {
  DEFAULT_ALLOW_SANDBOX,
  DEFAULT_FAIL_POLICY,
  DEFAULT_LAST_KNOWN_STATE_TOLERANCE_MS,
  DEFAULT_MAX_SNAPSHOT_AGE_MS,
  DEFAULT_WEBHOOK_CONTROLLER
} from './defaults'
import { resolveOptions } from './resolve-options'
import type { SubscriptionOptionsInput } from './subscription-options.types'
import { systemClock } from '../system-clock'

const HOURS_24_MS = 24 * 60 * 60 * 1000

function minimal(): SubscriptionOptionsInput {
  return {
    source: new FakeSubscriptionSource(),
    store: new InMemorySubscriptionStore(),
    accountResolver: () => null
  }
}

describe('defaults', () => {
  it.each([
    ['fail policy', DEFAULT_FAIL_POLICY, 'refuse'],
    ['last known state tolerance (D12)', DEFAULT_LAST_KNOWN_STATE_TOLERANCE_MS, HOURS_24_MS],
    ['maximum snapshot age (D12)', DEFAULT_MAX_SNAPSHOT_AGE_MS, HOURS_24_MS],
    ['sandbox access (SEC07)', DEFAULT_ALLOW_SANDBOX, false],
    ['webhook controller (D10)', DEFAULT_WEBHOOK_CONTROLLER, false]
  ])('pins the default of the %s to the specification', (_name, actual, expected) => {
    // Scenario: each constant is compared with the literal the specification states.
    expect(actual).toBe(expected)
  })
})

describe('resolveOptions', () => {
  it('applies every default to a minimal input', () => {
    // Scenario: only the three required options are given; every other field takes its default.
    const resolved = resolveOptions(minimal())
    expect(resolved).toMatchObject({
      onChange: null,
      failPolicy: 'refuse',
      lastKnownStateToleranceMs: HOURS_24_MS,
      maxSnapshotAgeMs: HOURS_24_MS,
      allowSandbox: false,
      confirmSandboxInProduction: false,
      isProduction: false,
      cache: null,
      observer: null,
      eventRetentionMs: null,
      webhookController: false,
      webhookPath: null,
      multiTenant: false
    })
    expect(resolved.clock).toBe(systemClock)
  })

  it('carries every value the host gave', () => {
    // Scenario: every optional field is set to a value that differs from its default.
    const onChange = jest.fn()
    const cache = { get: jest.fn(), set: jest.fn(), delete: jest.fn() }
    const observer = {}
    const clock = { now: () => new Date(0) }
    const input: SubscriptionOptionsInput = {
      ...minimal(),
      onChange,
      failPolicy: 'last_known_state',
      lastKnownStateToleranceMs: 1000,
      maxSnapshotAgeMs: 2000,
      allowSandbox: true,
      confirmSandboxInProduction: true,
      isProduction: true,
      cache,
      observer,
      eventRetentionMs: 3000,
      webhookController: true,
      webhookPath: 'hooks/billing',
      multiTenant: true,
      clock
    }
    const resolved = resolveOptions(input)
    expect(resolved).toMatchObject({
      source: input.source,
      store: input.store,
      accountResolver: input.accountResolver,
      onChange,
      failPolicy: 'last_known_state',
      lastKnownStateToleranceMs: 1000,
      maxSnapshotAgeMs: 2000,
      allowSandbox: true,
      confirmSandboxInProduction: true,
      isProduction: true,
      cache,
      observer,
      eventRetentionMs: 3000,
      webhookController: true,
      webhookPath: 'hooks/billing',
      multiTenant: true,
      clock
    })
  })

  it('freezes the resolved object', () => {
    // Scenario: a write to the resolved object is refused.
    const resolved = resolveOptions(minimal())
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('leaves the host object and the host instances unfrozen and unchanged', () => {
    // Scenario: the input, its source and its store are inspected after resolving.
    const input = minimal()
    const before = { ...input }
    resolveOptions(input)
    expect(input).toEqual(before)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.source)).toBe(false)
    expect(Object.isFrozen(input.store)).toBe(false)
  })

  it('refuses invalid options before building anything', () => {
    // Scenario: a missing store and a negative age are reported together by the validator.
    const input = { ...minimal(), maxSnapshotAgeMs: -1, store: undefined }
    expect(() => resolveOptions(input)).toThrow('Offending options: store, maxSnapshotAgeMs.')
  })

  it('carries no field the host added beyond the options', () => {
    // Scenario: an unknown field on the input never reaches the resolved object.
    const resolved = resolveOptions({ ...minimal(), surplus: 'x' } as SubscriptionOptionsInput)
    expect(Object.keys(resolved)).not.toContain('surplus')
  })
})

const SENTINEL = 'sentinel-webhook-secret-41e8d0'
const PREVIOUS = 'sentinel-previous-secret-77ab3c'

function withSecret(): SubscriptionOptionsInput {
  return { ...minimal(), webhookSecret: { current: SENTINEL, previous: PREVIOUS } }
}

function noLeak(output: string): void {
  expect(output).not.toContain(SENTINEL)
  expect(output).not.toContain(PREVIOUS)
}

describe('resolveOptions secret containment (SEC05)', () => {
  it('holds the webhook secret in a Secret that returns both values on a deliberate read', () => {
    // Scenario: a rotation pair is given; the deliberate read returns it (SEC09).
    const resolved = resolveOptions(withSecret())
    expect(resolved.webhookSecret).toBeInstanceOf(Secret)
    expect(resolved.webhookSecret?.candidates()).toEqual([SENTINEL, PREVIOUS])
  })

  it('has no webhook secret when the host set none', () => {
    // Scenario: the accessor answers null, and still is not enumerable.
    const resolved = resolveOptions(minimal())
    expect(resolved.webhookSecret).toBeNull()
    expect(Object.keys(resolved)).not.toContain('webhookSecret')
  })

  it('keeps the secret out of serialization, spread, enumeration and inspection', () => {
    // Scenario: the four paths the specification names, and the other ways to list properties.
    const resolved = resolveOptions(withSecret())
    noLeak(JSON.stringify(resolved))
    noLeak(JSON.stringify({ ...resolved }))
    noLeak(inspect(resolved))
    noLeak(inspect(resolved, { showHidden: true }))
    noLeak(inspect(resolved, { showHidden: true, depth: null }))
    noLeak(inspect(resolved, { showHidden: true, depth: null, getters: true }))
    noLeak(JSON.stringify(Object.entries(resolved)))
    noLeak(JSON.stringify(Object.keys(resolved)))
    noLeak(JSON.stringify(Object.getOwnPropertyNames(resolved)))
    noLeak(JSON.stringify(Object.assign({}, resolved)))
    const seen: string[] = []
    for (const key in resolved) seen.push(key)
    noLeak(seen.join())
    expect('webhookSecret' in { ...resolved }).toBe(false)
  })

  it('exposes the secret through a non-enumerable accessor and nothing else', () => {
    // Scenario: the descriptor of the property is inspected.
    const resolved = resolveOptions(withSecret())
    const descriptor = Object.getOwnPropertyDescriptor(resolved, 'webhookSecret')
    expect(descriptor?.enumerable).toBe(false)
    expect(typeof descriptor?.get).toBe('function')
    expect(descriptor?.value).toBeUndefined()
  })

  it('wraps a single string and returns a Secret it was given unchanged', () => {
    // Scenario: the shorthand and the holder an adapter already made.
    expect(resolveOptions({ ...minimal(), webhookSecret: SENTINEL }).webhookSecret?.reveal()).toBe(
      SENTINEL
    )
    const secret = new Secret(SENTINEL)
    expect(resolveOptions({ ...minimal(), webhookSecret: secret }).webhookSecret).toBe(secret)
  })

  it('never writes to or redefines a property of the host object', () => {
    // Scenario: the host's object, its pair and its descriptors are identical after resolving.
    const pair = { current: SENTINEL, previous: PREVIOUS }
    const input = { ...minimal(), webhookSecret: pair }
    const descriptors = Object.getOwnPropertyDescriptors(input)
    resolveOptions(input)
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(descriptors)
    expect(input.webhookSecret).toBe(pair)
    expect(pair).toEqual({ current: SENTINEL, previous: PREVIOUS })
    expect(Object.isFrozen(pair)).toBe(false)
    expect(Object.isFrozen(input)).toBe(false)
  })

  it('keeps a secret of the wrong shape out of the error', () => {
    // Scenario: the secret is given as an object of the wrong shape carrying a sentinel.
    try {
      resolveOptions({ ...minimal(), webhookSecret: { current: 5, previous: SENTINEL } })
    } catch (error) {
      noLeak(String(error))
      noLeak(JSON.stringify(error))
      noLeak(inspect(error, { showHidden: true, depth: null }))
      expect(String(error)).toContain('webhookSecret')
      return
    }
    throw new Error('the options were accepted')
  })
})
