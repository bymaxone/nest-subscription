/**
 * @fileoverview Turns the raw bytes of a verified RevenueCat webhook into the port's notification:
 * the event identifier, the accounts to read, the kind, the time and the environment. The body is
 * used to know which accounts to read and nothing else: no state from it reaches a snapshot
 * (FR16, SEC01). A body that is not the expected shape is never an error: it becomes the unknown
 * kind with whatever could be read, and an event identifier derived from the bytes.
 * @layer revenuecat
 */
import { createHash } from 'node:crypto'

import type { SourceNotification } from '@bymax-one/nest-subscription/internal'

import { affectedAccounts } from './affected-accounts'
import { kindOf } from './event-kinds'
import { toInstant } from '../read/map-subscription'
import { isRecord, readMillis, readString, type JsonRecord } from '../read/parse-customer'

/** A notification and whether the event named only identifiers the host cannot have. */
export interface ParsedEvent {
  /** The notification handed to the receiver. */
  readonly notification: SourceNotification
  /** Whether the event named only anonymous identifiers, so there is no account to read. */
  readonly unidentified: boolean
}

/** The JSON a body holds, or `undefined` when it is not UTF-8 or not JSON. */
function parseBody(rawBody: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
  } catch {
    return undefined
  }
}

/** A stand-in event identifier for a body that carries none: the digest of its bytes. */
function digestId(rawBody: Uint8Array): string {
  return `sha256:${createHash('sha256').update(rawBody).digest('hex')}`
}

/** The `event` object of a body, or an empty object when there is none. */
function eventOf(body: unknown): JsonRecord {
  const event: unknown = isRecord(body) ? Reflect.get(body, 'event') : undefined
  return isRecord(event) ? event : {}
}

/**
 * Parses a verified webhook body.
 *
 * @param rawBody The bytes as received, already verified.
 * @param now The instant of the call, which stands in for an event time the body does not give.
 */
export function parseEvent(rawBody: Uint8Array, now: Date): ParsedEvent {
  const event = eventOf(parseBody(rawBody))
  const { kind, refreshes } = kindOf(Reflect.get(event, 'type'))
  const { accountIds, anonymousCount } = affectedAccounts(event)
  const accounts = refreshes ? accountIds : []
  return {
    notification: {
      eventId: readString(event, 'id') ?? digestId(rawBody),
      accountIds: accounts,
      kind,
      eventTime: toInstant(readMillis(event, 'event_timestamp_ms')) ?? now.toISOString(),
      environment: readString(event, 'environment') === 'PRODUCTION' ? 'production' : 'sandbox'
    },
    unidentified: refreshes && accounts.length === 0 && anonymousCount > 0
  }
}
