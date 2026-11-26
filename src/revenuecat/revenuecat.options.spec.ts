/**
 * @fileoverview Pins the validation and the resolved form of the RevenueCat adapter's options:
 * what is refused and how it is named, what the defaults are, and that no secret reaches an
 * error or an enumerable property.
 * @layer revenuecat
 */
import { inspect } from 'node:util'

import { Secret, SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SIGNATURE_TOLERANCE_MS,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_SIGNATURE_TOLERANCE_MS,
  resolveRevenueCatOptions
} from './revenuecat.options'

const KEY = 'sentinel-api-key-7f3a'
const PREVIOUS_KEY = 'sentinel-previous-key-91bc'
const AUTHORIZATION = 'sentinel-authorization-5d2e'
const SIGNING = 'sentinel-signing-secret-0a1b'

const minimal = { projectId: 'project-1', apiKey: KEY }

/** The refusal the options raise, or `null` when they were accepted. */
function refusal(input: unknown): SubscriptionError | null {
  try {
    resolveRevenueCatOptions(input)
    return null
  } catch (error) {
    if (error instanceof SubscriptionError) return error
    throw error
  }
}

/** The paths a configuration refusal names, or `null` when the options were accepted. */
function refusedPaths(input: unknown): readonly string[] | null {
  const error = refusal(input)
  if (error === null) return null
  expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID)
  return error.optionPaths
}

describe('resolveRevenueCatOptions', () => {
  it('applies the documented defaults to the minimal options', () => {
    // Scenario: only the two required options are given; every other option takes its default.
    const resolved = resolveRevenueCatOptions(minimal)
    expect(resolved.baseUrl).toBe(DEFAULT_BASE_URL)
    expect(resolved.signatureToleranceMs).toBe(DEFAULT_SIGNATURE_TOLERANCE_MS)
    expect(resolved.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS)
    expect(resolved.allowSandbox).toBe(false)
    expect(resolved.webhookAuthorization).toBeNull()
    expect(resolved.webhookSigningSecret).toBeNull()
    expect(resolved.logger).toBeNull()
    expect(resolved.onUnidentifiedEvent).toBeNull()
  })

  it('keeps every optional option that is valid, at its boundary where it has one', () => {
    // Scenario: the largest accepted tolerance, timeout and project length, a key given as a
    // current value alone, and a logger and a callback, are carried into the resolved options.
    const warn = jest.fn()
    const callback = jest.fn()
    const resolved = resolveRevenueCatOptions({
      projectId: 'p'.repeat(255),
      apiKey: { current: KEY },
      signatureToleranceMs: MAX_SIGNATURE_TOLERANCE_MS,
      requestTimeoutMs: MAX_REQUEST_TIMEOUT_MS,
      allowSandbox: true,
      logger: { warn },
      onUnidentifiedEvent: callback
    })
    expect(resolved.projectId).toHaveLength(255)
    expect(resolved.apiKey.candidates()).toStrictEqual([KEY])
    expect(resolved.signatureToleranceMs).toBe(MAX_SIGNATURE_TOLERANCE_MS)
    expect(resolved.requestTimeoutMs).toBe(MAX_REQUEST_TIMEOUT_MS)
    expect(resolved.allowSandbox).toBe(true)
    expect(resolved.logger?.warn).toBe(warn)
    expect(resolved.onUnidentifiedEvent).toBe(callback)
    expect(
      resolveRevenueCatOptions({ ...minimal, signatureToleranceMs: 1, requestTimeoutMs: 1 })
    ).toMatchObject({ signatureToleranceMs: 1, requestTimeoutMs: 1 })
  })

  it('reads the system time through the default clock and keeps a clock that is given', () => {
    // Scenario: without a clock the adapter tells the real time; with one it tells the given time.
    const before = Date.now()
    expect(resolveRevenueCatOptions(minimal).clock.now().getTime()).toBeGreaterThanOrEqual(before)
    const given = { now: () => new Date(0) }
    expect(resolveRevenueCatOptions({ ...minimal, clock: given }).clock).toBe(given)
  })

  it('holds the default base address at the version 2 address of the facts file', () => {
    // Scenario: the default is a recorded fact, so a change to it is a visible one.
    expect(DEFAULT_BASE_URL).toBe('https://api.revenuecat.com/v2')
  })

  it('keeps the largest tolerance below the retry window of about 80 minutes', () => {
    // Scenario: RevenueCat warns against sizing the tolerance to its retry window.
    expect(MAX_SIGNATURE_TOLERANCE_MS).toBeLessThan(80 * 60_000)
    expect(DEFAULT_SIGNATURE_TOLERANCE_MS).toBeLessThan(MAX_SIGNATURE_TOLERANCE_MS)
  })

  it('holds the API key and both webhook secrets in a Secret, with the pair of a rotation', () => {
    // Scenario: each secret option is given as a string, a pair and a holder; all become Secrets.
    const holder = new Secret(SIGNING)
    const resolved = resolveRevenueCatOptions({
      projectId: 'project-1',
      apiKey: { current: KEY, previous: PREVIOUS_KEY },
      webhookAuthorization: AUTHORIZATION,
      webhookSigningSecret: holder
    })
    expect(resolved.apiKey).toBeInstanceOf(Secret)
    expect(resolved.apiKey.candidates()).toStrictEqual([KEY, PREVIOUS_KEY])
    expect(resolved.webhookAuthorization?.candidates()).toStrictEqual([AUTHORIZATION])
    expect(resolved.webhookSigningSecret).toBe(holder)
  })

  it('shows no secret in JSON.stringify, a spread, util.inspect with showHidden or the property names of the resolved options', () => {
    // Scenario: the four containment paths, plus the property names, over options holding secrets.
    const resolved = resolveRevenueCatOptions({
      ...minimal,
      apiKey: { current: KEY, previous: PREVIOUS_KEY },
      webhookAuthorization: AUTHORIZATION,
      webhookSigningSecret: SIGNING
    })
    const outputs = [
      JSON.stringify(resolved),
      JSON.stringify({ ...resolved }),
      inspect(resolved),
      inspect(resolved, { showHidden: true, depth: null }),
      Object.getOwnPropertyNames(resolved).join()
    ]
    for (const output of outputs) {
      for (const secret of [KEY, PREVIOUS_KEY, AUTHORIZATION, SIGNING]) {
        expect(output).not.toContain(secret)
      }
    }
    expect(JSON.stringify(resolved)).toContain('[Secret]')
  })

  it.each([
    ['a missing project', { apiKey: KEY }, ['projectId']],
    ['an empty project', { ...minimal, projectId: '' }, ['projectId']],
    ['a project of 256 characters', { ...minimal, projectId: 'p'.repeat(256) }, ['projectId']],
    ['a missing key', { projectId: 'project-1' }, ['apiKey']],
    ['an empty key', { ...minimal, apiKey: '' }, ['apiKey']],
    [
      'a key pair with an empty previous',
      { ...minimal, apiKey: { current: KEY, previous: '' } },
      ['apiKey']
    ],
    ['a key pair with no current', { ...minimal, apiKey: { previous: KEY } }, ['apiKey']],
    ['a key that is a number', { ...minimal, apiKey: 12 }, ['apiKey']],
    [
      'an empty webhook authorization',
      { ...minimal, webhookAuthorization: '' },
      ['webhookAuthorization']
    ],
    [
      'a webhook secret that is null',
      { ...minimal, webhookSigningSecret: null },
      ['webhookSigningSecret']
    ],
    ['a tolerance of zero', { ...minimal, signatureToleranceMs: 0 }, ['signatureToleranceMs']],
    ['a fractional tolerance', { ...minimal, signatureToleranceMs: 1.5 }, ['signatureToleranceMs']],
    [
      'a tolerance past the maximum',
      { ...minimal, signatureToleranceMs: MAX_SIGNATURE_TOLERANCE_MS + 1 },
      ['signatureToleranceMs']
    ],
    ['a timeout of zero', { ...minimal, requestTimeoutMs: 0 }, ['requestTimeoutMs']],
    [
      'a timeout past the maximum',
      { ...minimal, requestTimeoutMs: MAX_REQUEST_TIMEOUT_MS + 1 },
      ['requestTimeoutMs']
    ],
    ['a fetch that is not a function', { ...minimal, fetch: 'fetch' }, ['fetch']],
    ['a clock without now', { ...minimal, clock: {} }, ['clock']],
    ['a logger without warn', { ...minimal, logger: {} }, ['logger']],
    ['a logger that is null', { ...minimal, logger: null }, ['logger']],
    [
      'a callback that is not a function',
      { ...minimal, onUnidentifiedEvent: true },
      ['onUnidentifiedEvent']
    ],
    ['an allowSandbox that is a string', { ...minimal, allowSandbox: 'yes' }, ['allowSandbox']],
    [
      'a confirmation that is a string',
      { ...minimal, confirmSandboxInProduction: 'yes' },
      ['confirmSandboxInProduction']
    ],
    ['an isProduction that is a string', { ...minimal, isProduction: 'yes' }, ['isProduction']],
    ['input that is not an object', 'options', ['options']],
    ['input that is null', null, ['options']]
  ])('refuses %s and names only the option', (_label, input, paths) => {
    // Scenario: one case per refusal; the error names option paths and nothing a host supplied.
    expect(refusedPaths(input)).toStrictEqual(paths)
  })

  it('names every offending option once, in the order of the rules', () => {
    // Scenario: three options are wrong at once; the one error names all three.
    expect(refusedPaths({ projectId: '', apiKey: '', requestTimeoutMs: -1 })).toStrictEqual([
      'projectId',
      'apiKey',
      'requestTimeoutMs'
    ])
  })

  it('carries no supplied value in the refusal of a secret or an address', () => {
    // Scenario: the options hold sentinel values that are invalid; the message shows none.
    const bad = {
      projectId: 'project-1',
      apiKey: KEY,
      baseUrl: `http://user:${AUTHORIZATION}@example.com`
    }
    const error = refusal(bad)
    expect(error?.message).not.toContain(AUTHORIZATION)
    expect(error?.message).not.toContain(KEY)
    expect(JSON.stringify(error)).not.toContain(AUTHORIZATION)
    expect(error?.cause).toBeUndefined()
  })

  describe('baseUrl', () => {
    it.each([
      ['https://api.example.com/v2', 'https://api.example.com/v2'],
      ['https://api.example.com/v2/', 'https://api.example.com/v2'],
      ['https://api.example.com', 'https://api.example.com'],
      ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
      ['http://127.4.5.6:9/v2', 'http://127.4.5.6:9/v2'],
      ['http://127.10.200.30:9', 'http://127.10.200.30:9'],
      ['https://api.example.com/v2//', 'https://api.example.com/v2'],
      ['http://localhost:3000/v2/', 'http://localhost:3000/v2'],
      ['http://[::1]:3000', 'http://[::1]:3000']
    ])('accepts %s and resolves it to %s', (given, resolved) => {
      // Scenario: HTTPS anywhere, plain HTTP to loopback; trailing slashes are dropped.
      expect(resolveRevenueCatOptions({ ...minimal, baseUrl: given }).baseUrl).toBe(resolved)
    })

    it.each([
      ['a relative address', '/v2'],
      ['a bare host', 'api.revenuecat.com'],
      ['plain HTTP to a public host', 'http://api.example.com/v2'],
      ['plain HTTP to a host that only starts like loopback', 'http://127.0.0.1.example.com'],
      ['a scheme that is not HTTP', 'ftp://api.example.com'],
      ['a scheme that is not HTTP, to loopback', 'ftp://127.0.0.1'],
      ['a host that only ends like a loopback address', 'http://a127.0.0.1'],
      ['an address with a password only', 'https://:pass@api.example.com'],
      ['an address with credentials', 'https://user:pass@api.example.com'],
      ['an address with a user only', 'https://user@api.example.com'],
      ['an address with a query', 'https://api.example.com/v2?x=1'],
      ['an address with a fragment', 'https://api.example.com/v2#x'],
      ['an empty address', ''],
      ['an address that is not a string', 42]
    ])('refuses %s', (_label, baseUrl) => {
      // Scenario: each refused shape names baseUrl and nothing else.
      expect(refusedPaths({ ...minimal, baseUrl })).toStrictEqual(['baseUrl'])
    })
  })

  describe('sandbox in production', () => {
    it.each([
      ['sandbox allowed outside production', { allowSandbox: true, isProduction: false }, null],
      [
        'sandbox allowed in production with the confirmation',
        { allowSandbox: true, isProduction: true, confirmSandboxInProduction: true },
        null
      ],
      ['sandbox not allowed in production', { allowSandbox: false, isProduction: true }, null],
      [
        'sandbox allowed in production without the confirmation',
        { allowSandbox: true, isProduction: true },
        ['confirmSandboxInProduction']
      ],
      [
        'sandbox allowed in production with the confirmation off',
        { allowSandbox: true, isProduction: true, confirmSandboxInProduction: false },
        ['confirmSandboxInProduction']
      ]
    ])('%s', (_label, options, paths) => {
      // Scenario: enabling sandbox access in production needs the second, separate option (SEC07).
      expect(refusedPaths({ ...minimal, ...options })).toStrictEqual(paths)
    })
  })

  it('uses the global fetch by default and the given one when set', async () => {
    // Scenario: the default delegates to the runtime's fetch at call time; a given one is kept.
    const given = jest.fn()
    expect(resolveRevenueCatOptions({ ...minimal, fetch: given }).fetch).toBe(given)
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    await resolveRevenueCatOptions(minimal).fetch('http://127.0.0.1:1/x', { method: 'GET' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('http://127.0.0.1:1/x', { method: 'GET' })
  })

  it('reads the options before any callback is called or any secret revealed', () => {
    // Scenario: a refused set of options calls no host function.
    const warn = jest.fn()
    const callback = jest.fn()
    refusedPaths({ ...minimal, projectId: '', logger: { warn }, onUnidentifiedEvent: callback })
    expect(warn).toHaveBeenCalledTimes(0)
    expect(callback).toHaveBeenCalledTimes(0)
  })
})
