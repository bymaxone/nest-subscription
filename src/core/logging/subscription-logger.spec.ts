/**
 * @fileoverview Pins the library's one log function: each event writes its own fixed sentence with
 * a catalogue code or `unclassified`, and a logger that throws never reaches the caller.
 * @layer core
 */
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { logEvent, type LogEvent } from './subscription-logger'

const EVENTS: readonly LogEvent[] = [
  'background_refresh_failed',
  'change_hook_failed',
  'change_clear_failed',
  'change_read_failed'
]

describe('logEvent', () => {
  it.each(EVENTS)('writes one line for %s that ends with the code', (event) => {
    // Scenario: a catalogue code is the only variable part of the line.
    const warn = jest.fn()
    logEvent({ warn }, event, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/: SUBSCRIPTION_SOURCE_UNAVAILABLE\.$/)
  })

  it('gives each event its own sentence', () => {
    // Scenario: four events, four different sentences.
    const lines: string[] = []
    for (const event of EVENTS) logEvent({ warn: (line) => void lines.push(line) }, event, null)
    expect(new Set(lines).size).toBe(EVENTS.length)
  })

  it("writes unclassified for an error that is not the library's", () => {
    // Scenario: no code is known.
    const warn = jest.fn()
    logEvent({ warn }, 'background_refresh_failed', null)
    expect(warn).toHaveBeenCalledWith(
      'Background refresh of a stale snapshot failed: unclassified.'
    )
  })

  it('contains a logger that throws', () => {
    // Scenario: the host's logger raises; the caller's operation goes on.
    expect(() =>
      logEvent(
        {
          warn: () => {
            throw new Error('logger broke')
          }
        },
        'change_hook_failed',
        null
      )
    ).not.toThrow()
  })
})
