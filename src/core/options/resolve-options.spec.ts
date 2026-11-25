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

const SENTINEL = 'sentinel-credential-41e8d0'
const PREVIOUS = 'sentinel-previous-credential-77ab3c'

/** A source the way an adapter factory builds one: its credential sits in a `Secret`. */
function credentialedSource(): FakeSubscriptionSource & { readonly credential: Secret } {
  return Object.assign(new FakeSubscriptionSource(), {
    credential: new Secret(SENTINEL, PREVIOUS)
  })
}

function noLeak(output: string): void {
  expect(output).not.toContain(SENTINEL)
  expect(output).not.toContain(PREVIOUS)
}

describe('resolveOptions secret containment (SEC05)', () => {
  it('keeps a credential held by the source out of every path, and the sweep reaches it', () => {
    // Scenario: the source holds a rotation pair in a Secret; every path over the resolved
    // options goes through the source. Each output must show the placeholder where the secret
    // sits (so the sweep is not vacuous) and never a value.
    const source = credentialedSource()
    const resolved = resolveOptions({ ...minimal(), source })
    const outputs = [
      JSON.stringify(resolved),
      JSON.stringify({ ...resolved }),
      inspect(resolved, { depth: null }),
      inspect(resolved, { showHidden: true, depth: null }),
      inspect(resolved, { showHidden: true, depth: null, getters: true }),
      JSON.stringify(Object.entries(resolved)),
      JSON.stringify(Object.assign({}, resolved))
    ]
    for (const output of outputs) {
      noLeak(output)
      expect(output).toContain('[Secret]')
    }
    expect(resolved.source).toBe(source)
    expect(source.credential.candidates()).toEqual([SENTINEL, PREVIOUS])
  })

  it('carries no webhook secret or credential option of its own', () => {
    // Scenario: unknown keys are ignored by validation; a key named like a secret is never copied
    // to the resolved object, whatever shape it has.
    const resolved = resolveOptions({ ...minimal(), signingSecret: SENTINEL, apiKey: PREVIOUS })
    expect('signingSecret' in resolved).toBe(false)
    expect('apiKey' in resolved).toBe(false)
    noLeak(inspect(resolved, { showHidden: true, depth: null, getters: true }))
  })

  it('never writes to or redefines a property of the host object', () => {
    // Scenario: the host's object and its source keep their descriptors after resolving.
    const input = { ...minimal(), source: credentialedSource() }
    const descriptors = Object.getOwnPropertyDescriptors(input)
    const sourceDescriptors = Object.getOwnPropertyDescriptors(input.source)
    resolveOptions(input)
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(descriptors)
    expect(Object.getOwnPropertyDescriptors(input.source)).toEqual(sourceDescriptors)
    expect(Object.isFrozen(input)).toBe(false)
  })
})
