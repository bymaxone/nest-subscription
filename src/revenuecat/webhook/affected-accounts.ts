/**
 * @fileoverview Which accounts a RevenueCat event names. An event can name the last seen App User
 * ID, the first one, every alias, and for a transfer the identifiers that lost and gained the
 * purchases; every one of them is an account to read. Identifiers are case-sensitive and are
 * never normalised. An anonymous identifier is not an account of the host: it is counted and kept
 * out of the list. Only the identifiers are read, never any state the event carries.
 * @layer revenuecat
 */
import { readString, type JsonRecord } from '../read/parse-customer'

/** The prefix RevenueCat gives an identifier it generated for a customer with no App User ID. */
export const ANONYMOUS_PREFIX = '$RCAnonymousID:'

/** The longest identifier accepted; the customer endpoint takes at most 1500 characters. */
const MAX_IDENTIFIER_LENGTH = 1500

/** The fields of an event that hold one identifier. */
const SINGLE_FIELDS = ['app_user_id', 'original_app_user_id'] as const

/** The fields of an event that hold a list of identifiers. */
const LIST_FIELDS = ['aliases', 'transferred_from', 'transferred_to'] as const

/** The accounts an event names. */
export interface AffectedAccounts {
  /** The accounts to read, in order of first appearance, without duplicates. */
  readonly accountIds: readonly string[]
  /** How many anonymous identifiers the event named. */
  readonly anonymousCount: number
}

/** The identifier a field holds as one string; none when it holds anything else. */
function single(event: JsonRecord, field: string): readonly string[] {
  const id = readString(event, field)
  return id === null ? [] : [id]
}

/** The identifiers a field holds as a list of strings; entries that are not strings are dropped. */
function list(event: JsonRecord, field: string): readonly string[] {
  const value: unknown = Reflect.get(event, field)
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/**
 * Collects the identifiers an event names.
 *
 * @param event The `event` object of the webhook body.
 */
export function affectedAccounts(event: JsonRecord): AffectedAccounts {
  const named = [
    ...SINGLE_FIELDS.flatMap((field) => single(event, field)),
    ...LIST_FIELDS.flatMap((field) => list(event, field))
  ].filter((id) => id.length > 0 && id.length <= MAX_IDENTIFIER_LENGTH)
  const unique = [...new Set(named)]
  const anonymous = unique.filter((id) => id.startsWith(ANONYMOUS_PREFIX))
  return {
    accountIds: unique.filter((id) => !id.startsWith(ANONYMOUS_PREFIX)),
    anonymousCount: anonymous.length
  }
}
