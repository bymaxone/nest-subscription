/**
 * @fileoverview Pins the library's one log function: each event writes its own fixed sentence with
 * a short hash of the account and a catalogue code or `unclassified`, never the account itself,
 * and a logger that throws never reaches the caller.
 * @layer core
 */
import { hashAccountKey } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { logEvent, type LogEvent } from './subscription-logger'

const EVENTS: readonly LogEvent[] = [
  'background_refresh_failed',
  'change_hook_failed',
  'change_clear_failed',
  'change_read_failed'
]
const KEY = 'a24:sentinel-account-key'

describe('logEvent', () => {
  it.each(EVENTS)(
    'writes one line for %s that names the account by hash and ends with the code',
    (event) => {
      // Scenario: the hash and a catalogue code are the only variable parts of the line.
      const warn = jest.fn()
      logEvent({ warn }, event, SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE, KEY)
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]?.[0])
      expect(line).toContain(` (account ${hashAccountKey(KEY)}): `)
      expect(line).toMatch(/: SUBSCRIPTION_SOURCE_UNAVAILABLE\.$/)
    }
  )

  it('never writes the account key', () => {
    // Scenario: a recognizable key does not appear in any event's line.
    const lines: string[] = []
    for (const event of EVENTS) {
      logEvent({ warn: (line) => void lines.push(line) }, event, null, KEY)
    }
    expect(lines.join('\n')).not.toMatch(/sentinel/)
  })

  it('gives each event its own sentence', () => {
    // Scenario: four events, four different sentences.
    const lines: string[] = []
    for (const event of EVENTS) {
      logEvent({ warn: (line) => void lines.push(line) }, event, null, KEY)
    }
    expect(new Set(lines).size).toBe(EVENTS.length)
  })

  it("writes unclassified for an error that is not the library's", () => {
    // Scenario: no code is known.
    const warn = jest.fn()
    logEvent({ warn }, 'background_refresh_failed', null, KEY)
    expect(warn).toHaveBeenCalledWith(
      `Background refresh of a stale snapshot failed (account ${hashAccountKey(KEY)}): unclassified.`
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
        null,
        KEY
      )
    ).not.toThrow()
  })
})
