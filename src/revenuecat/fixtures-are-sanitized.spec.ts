/**
 * @fileoverview Sanitization check of the recorded RevenueCat fixtures: no fixture may carry an
 * identifier, a key, a signature or an address that looks real, and the check itself must fail
 * on one that is planted.
 * @layer revenuecat
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// The planted values below are assembled from pieces, so this file holds no literal that the
// repository-wide search for a key or a project identifier would flag.
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'revenuecat')

/**
 * Each pattern names one way a real value shows in a fixture. The hex run needs a letter so that
 * a millisecond timestamp, which is digits only, is not taken for one.
 */
const UNSAFE: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'a RevenueCat resource identifier',
    /\b(?:proj|entl|app|prod|sub|ofr|pkg|rc)[A-Za-z]{0,3}(?=[0-9a-f]*[0-9])[0-9a-f]{8,}\b/
  ],
  ['a run of hexadecimal digits', /\b(?=[0-9a-f]*[a-f])[0-9a-f]{10,}\b/i],
  ['a UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['an API or webhook key', /\b(?:sk|pk|appl|goog|amzn|strp|rcb|whsec)_[A-Za-z0-9]{8,}/],
  ['a bearer token', /Bearer\s+[A-Za-z0-9._-]{8,}/],
  ['an email address', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ['an identifier of the sandbox the recordings came from', /\bns-sbx-/],
  ['an anonymous identifier that is not a placeholder', /\$RCAnonymousID:(?!PLACEHOLDER)[^\s"]/]
]

/** The names of the unsafe things a text holds, in the order of the table above. */
function unsafeIn(text: string): string[] {
  return UNSAFE.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

const files = readdirSync(FIXTURES).filter((name) => name.endsWith('.json') || name.endsWith('.md'))

describe('fixtures are sanitized', () => {
  it('finds the fixtures it is meant to check', () => {
    // Scenario: an empty directory would make every check below pass for no reason.
    expect(files.filter((name) => name.endsWith('.json')).length).toBeGreaterThanOrEqual(30)
  })

  it.each(files)('%s holds nothing that looks real', (name) => {
    // Scenario: one case per file, so a failure names the file.
    expect(unsafeIn(readFileSync(join(FIXTURES, name), 'utf8'))).toStrictEqual([])
  })

  it.each([
    [
      'a project identifier',
      `{"project_id":"${'proj' + '858fe00e'}"}`,
      'a RevenueCat resource identifier'
    ],
    ['an entitlement identifier', '{"id":"entld5ce1b5477"}', 'a RevenueCat resource identifier'],
    [
      'a subscription identifier',
      '{"id":"subPrm49d7419c5918915ae66f66ef369f499d"}',
      'a RevenueCat resource identifier'
    ],
    [
      'a store identifier',
      '{"id":"0c8dc033580f7c5815e334c352d95992"}',
      'a run of hexadecimal digits'
    ],
    [
      'a signature',
      't=1,v1=3f786850e387550fdab836ed7e6dc881de23001b',
      'a run of hexadecimal digits'
    ],
    ['a UUID', '{"id":"CD489E0E-5D52-4E03-966B-A7F17788E432"}', 'a UUID'],
    ['a secret key', `{"key":"${'sk' + '_AbCdEfGh12345678'}"}`, 'an API or webhook key'],
    ['a bearer token', 'Authorization: Bearer abcdefghijkl', 'a bearer token'],
    ['an email address', '{"email":"person@example.com"}', 'an email address'],
    [
      'a sandbox customer',
      '{"id":"ns-sbx-customer-a"}',
      'an identifier of the sandbox the recordings came from'
    ],
    [
      'a real anonymous identifier',
      '{"id":"$RCAnonymousID:abc123"}',
      'an anonymous identifier that is not a placeholder'
    ]
  ])('refuses %s', (_label, planted, expected) => {
    // Scenario: a planted value of each kind must be named, or the check could pass on anything.
    expect(unsafeIn(planted)).toContain(expected)
  })

  it('does not take a millisecond timestamp or a placeholder for a real value', () => {
    // Scenario: the false positives the patterns were written to avoid.
    expect(
      unsafeIn(
        '{"at":1795646388861,"id":"sub_PLACEHOLDER_1","p":"proj_PLACEHOLDER","a":"$RCAnonymousID:PLACEHOLDER"}'
      )
    ).toStrictEqual([])
  })
})
