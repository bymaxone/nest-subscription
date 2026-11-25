/**
 * @fileoverview The memory of failed webhook events whose identifier may still be recorded in the
 * store, and the rules that settle it. A failed event starts a removal of its identifier; the
 * removal can be pending, can fail, and can erase an identifier that a later retry recorded
 * again. The ledger counts the removals in flight per event and remembers whether the event was
 * processed since and whether any removal succeeded, so an event is settled only when every
 * removal started for it has settled. It is plain in-memory state: it calls no store.
 * @layer core
 */

/**
 * How many events the ledger remembers: the oldest is forgotten past this bound, so the memory
 * never grows with the traffic.
 */
export const UNRELEASED_EVENTS_BOUND = 1000

/** What the removals and the outcomes of one event came to so far. */
interface EventState {
  /** Removals started and not settled yet. */
  inFlight: number
  /** Whether a removal succeeded, so the identifier may be gone from the store. */
  erased: boolean
  /** Whether the latest outcome of the event is processed, so its identifier should be recorded. */
  processed: boolean
}

/** What to do once a removal settled. */
export type Settlement =
  /** Another removal is still in flight, so nothing is decided yet. */
  | 'wait'
  /** The event is settled and forgotten, or not remembered. */
  | 'done'
  /** The event was processed and a removal erased its identifier: record it again, then finish. */
  | 'rerecord'

/**
 * Remembers the events whose removal is pending or failed, keyed by an encoding of source and
 * event identifier. An event is remembered from its failure until every removal started for it
 * has settled and the identifier is in the state its latest outcome calls for: removed after a
 * failure, recorded after a success.
 */
export class UnreleasedEvents {
  readonly #events = new Map<string, EventState>()

  /** Whether the event is remembered, so a delivery of it is processed as new. */
  has(key: string): boolean {
    return this.#events.has(key)
  }

  /**
   * An event failed and a removal of its identifier is started. Its latest outcome is now a
   * failure, so the identifier should end removed. The event becomes the newest entry.
   */
  failed(key: string): void {
    const earlier = this.#events.get(key)
    this.#events.delete(key)
    this.#events.set(key, {
      inFlight: (earlier?.inFlight ?? 0) + 1,
      erased: earlier?.erased ?? false,
      processed: false
    })
    for (const oldest of this.#events.keys()) {
      if (this.#events.size <= UNRELEASED_EVENTS_BOUND) break
      this.#events.delete(oldest)
    }
  }

  /**
   * A remembered event was processed. With no removal in flight its identifier is still recorded
   * and the event is forgotten; otherwise the identifier is recorded again once they settle.
   */
  processed(key: string): void {
    const state = this.#events.get(key)
    if (state === undefined) return
    state.processed = true
    if (state.inFlight === 0) this.#events.delete(key)
  }

  /**
   * A removal settled. Only the last one decides: an event whose latest outcome is a failure is
   * forgotten once an identifier was removed and kept while every removal failed, so its retry
   * is processed; one whose latest outcome is processed needs its identifier recorded again if a
   * removal erased it.
   *
   * @param key The event.
   * @param removed Whether the store removed the identifier.
   */
  settled(key: string, removed: boolean): Settlement {
    const state = this.#events.get(key)
    if (state === undefined) return 'done'
    state.inFlight -= 1
    state.erased ||= removed
    if (state.inFlight > 0) return 'wait'
    if (state.processed && state.erased) return 'rerecord'
    if (state.processed || state.erased) this.#events.delete(key)
    return 'done'
  }

  /**
   * The identifier of a processed event was recorded again, or could not be. The event is
   * forgotten unless a new failure started another removal meanwhile.
   */
  rerecorded(key: string): void {
    const state = this.#events.get(key)
    if (state !== undefined && state.inFlight === 0 && state.processed) this.#events.delete(key)
  }
}
