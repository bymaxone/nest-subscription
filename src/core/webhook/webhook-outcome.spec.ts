/**
 * @fileoverview Unit tests for the webhook outcomes and their HTTP answers.
 *
 * Layer: unit.
 * Goal: each outcome maps to the status the source's contract expects, and no answer can hold
 * payload content or an identifier.
 * Mocks: none.
 */
import { toHttpAnswer, type WebhookOutcome } from './webhook-outcome'

const CASES: ReadonlyArray<readonly [string, WebhookOutcome, number, object]> = [
  ['processed', { kind: 'processed', accounts: 2 }, 200, { outcome: 'processed', accounts: 2 }],
  ['duplicate', { kind: 'duplicate' }, 200, { outcome: 'duplicate' }],
  ['ignored', { kind: 'ignored' }, 200, { outcome: 'ignored' }],
  [
    'refused',
    { kind: 'refused' },
    401,
    { code: 'SUBSCRIPTION_WEBHOOK_REFUSED', message: 'The webhook request was refused.' }
  ],
  [
    'failed',
    { kind: 'failed' },
    503,
    { code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE', message: 'The billing source could not be read.' }
  ]
]

describe('toHttpAnswer', () => {
  it.each(CASES)(
    'answers a %s outcome with its status and body',
    (_kind, outcome, status, body) => {
      // Scenario: one row per outcome; the status and the body are asserted for each row.
      const answer = toHttpAnswer(outcome)
      expect(answer.status).toBe(status)
      expect(answer.body).toStrictEqual(body)
    }
  )

  it('answers a processed outcome with the count it carries', () => {
    // Scenario: the only variable part of any answer is the number of accounts read.
    expect(toHttpAnswer({ kind: 'processed', accounts: 7 }).body).toStrictEqual({
      outcome: 'processed',
      accounts: 7
    })
  })

  it('answers every refusal with the same object', () => {
    // Scenario: two refusals, however they came about, get the very same answer.
    expect(toHttpAnswer({ kind: 'refused' })).toBe(toHttpAnswer({ kind: 'refused' }))
  })

  it('freezes the refusal and the failure answers', () => {
    // Scenario: a shared answer that could be edited would let one request change the next one's.
    for (const kind of ['refused', 'failed'] as const) {
      const answer = toHttpAnswer({ kind })
      expect(Object.isFrozen(answer)).toBe(true)
      expect(Object.isFrozen(answer.body)).toBe(true)
    }
  })

  it('gives the refusal body the code and the message and no other key', () => {
    // Scenario: the body of a refusal is the catalogue's code and message and nothing else.
    expect(Object.keys(toHttpAnswer({ kind: 'refused' }).body)).toStrictEqual(['code', 'message'])
  })
})
