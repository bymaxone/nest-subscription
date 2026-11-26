/**
 * @fileoverview Ties the three mapping tables of the adapter to Appendix A.3 of the specification:
 * the specification's text is read and compared with the data file, the data file is compared
 * with the tables in code, and every row, and a value no row lists, goes through the functions.
 * @layer revenuecat
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  SUBSCRIPTION_ORIGINS,
  SUBSCRIPTION_STATUSES,
  WILL_RENEW_VALUES
} from '@bymax-one/nest-subscription/shared'

import { mapOrigin, ORIGIN_TABLE } from './origin'
import { mapWillRenew, RENEWAL_TABLE } from './renewal'
import { mapStatus, STATUS_TABLE } from './status'

const ROOT = join(__dirname, '..', '..', '..')

interface TablesFile {
  readonly status: Readonly<Record<string, string>>
  readonly renewal: Readonly<Record<string, string>>
  readonly store: Readonly<Record<string, string>>
  readonly unlisted: { readonly status: string; readonly renewal: string; readonly store: string }
}

function readTables(): TablesFile {
  const parsed: unknown = JSON.parse(
    readFileSync(join(ROOT, 'test', 'fixtures', 'revenuecat', 'appendix-a3.json'), 'utf8')
  )
  return parsed as TablesFile
}

/** The text of Appendix A.3 of the specification. */
function appendixA3(): string {
  const spec = readFileSync(join(ROOT, 'docs', 'spec.md'), 'utf8')
  const start = spec.indexOf('### A.3 ')
  return spec.slice(start, spec.indexOf('### A.4 ', start))
}

/** The names in backticks of a fragment, in order. */
function names(fragment: string): string[] {
  return [...fragment.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '')
}

/** The rows `| a, b | c |` of the status table of the specification, as pairs. */
function specStatusPairs(text: string): Array<[string, string]> {
  return text
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .flatMap((line) => {
      const [left = '', right = ''] = line.split('|').slice(1, 3)
      const target = names(right)[0] ?? ''
      return names(left).map((from): [string, string] => [from, target])
    })
}

/** The pairs of a prose list such as "`a` and `b` to `c`; `d` to `e`", one clause at a time. */
function specClausePairs(sentence: string): Array<[string, string]> {
  return sentence.split(';').flatMap((clause) => {
    const [from = '', to = ''] = clause.split(' to ')
    const target = names(to)[0]
    return target === undefined ? [] : names(from).map((name): [string, string] => [name, target])
  })
}

/** The one sentence of the appendix that starts with `prefix`. */
function sentenceStarting(text: string, prefix: string): string {
  const line = text.split('\n').find((candidate) => candidate.startsWith(prefix))
  return line ?? ''
}

function tableOf(pairs: ReadonlyArray<[string, string]>): Record<string, string> {
  return Object.fromEntries(pairs)
}

describe('Appendix A.3 and the mapping tables', () => {
  const tables = readTables()
  const text = appendixA3()

  it('has a status table in the specification that equals the data file', () => {
    // Scenario: a row edited in one place and not the other fails here.
    expect(tableOf(specStatusPairs(text))).toStrictEqual(tables.status)
  })

  it('has a renewal sentence in the specification that equals the data file', () => {
    // Scenario: the sentence lists four renewal statuses; the others map to `unknown`.
    const sentence = sentenceStarting(text, 'Renewal status maps to will renew:')
    const body =
      sentence.replace('Renewal status maps to will renew:', '').split(', the others')[0] ?? ''
    const listed = [...body.matchAll(/`([^`]+)` to `([^`]+)`/g)].map((match): [string, string] => [
      match[1] ?? '',
      match[2] ?? ''
    ])
    expect(tableOf(listed)).toStrictEqual(tables.renewal)
  })

  it('has a store sentence in the specification that equals the data file', () => {
    // Scenario: the sentence lists the stores of each origin; every other value is `other`.
    const sentence = sentenceStarting(text, 'Store maps to origin:')
    const body = sentence.replace('Store maps to origin:', '').split('; every other value')[0] ?? ''
    expect(tableOf(specClausePairs(body))).toStrictEqual(tables.store)
  })

  it('names, in the specification, what a value no row lists maps to', () => {
    // Scenario: the fallbacks of the data file are the ones the specification states.
    expect(text).toContain('| `incomplete`, `unknown` | `unknown`')
    expect(text).toContain('the others to `unknown`')
    expect(text).toContain('every other value to `other`')
    expect(tables.unlisted).toStrictEqual({ status: 'unknown', renewal: 'unknown', store: 'other' })
  })

  it('has tables in code that equal the data file', () => {
    // Scenario: the code cannot drift from the data without this failing.
    expect(Object.fromEntries(STATUS_TABLE)).toStrictEqual(tables.status)
    expect(Object.fromEntries(RENEWAL_TABLE)).toStrictEqual(tables.renewal)
    expect(Object.fromEntries(ORIGIN_TABLE)).toStrictEqual(tables.store)
  })

  it('maps into the closed sets of the model only', () => {
    // Scenario: every target of every row is a member of the model's set.
    expect(
      Object.values(tables.status).every((v) => SUBSCRIPTION_STATUSES.some((s) => s === v))
    ).toBe(true)
    expect(Object.values(tables.renewal).every((v) => WILL_RENEW_VALUES.some((s) => s === v))).toBe(
      true
    )
    expect(
      Object.values(tables.store).every((v) => SUBSCRIPTION_ORIGINS.some((s) => s === v))
    ).toBe(true)
  })

  it.each(Object.entries(tables.renewal))('maps the renewal status %s to %s', (from, to) => {
    // Scenario: one case per row of the renewal table.
    expect(mapWillRenew(from)).toBe(to)
  })

  it.each(Object.entries(tables.store))('maps the store %s to %s', (from, to) => {
    // Scenario: one case per row of the store table.
    expect(mapOrigin(from)).toBe(to)
  })

  it.each([
    'requires_price_increase_consent',
    'has_already_renewed',
    'something_new',
    '',
    'WILL_RENEW',
    '__proto__',
    'constructor',
    'toString'
  ])('maps the renewal status %j, which no row lists, to the fallback', (from) => {
    // Scenario: values the table does not list, including names an object would inherit.
    expect(mapWillRenew(from)).toBe(tables.unlisted.renewal)
  })

  it.each([
    'amazon',
    'external',
    'roku',
    'galaxy',
    'test_store',
    'something_new',
    '',
    'APP_STORE',
    '__proto__',
    'constructor'
  ])('maps the store %j, which no row lists, to the fallback', (from) => {
    // Scenario: stores the table does not list, including names an object would inherit.
    expect(mapOrigin(from)).toBe(tables.unlisted.store)
  })

  it.each([undefined, null, 1, true, {}, []])(
    'maps the value %j that is not a string to the fallbacks',
    (value) => {
      // Scenario: a response with a field of the wrong type is read as unknown, never thrown on.
      expect(mapWillRenew(value)).toBe(tables.unlisted.renewal)
      expect(mapOrigin(value)).toBe(tables.unlisted.store)
      expect(mapStatus(value, true)).toBe(tables.unlisted.status)
    }
  )

  it.each([...Object.entries(tables.status).filter(([from]) => !from.startsWith('in_'))])(
    'maps the status %s to %s whatever the access flag says',
    (from, to) => {
      // Scenario: only a billing issue follows the flag; every other row is the table's.
      for (const flag of [true, false, undefined, 'yes']) {
        expect(mapStatus(from, flag)).toBe(to)
      }
    }
  )

  it.each(['something_new', '', 'ACTIVE', '__proto__', 'constructor'])(
    'maps the status %j, which no row lists, to the fallback with either flag',
    (from) => {
      // Scenario: an unlisted status is unknown; the access flag does not rescue it into a status.
      expect(mapStatus(from, true)).toBe(tables.unlisted.status)
      expect(mapStatus(from, false)).toBe(tables.unlisted.status)
    }
  )
})
