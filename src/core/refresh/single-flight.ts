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
