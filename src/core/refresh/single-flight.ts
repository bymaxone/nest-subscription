/**
 * @fileoverview The single-flight helper: at most one run per key at a time, shared with every
 * caller that arrives while it is in flight. It holds no state beyond the runs in flight.
 * @layer core
 */

/**
 * Collapses concurrent calls for one key into one run. An entry exists only while its run is in
 * flight and is removed when the run settles, whether it resolved or rejected, so the map never
 * grows with the number of keys seen and a failed run is never replayed to a later caller.
 */
export class SingleFlight<T> {
  readonly #inFlight = new Map<string, Promise<T>>()
  readonly #successors = new Map<string, Promise<T>>()

  /** The number of runs in flight. */
  get size(): number {
    return this.#inFlight.size
  }

  /**
   * Returns the run in flight for the key, or starts one with `start` and returns it. A `start`
   * that throws before returning a promise becomes a rejection of the run.
   *
   * @param key The identity of the work; callers with an equal key share one run.
   * @param start Begins the work. It is called at most once per run.
   */
  run(key: string, start: () => Promise<T>): Promise<T> {
    const existing = this.#inFlight.get(key)
    if (existing !== undefined) return existing
    const flight = this.#begin(key, start)
    this.#inFlight.set(key, flight)
    return flight
  }

  /**
   * Returns a run that began after this call. A run already in flight began before it, so it is
   * waited for, whatever it ends with, and a new run is then started or joined: callers that
   * arrive while the same older run is in flight share one new run, and a run that begins after
   * this call, whoever started it, is joined. With no run in flight this is {@link run}.
   *
   * @param key The identity of the work.
   * @param start Begins the work. It is called at most once per run.
   */
  runAfter(key: string, start: () => Promise<T>): Promise<T> {
    const older = this.#inFlight.get(key)
    if (older === undefined) return this.run(key, start)
    const pending = this.#successors.get(key)
    if (pending !== undefined) return pending
    const successor = this.#afterSettled(key, older, start)
    this.#successors.set(key, successor)
    return successor
  }

  /** Waits for an older run, ignoring how it ended, then starts or joins a run of the key. */
  async #afterSettled(key: string, older: Promise<T>, start: () => Promise<T>): Promise<T> {
    try {
      await older
    } catch {
      // The older run's outcome is its own callers'; this caller wants a run of its own.
    }
    this.#successors.delete(key)
    return this.run(key, start)
  }

  /**
   * Runs `start` and removes the entry when it settles. The first await lets `run` register the
   * entry before `start` can throw, so the removal always follows the registration.
   */
  async #begin(key: string, start: () => Promise<T>): Promise<T> {
    await Promise.resolve()
    try {
      return await start()
    } finally {
      this.#inFlight.delete(key)
    }
  }
}
