/**
 * @fileoverview The response deadline of the receiver: a race between work and a wait, with the
 * wait injectable so a test decides when time has passed. The default wait is the only timer the
 * library ever starts, and it is cleared the moment the race is decided, so none outlives a call.
 * @layer core
 */

/**
 * Injection token of the wait the receiver races its work against. The module provides the timer
 * wait; a test provides a wait it resolves by hand.
 */
export const WEBHOOK_WAIT = Symbol('WEBHOOK_WAIT')

/**
 * Resolves after the given number of milliseconds, or as soon as the signal aborts, whichever
 * comes first. A wait that aborts must release whatever it holds.
 */
export type DeadlineWait = (milliseconds: number, signal: AbortSignal) => Promise<void>

/** How a race ended: the work finished with a value, or the wait did. */
export type DeadlineResult<T> =
  { readonly timedOut: false; readonly value: T } | { readonly timedOut: true }

/** The default wait: a timer that is cleared when the signal aborts. */
export const timerWait: DeadlineWait = (milliseconds, signal) =>
  new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })

/**
 * Races a promise against a wait. The work is never cancelled: when the wait wins, the work goes
 * on and its own settlement is handled, so a write it is in the middle of completes normally. The
 * wait is told to stop as soon as the race is decided, whichever side won.
 *
 * @param work The work to wait for.
 * @param milliseconds How long to wait for it.
 * @param wait How to wait; the module passes {@link timerWait}.
 * @returns The work's value, or that the time ran out. It rejects when the work does, if the work
 * settles first.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  wait: DeadlineWait
): Promise<DeadlineResult<T>> {
  const controller = new AbortController()
  const timeout = wait(milliseconds, controller.signal).then((): DeadlineResult<T> => ({
    timedOut: true
  }))
  const finished = work.then((value): DeadlineResult<T> => ({ timedOut: false, value }))
  try {
    return await Promise.race([finished, timeout])
  } finally {
    controller.abort()
  }
}
