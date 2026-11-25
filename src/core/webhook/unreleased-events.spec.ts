/**
 * @fileoverview Unit tests for the memory of failed webhook events.
 *
 * Goal: an event is settled only when every removal started for it has settled, and then in the
 * state its latest outcome calls for; the memory is bounded and drops the oldest event first.
 * Mocks: none; the ledger is plain state.
 * @layer core
 */
import { UNRELEASED_EVENTS_BOUND, UnreleasedEvents } from './unreleased-events'

describe('UnreleasedEvents', () => {
  it('remembers an event from its failure', () => {
    // Scenario: nothing is remembered until an event fails.
    const events = new UnreleasedEvents()
    expect(events.has('a')).toBe(false)
    events.failed('a')
    expect(events.has('a')).toBe(true)
    expect(events.has('b')).toBe(false)
  })

  it('waits while another removal is in flight, whatever the first one did', () => {
    // Scenario: two removals; the first settling, successful or not, decides nothing.
    for (const removed of [true, false]) {
      const events = new UnreleasedEvents()
      events.failed('a')
      events.failed('a')
      expect(events.settled('a', removed)).toBe('wait')
      expect(events.has('a')).toBe(true)
    }
  })

  it('forgets a failed event once a removal succeeded and none is in flight', () => {
    // Scenario: the identifier is gone, so the next delivery takes the normal path.
    const events = new UnreleasedEvents()
    events.failed('a')
    expect(events.settled('a', true)).toBe('done')
    expect(events.has('a')).toBe(false)
  })

  it('keeps a failed event while every removal failed', () => {
    // Scenario: the identifier is still recorded, so a retry must be processed.
    const events = new UnreleasedEvents()
    events.failed('a')
    expect(events.settled('a', false)).toBe('done')
    expect(events.has('a')).toBe(true)
  })

  it('forgets a failed event when one removal succeeded and another failed', () => {
    // Scenario: the success erased the identifier whatever order they settled in.
    for (const order of [
      [true, false],
      [false, true]
    ]) {
      const events = new UnreleasedEvents()
      events.failed('a')
      events.failed('a')
      events.settled('a', order[0] ?? false)
      expect(events.settled('a', order[1] ?? false)).toBe('done')
      expect(events.has('a')).toBe(false)
    }
  })

  it('forgets a processed event at once when no removal is in flight', () => {
    // Scenario: every removal failed, so the identifier is still recorded and nothing is owed.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.settled('a', false)
    events.processed('a')
    expect(events.has('a')).toBe(false)
  })

  it('keeps a processed event while a removal is in flight', () => {
    // Scenario: the pending removal may still erase the identifier.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.processed('a')
    expect(events.has('a')).toBe(true)
  })

  it('asks to record the identifier again when the last removal settles after a success', () => {
    // Scenario: processed meanwhile and a removal erased the identifier: record it again.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.processed('a')
    expect(events.settled('a', true)).toBe('rerecord')
    expect(events.has('a')).toBe(true)
    events.rerecorded('a')
    expect(events.has('a')).toBe(false)
  })

  it('asks to record it again when a removal succeeded earlier and another fails last', () => {
    // Scenario: the earlier success erased the identifier even though the last removal failed.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.failed('a')
    events.settled('a', true)
    events.processed('a')
    expect(events.settled('a', false)).toBe('rerecord')
  })

  it('forgets a processed event without recording it when every removal failed', () => {
    // Scenario: the identifier was never erased, so there is nothing to record again.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.processed('a')
    expect(events.settled('a', false)).toBe('done')
    expect(events.has('a')).toBe(false)
  })

  it('does not forget an event whose recording is pending when it fails again', () => {
    // Scenario: a new failure while the identifier is being recorded again starts another
    // removal, so finishing the recording leaves the event remembered.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.processed('a')
    events.settled('a', true)
    events.failed('a')
    events.rerecorded('a')
    expect(events.has('a')).toBe(true)
  })

  it('keeps a processed event while a removal started after its recording began is in flight', () => {
    // Scenario: the recording is pending, the event fails again and is then processed while the
    // new removal is still in flight; finishing the recording does not forget it.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.processed('a')
    events.settled('a', true)
    events.failed('a')
    events.processed('a')
    events.rerecorded('a')
    expect(events.has('a')).toBe(true)
  })

  it('settles an event that failed again after it was processed as a failure', () => {
    // Scenario: the latest outcome is a failure, so the earlier processed mark no longer calls for
    // recording the identifier again; once the removals succeeded the event is forgotten.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.processed('a')
    events.failed('a')
    events.settled('a', true)
    expect(events.settled('a', true)).toBe('done')
    expect(events.has('a')).toBe(false)
  })

  it('ignores an event that is not remembered', () => {
    // Scenario: an event dropped past the bound settles harmlessly, and is not brought back.
    const events = new UnreleasedEvents()
    expect(events.settled('a', true)).toBe('done')
    events.processed('a')
    events.rerecorded('a')
    expect(events.has('a')).toBe(false)
  })

  it('does not finish the recording of an event that is not processed', () => {
    // Scenario: a stray finish never forgets an event that still waits for its removals.
    const events = new UnreleasedEvents()
    events.failed('a')
    events.settled('a', false)
    events.rerecorded('a')
    expect(events.has('a')).toBe(true)
  })

  it('keeps the bound many events and drops the oldest past it', () => {
    // Scenario: the newest events are kept, and a failure again makes an event the newest.
    const events = new UnreleasedEvents()
    for (let n = 1; n <= UNRELEASED_EVENTS_BOUND; n += 1) events.failed(`e${String(n)}`)
    expect(events.has('e1')).toBe(true)
    events.failed('e1')
    events.failed('extra')
    expect(events.has('e1')).toBe(true)
    expect(events.has('e2')).toBe(false)
    expect(events.has('extra')).toBe(true)
  })
})
