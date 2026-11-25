/**
 * @fileoverview Pins the observer bridge: with no observer it reads no clock and builds no payload,
 * with an observer each method delivers one closed payload, durations come from the injected clock,
 * and whatever an observer throws, rejects with or exposes through a throwing property stays
 * inside the bridge.
 * @layer core
 */
import { ManualClock } from '@bymax-one/nest-subscription/testing'

import { ObserverBridge } from './observer-bridge'
import type { SubscriptionObserver } from './observer.types'

const T0 = '2026-01-01T00:00:00.000Z'

/** Every bridge method with the call that reports one event and the payload the observer gets. */
const EVENTS: ReadonlyArray<{
  readonly name: keyof SubscriptionObserver
  readonly report: (bridge: ObserverBridge, startedAt: number) => void
  readonly payload: unknown
}> = [
  {
    name: 'onRefresh',
    report: (bridge, at) => bridge.refresh('written', 'fake', at, 2),
    payload: { outcome: 'written', source: 'fake', durationMs: 40, changeCount: 2 }
  },
  {
    name: 'onSourceError',
    report: (bridge, at) => bridge.sourceError('fake', at),
    payload: { source: 'fake', durationMs: 40 }
  },
  {
    name: 'onCacheLookup',
    report: (bridge) => bridge.cacheLookup('hit'),
    payload: { outcome: 'hit' }
  },
  {
    name: 'onGuardDecision',
    report: (bridge) => bridge.guardDecision('refused', 'SUBSCRIPTION_NO_ACCESS'),
    payload: { outcome: 'refused', code: 'SUBSCRIPTION_NO_ACCESS' }
  },
  {
    name: 'onChangeDelivery',
    report: (bridge, at) => bridge.changeDelivery('failed', true, 3, at, null),
    payload: { outcome: 'failed', redelivery: true, changeCount: 3, durationMs: 40, code: null }
  },
  {
    name: 'onWebhook',
    report: (bridge, at) => bridge.webhook('failed', at, at + 40, true),
    payload: { outcome: 'failed', durationMs: 40, retained: true }
  },
  {
    name: 'onBackgroundRefreshFailure',
    report: (bridge) => bridge.backgroundRefreshFailure('SUBSCRIPTION_SOURCE_UNAVAILABLE'),
    payload: { code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE' }
  }
]

/** A clock that counts every reading and moves 40 milliseconds on each one after the first. */
function countingClock(): { clock: ManualClock; readings: () => number } {
  const clock = new ManualClock(T0)
  let readings = 0
  const now = clock.now.bind(clock)
  jest.spyOn(clock, 'now').mockImplementation(() => {
    readings += 1
    const at = now()
    clock.advance(40)
    return at
  })
  return { clock, readings: () => readings }
}

describe('ObserverBridge without an observer', () => {
  it('reads no clock for any event', () => {
    // Scenario: every event is reported to a bridge with no observer; the clock is never read.
    const { clock, readings } = countingClock()
    const bridge = new ObserverBridge(null, clock)
    const startedAt = bridge.mark()
    for (const event of EVENTS) event.report(bridge, startedAt)
    expect(readings()).toBe(0)
  })

  it('marks zero', () => {
    // Scenario: with no observer there is nothing to measure from.
    expect(new ObserverBridge(null, new ManualClock(T0)).mark()).toBe(0)
  })
})

describe('ObserverBridge with an observer', () => {
  it.each(EVENTS)('delivers the closed payload of $name', ({ name, report, payload }) => {
    // Scenario: the clock moves 40 ms between the mark and the report, so the duration is 40.
    const received = jest.fn()
    const { clock } = countingClock()
    const bridge = new ObserverBridge({ [name]: received }, clock)
    report(bridge, bridge.mark())
    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith(payload)
  })

  it.each(EVENTS)(
    'reads no clock for $name when the observer lacks that method',
    ({ name, report }) => {
      // Scenario: the observer implements every method except this one, so nothing is built or timed.
      const others = Object.fromEntries(
        EVENTS.filter((event) => event.name !== name).map((event) => [event.name, jest.fn()])
      )
      const { clock, readings } = countingClock()
      const bridge = new ObserverBridge(others, clock)
      report(bridge, 0)
      expect(readings()).toBe(0)
    }
  )

  it('calls the method on the observer itself', () => {
    // Scenario: an observer written as a class reads its own state, so `this` must be preserved.
    const seen: unknown[] = []
    class Counting implements SubscriptionObserver {
      readonly label = 'mine'
      onCacheLookup(): void {
        seen.push(this.label)
      }
    }
    new ObserverBridge(new Counting(), new ManualClock(T0)).cacheLookup('miss')
    expect(seen).toStrictEqual(['mine'])
  })

  it('measures a duration of zero when the clock has not moved', () => {
    // Scenario: the injected clock is still, so the duration is zero and never negative.
    const received = jest.fn()
    const clock = new ManualClock(T0)
    const bridge = new ObserverBridge({ onWebhook: received }, clock)
    const at = bridge.mark()
    bridge.webhook('processed', at, at, false)
    expect(received).toHaveBeenCalledWith({ outcome: 'processed', durationMs: 0, retained: false })
  })

  it('never reports a negative duration when the clock goes back', () => {
    // Scenario: a clock that moves backwards between the mark and the report.
    const received = jest.fn()
    const clock = new ManualClock(T0)
    const bridge = new ObserverBridge({ onWebhook: received }, clock)
    const startedAt = bridge.mark()
    clock.advance(-1000)
    bridge.webhook('processed', startedAt, bridge.mark(), false)
    expect(received).toHaveBeenCalledWith({ outcome: 'processed', durationMs: 0, retained: false })
  })
})

describe('ObserverBridge containment', () => {
  it('contains a method that throws', () => {
    // Scenario: the observer throws synchronously; the report returns normally.
    const bridge = new ObserverBridge(
      {
        onCacheLookup: () => {
          throw new Error('observer broke')
        }
      },
      new ManualClock(T0)
    )
    expect(() => bridge.cacheLookup('hit')).not.toThrow()
  })

  it('handles the rejection of a promise a method returns', () => {
    // Scenario: the observer returns a rejected promise; the bridge attaches a handler to it, so
    // the rejection cannot go unhandled.
    const rejected = Promise.reject(new Error('observer rejected'))
    const handled = jest.spyOn(rejected, 'catch')
    const bridge = new ObserverBridge({ onCacheLookup: () => rejected }, new ManualClock(T0))
    bridge.cacheLookup('hit')
    expect(handled).toHaveBeenCalledTimes(1)
  })

  it('contains a returned promise whose then throws', () => {
    // Scenario: the observer returns a promise whose `then` raises when the bridge attaches to it.
    const broken = Object.assign(Promise.resolve(), {
      then(): never {
        throw new Error('then broke')
      }
    })
    const bridge = new ObserverBridge({ onCacheLookup: () => broken }, new ManualClock(T0))
    expect(() => bridge.cacheLookup('hit')).not.toThrow()
  })

  it('contains an observer whose method property throws when read', () => {
    // Scenario: a getter on the observer raises; the report returns normally and delivers nothing.
    const observer: SubscriptionObserver = Object.defineProperty({}, 'onCacheLookup', {
      get(): never {
        throw new Error('getter broke')
      }
    })
    expect(() => new ObserverBridge(observer, new ManualClock(T0)).cacheLookup('hit')).not.toThrow()
  })
})

describe('ObserverBridge webhook report after the answer', () => {
  it('measures the duration to the answer, not to the report', () => {
    // Scenario: the answer is read when it is given and the report is made later; the clock moving
    // between the two does not change the duration.
    const received = jest.fn()
    const clock = new ManualClock(T0)
    const bridge = new ObserverBridge({ onWebhook: received }, clock)
    const startedAt = bridge.mark()
    clock.advance(30)
    const answeredAt = bridge.mark()
    clock.advance(5000)
    bridge.webhook('failed', startedAt, answeredAt, true)
    expect(received).toHaveBeenCalledWith({ outcome: 'failed', durationMs: 30, retained: true })
  })
})
