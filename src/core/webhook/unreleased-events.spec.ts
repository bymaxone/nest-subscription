/**
 * @fileoverview Unit tests for the memory of failed webhook events.
 *
 * Goal: an event is in one of three states, a successful removal forgets it, a failed one keeps
 * it with no removal in flight, a removal of an event that was forgotten or has a newer removal
 * changes nothing, and the memory is bounded and drops the oldest event first.
 * Mocks: none; the ledger is plain state.
 * @layer core
 */
import { UNRELEASED_EVENTS_BOUND, UnreleasedEvents } from './unreleased-events'

describe('UnreleasedEvents', () => {
  it('knows nothing of an event until a removal is started for it', () => {
    // Scenario: a fresh ledger and an event it was never told about.
    const events = new UnreleasedEvents()
    expect(events.memoryOf('a')).toBe('none')
  })

  it('has the event removing from the start of its removal, and no other event', () => {
    // Scenario: a removal started for one event leaves the others alone.
    const events = new UnreleasedEvents()
    events.begin('a')
    expect(events.memoryOf('a')).toBe('removing')
    expect(events.memoryOf('b')).toBe('none')
  })

  it('forgets the event when its removal succeeded', () => {
    // Scenario: the identifier is gone, so the next delivery is recorded and processed.
    const events = new UnreleasedEvents()
    events.settled('a', events.begin('a'), true)
    expect(events.memoryOf('a')).toBe('none')
  })

  it('keeps the event, with no removal in flight, when its removal failed', () => {
    // Scenario: the identifier is still recorded, so a delivery restarts the removal.
    const events = new UnreleasedEvents()
    events.settled('a', events.begin('a'), false)
    expect(events.memoryOf('a')).toBe('failed')
  })

  it('has the event removing again when a removal is started after a failed one', () => {
    // Scenario: the cleanup is retried by a delivery.
    const events = new UnreleasedEvents()
    events.settled('a', events.begin('a'), false)
    events.begin('a')
    expect(events.memoryOf('a')).toBe('removing')
  })

  it('ignores the settlement of a removal that a newer removal replaced', () => {
    // Scenario: the older removal settles while the newer is in flight; the event stays removing.
    const events = new UnreleasedEvents()
    const older = events.begin('a')
    events.begin('a')
    events.settled('a', older, true)
    expect(events.memoryOf('a')).toBe('removing')
    events.settled('a', older, false)
    expect(events.memoryOf('a')).toBe('removing')
  })

  it('ignores the settlement of a removal of an event that was forgotten', () => {
    // Scenario: a removal that settles after the event was dropped past the bound, or after a
    // success, does not bring the event back.
    const events = new UnreleasedEvents()
    const removal = events.begin('a')
    events.settled('a', removal, true)
    events.settled('a', removal, false)
    expect(events.memoryOf('a')).toBe('none')
  })

  it('keeps the bound many events and drops the oldest past it', () => {
    // Scenario: the newest events are kept, and an event whose removal starts again is the newest.
    const events = new UnreleasedEvents()
    for (let n = 1; n <= UNRELEASED_EVENTS_BOUND; n += 1) events.begin(`e${String(n)}`)
    expect(events.memoryOf('e1')).toBe('removing')
    events.begin('e1')
    events.begin('extra')
    expect(events.memoryOf('e1')).toBe('removing')
    expect(events.memoryOf('e2')).toBe('none')
    expect(events.memoryOf('extra')).toBe('removing')
  })

  it('settles the removal of a dropped event without effect', () => {
    // Scenario: the oldest event is dropped with its removal in flight; its settlement, successful
    // or not, leaves it forgotten.
    const events = new UnreleasedEvents()
    const first = events.begin('e1')
    for (let n = 2; n <= UNRELEASED_EVENTS_BOUND + 1; n += 1) events.begin(`e${String(n)}`)
    expect(events.memoryOf('e1')).toBe('none')
    events.settled('e1', first, false)
    expect(events.memoryOf('e1')).toBe('none')
  })
})
