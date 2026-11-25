/**
 * @fileoverview Unit tests for the response deadline.
 *
 * Goal: the race returns the work's value or the timeout, tells the wait to stop in both cases,
 * lets a slow work settle after the timeout, and leaves no timer pending after the answer.
 * Mocks: Jest fake timers for the default wait; hand-resolved promises for the injected wait.
 * @layer core
 */
import { timerWait, withDeadline, type DeadlineWait } from './deadline'

/** A wait the test resolves itself, recording the signal and the duration it was given. */
function manualWait(): {
  wait: DeadlineWait
  expire: () => void
  signals: AbortSignal[]
  durations: number[]
} {
  const signals: AbortSignal[] = []
  const durations: number[] = []
  let expire = (): void => undefined
  const wait: DeadlineWait = (milliseconds, signal) => {
    durations.push(milliseconds)
    signals.push(signal)
    return new Promise<void>((resolve) => {
      expire = resolve
    })
  }
  return { wait, expire: () => expire(), signals, durations }
}

describe('withDeadline', () => {
  it('returns the value of work that finishes before the wait', async () => {
    // Scenario: the work wins the race, so the value comes back and the wait was told to stop.
    const { wait, signals, durations } = manualWait()
    const result = await withDeadline(Promise.resolve('done'), 250, wait)
    expect(result).toStrictEqual({ timedOut: false, value: 'done' })
    expect(durations).toStrictEqual([250])
    expect(signals[0]?.aborted).toBe(true)
  })

  it('reports a timeout when the wait finishes first, and stops the wait', async () => {
    // Scenario: the work is held; the wait expires; the answer is the timeout.
    const { wait, expire, signals } = manualWait()
    let release = (): void => undefined
    const slow = new Promise<string>((resolve) => {
      release = () => resolve('late')
    })
    const racing = withDeadline(slow, 10, wait)
    expire()
    expect(await racing).toStrictEqual({ timedOut: true })
    expect(signals[0]?.aborted).toBe(true)
    release()
  })

  it('lets slow work settle after the timeout', async () => {
    // Scenario: the work is not cancelled; it completes after the answer and its value is intact.
    const { wait, expire } = manualWait()
    const effects: string[] = []
    let release = (): void => undefined
    const slow = new Promise<void>((resolve) => {
      release = resolve
    }).then(() => {
      effects.push('written')
    })
    const racing = withDeadline(slow, 10, wait)
    expire()
    await racing
    expect(effects).toStrictEqual([])
    release()
    await slow
    expect(effects).toStrictEqual(['written'])
  })

  it('handles the rejection of work that fails after the timeout', async () => {
    // Scenario: late failure of abandoned work must not become an unhandled rejection.
    const { wait, expire } = manualWait()
    let fail = (_reason: Error): void => undefined
    const slow = new Promise<void>((_resolve, reject) => {
      fail = reject
    })
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    const racing = withDeadline(slow, 10, wait)
    expire()
    await racing
    fail(new Error('late'))
    await new Promise((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).toHaveBeenCalledTimes(0)
  })

  it('rejects when the work fails before the wait', async () => {
    // Scenario: work that fails first is the caller's to handle, and the wait is stopped.
    const { wait, signals } = manualWait()
    await expect(withDeadline(Promise.reject(new Error('read failed')), 10, wait)).rejects.toThrow(
      'read failed'
    )
    expect(signals[0]?.aborted).toBe(true)
  })
})

describe('timerWait', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves when its time has passed and leaves no timer behind', async () => {
    // Scenario: the work is held for longer than the deadline, so the timer fires.
    const slow = new Promise<void>(() => undefined)
    const racing = withDeadline(slow, 1000, timerWait)
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(999)
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(1)
    expect(await racing).toStrictEqual({ timedOut: true })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('clears its timer when the work wins', async () => {
    // Scenario: work that finishes at once; no timer is pending after the answer.
    const result = await withDeadline(Promise.resolve(1), 60_000, timerWait)
    expect(result).toStrictEqual({ timedOut: false, value: 1 })
    expect(jest.getTimerCount()).toBe(0)
  })

  it('clears its timer when the work fails first', async () => {
    // Scenario: work that rejects; the timer is cleared on that path too.
    await expect(withDeadline(Promise.reject(new Error('x')), 60_000, timerWait)).rejects.toThrow(
      'x'
    )
    expect(jest.getTimerCount()).toBe(0)
  })

  it('listens once for the abort and stops listening when it finishes', async () => {
    // Scenario: the listener is registered for the abort event, once, and removed under the same
    // name with the same function when the timer fires, so nothing stays attached to the signal.
    const controller = new AbortController()
    const add = jest.spyOn(controller.signal, 'addEventListener')
    const remove = jest.spyOn(controller.signal, 'removeEventListener')
    const done = timerWait(500, controller.signal)
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    jest.advanceTimersByTime(500)
    await done
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1])
  })

  it('does not resolve before the time has passed', async () => {
    // Scenario: a wait that has been started and not aborted stays pending.
    const controller = new AbortController()
    const settled = jest.fn()
    void timerWait(500, controller.signal).then(settled)
    jest.advanceTimersByTime(499)
    await Promise.resolve()
    expect(settled).toHaveBeenCalledTimes(0)
    controller.abort()
    await Promise.resolve()
    expect(settled).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})
