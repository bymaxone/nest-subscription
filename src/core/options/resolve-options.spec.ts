/**
 * @fileoverview Pins the defaults `resolveOptions` applies against the specification, and that the
 * resolved form is frozen, complete and built without touching the host's object.
 * @layer core
 */
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
