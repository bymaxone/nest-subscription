/**
 * @fileoverview Pins the capture helpers: the logger and the observer record what they are given
 * in order, and the sentinel assertion finds a sentinel in a line, in a payload value or in a
 * field name, and refuses to run with no sentinel or an empty one.
 * @layer testing
 */
import { assertNoSentinel, createCapture } from './capture'

describe('createCapture', () => {
  it('records the lines the logger receives, in order', () => {
    // Scenario: two warnings.
    const capture = createCapture()
    capture.logger.warn('first')
    capture.logger.warn('second')
    expect(capture.lines).toStrictEqual(['first', 'second'])
  })

  it.each([
    'onRefresh',
    'onSourceError',
    'onCacheLookup',
    'onGuardDecision',
    'onChangeDelivery',
    'onWebhook',
    'onBackgroundRefreshFailure'
  ] as const)('records what %s receives, with its method name', (method) => {
    // Scenario: the observer implements every method, so no event goes unrecorded.
    const capture = createCapture()
    const payload = { marker: method }
    const receive = capture.observer[method] as (value: unknown) => void
    receive(payload)
    expect(capture.payloads).toStrictEqual([{ method, payload }])
  })
})

describe('assertNoSentinel', () => {
  it('passes when no sentinel appears', () => {
    // Scenario: a clean line and a clean payload.
    const capture = createCapture()
    capture.logger.warn('clean line')
    capture.observer.onCacheLookup?.({ outcome: 'hit' })
    expect(() => assertNoSentinel(capture, ['secret-account'])).not.toThrow()
  })

  it('fails when a log line holds a sentinel, naming its position and the line', () => {
    // Scenario: the second sentinel is in the first line.
    const capture = createCapture()
    capture.logger.warn('failed for secret-tenant')
    expect(() => assertNoSentinel(capture, ['secret-account', 'secret-tenant'])).toThrow(
      'Sentinel 1 was found in log line 0.'
    )
  })

  it('fails when a payload value holds a sentinel', () => {
    // Scenario: an identifier ends up in a payload field.
    const capture = createCapture()
    capture.observer.onRefresh?.({
      outcome: 'written',
      source: 'secret-account',
      durationMs: 1,
      changeCount: 0
    })
    expect(() => assertNoSentinel(capture, ['secret-account'])).toThrow(
      'Sentinel 0 was found in observer payload 0 (onRefresh).'
    )
  })

  it('fails when a sentinel is a field name of a payload', () => {
    // Scenario: an identifier used as a key of a payload.
    const capture = createCapture()
    capture.observer.onWebhook?.({ ['secret-account']: 1 } as never)
    expect(() => assertNoSentinel(capture, ['secret-account'])).toThrow(/Sentinel 0 was found/)
  })

  it('does not repeat the sentinel in its failure', () => {
    // Scenario: the message names a position, so a failing run does not print the identifier.
    const capture = createCapture()
    capture.logger.warn('secret-account')
    let message = ''
    try {
      assertNoSentinel(capture, ['secret-account'])
    } catch (error) {
      message = String((error as Error).message)
    }
    expect(message).toBe('Sentinel 0 was found in log line 0.')
  })

  it.each([[[]], [['']], [['ok', '']]])('refuses to run with the sentinels %j', (sentinels) => {
    // Scenario: no sentinel, or an empty one that would be found everywhere.
    expect(() => assertNoSentinel(createCapture(), sentinels)).toThrow(
      'assertNoSentinel needs at least one sentinel and none may be empty.'
    )
  })

  it('searches a payload that has no JSON form as text without failing', () => {
    // Scenario: a payload of `undefined` has no JSON; it holds no sentinel and does not throw.
    const capture = createCapture()
    capture.observer.onWebhook?.(undefined as never)
    expect(() => assertNoSentinel(capture, ['secret-account'])).not.toThrow()
  })
})

describe('assertNoSentinel on what JSON would hide', () => {
  /** A capture whose observer received the payload, whatever its shape. */
  function receiving(payload: unknown): ReturnType<typeof createCapture> {
    const capture = createCapture()
    capture.observer.onWebhook?.(payload as never)
    return capture
  }

  const ESCAPED = 'account"1\\2\n3\t4 5'

  it.each([
    [
      'a string with a quote, a backslash, a newline, a tab and U+2028',
      ESCAPED,
      { source: ESCAPED }
    ],
    ['a property name', 'secret-account', { 'secret-account': 1 }],
    ['a property name with escaped characters', ESCAPED, { [ESCAPED]: 1 }],
    ['a Map key', 'secret-account', new Map([['secret-account', 1]])],
    ['a Map value', 'secret-account', new Map([[1, 'secret-account']])],
    ['a Set member', 'secret-account', new Set(['secret-account'])],
    ['a BigInt', '12345678901234567890', { count: 12345678901234567890n }],
    ['a number', '4242', { count: 4242 }],
    ['a boolean', 'true', { ok: true }],
    ['three levels of nesting', 'secret-account', { a: { b: { c: ['x-secret-account-y'] } } }],
    ['a Map nested in an array', 'secret-account', [new Map([[{ k: 'secret-account' }, 1]])]]
  ])('finds a sentinel held as %s', (_where, sentinel, payload) => {
    // Scenario: the payload holds the sentinel where serialising to JSON loses or escapes it.
    expect(() => assertNoSentinel(receiving(payload), [sentinel])).toThrow(
      'Sentinel 0 was found in observer payload 0 (onWebhook).'
    )
  })

  it('terminates on a payload that refers to itself, and passes when it holds no sentinel', () => {
    // Scenario: a cycle through an object and through a Map.
    const payload: Record<string, unknown> = { name: 'clean' }
    payload['self'] = payload
    payload['map'] = new Map([['k', payload]])
    expect(() => assertNoSentinel(receiving(payload), ['secret-account'])).not.toThrow()
  })

  it('finds a sentinel in a payload that refers to itself', () => {
    // Scenario: the cycle does not stop the search from reaching the string beside it.
    const payload: Record<string, unknown> = { name: 'secret-account' }
    payload['self'] = payload
    expect(() => assertNoSentinel(receiving(payload), ['secret-account'])).toThrow(/found/)
  })

  it('finds a sentinel that is only in a log line, with clean payloads beside it', () => {
    // Scenario: the payload is clean; the line is not.
    const capture = receiving({ outcome: 'processed' })
    capture.logger.warn('failed for secret-account')
    expect(() => assertNoSentinel(capture, ['secret-account'])).toThrow(
      'Sentinel 0 was found in log line 0.'
    )
  })

  it('passes a payload of functions, symbols and undefined values that hold no sentinel', () => {
    // Scenario: values JSON cannot hold are searched without failing.
    const payload = { run: () => 1, tag: Symbol('x'), nothing: undefined, none: null }
    expect(() => assertNoSentinel(receiving(payload), ['secret-account'])).not.toThrow()
  })
})
