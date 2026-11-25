/**
 * @fileoverview The memory of failed webhook events whose identifier may still be recorded in the
 * store. A failed event starts a removal of its identifier, and until that removal has succeeded a
 * delivery of the event must not be processed: it is answered as a failure, so the source retries
 * later, and a delivery after a removal that failed starts the removal again. An event is
 * therefore in one of three states: not remembered, with its removal in flight, or with its last
 * removal failed. The ledger is plain in-memory state: it calls no store.
 * @layer core
 */

/**
 * How many events the ledger remembers: the oldest is forgotten past this bound, so the memory
 * never grows with the traffic. An event forgotten while its identifier is still recorded is
 * answered as already seen from then on.
 */
export const UNRELEASED_EVENTS_BOUND = 1000

/** What the ledger knows of an event. */
export type EventMemory = 'none' | 'removing' | 'failed'

/**
 * Remembers the failed events whose identifier is not known to be removed, keyed by an encoding
 * of source and event identifier. A symbol marks the removal in flight; `null` marks an event
 * whose last removal failed.
 */
export class UnreleasedEvents {
  readonly #events = new Map<string, symbol | null>()

  /** What the ledger knows of the event. */
  memoryOf(key: string): EventMemory {
    const removal = this.#events.get(key)
    if (removal === undefined) return 'none'
    return removal === null ? 'failed' : 'removing'
  }

  /**
   * A removal of the event's identifier is started. The event becomes the newest entry, and the
   * oldest is forgotten past the bound.
   *
   * @returns A token for this removal, to hand back to {@link UnreleasedEvents.settled}.
   */
  begin(key: string): symbol {
    const removal = Symbol('removal')
    this.#events.delete(key)
    this.#events.set(key, removal)
    for (const oldest of this.#events.keys()) {
      if (this.#events.size <= UNRELEASED_EVENTS_BOUND) break
      this.#events.delete(oldest)
    }
    return removal
  }

  /**
   * A removal settled. A removal that succeeded forgets the event, so the next delivery is
   * recorded and processed; one that failed leaves it remembered with no removal in flight. A
   * removal of an event that was forgotten or has a newer removal changes nothing.
   *
   * @param key The event.
   * @param removal The token {@link UnreleasedEvents.begin} returned for this removal.
   * @param removed Whether the store removed the identifier.
   */
  settled(key: string, removal: symbol, removed: boolean): void {
    if (this.#events.get(key) !== removal) return
    if (removed) this.#events.delete(key)
    else this.#events.set(key, null)
  }
}
