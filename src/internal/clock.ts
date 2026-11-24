/**
 * @fileoverview The time source every part of the library reads, so no code reads the system
 * clock directly and no test waits on a real timer.
 * @layer internal
 */

/** Gives the current instant. */
export interface Clock {
  /** The current instant. */
  now(): Date
}
