/**
 * @fileoverview Unit tests for reading the raw body of a request.
 *
 * Goal: the bytes the parser kept are returned as they are, and a request without them is told
 * apart as one with no body to keep or one whose application did not enable the raw body.
 * Mocks: none.
 * @layer core
 */
import { readRawBody } from './raw-body'

describe('readRawBody', () => {
  it('returns the very buffer the parser kept', () => {
    // Scenario: the bytes are not copied or re-encoded, so a signature over them still matches.
    const rawBody = Buffer.from('{"a": 1,  "b":2}')
    const reading = readRawBody({ rawBody, body: { a: 1, b: 2 } })
    expect(reading.kind).toBe('present')
    expect(reading.kind === 'present' && reading.bytes).toBe(rawBody)
  })

  it('returns an empty body that the parser kept', () => {
    // Scenario: an empty buffer is still bytes, which the adapter will refuse.
    const rawBody = Buffer.alloc(0)
    expect(readRawBody({ rawBody })).toStrictEqual({ kind: 'present', bytes: rawBody })
  })

  it.each([
    ['no body at all', undefined],
    ['a null body', null],
    ['an empty object', {}],
    ['an empty array', []],
    ['an empty string', ''],
    ['a string', 'text'],
    ['a number', 0]
  ])('reports a request with %s as missing', (_name, body) => {
    // Scenario: nothing was parsed, so the absence of bytes is a property of the request.
    expect(readRawBody({ body })).toStrictEqual({ kind: 'missing' })
  })

  it.each([
    ['an object', { a: 1 }],
    ['an array', [1]]
  ])('reports a parsed body that is %s, with no bytes, as unconfigured', (_name, body) => {
    // Scenario: a parser ran and kept no bytes, so the application did not enable the raw body.
    expect(readRawBody({ body })).toStrictEqual({ kind: 'unconfigured' })
  })

  it('does not accept bytes that are not a buffer', () => {
    // Scenario: a Uint8Array that is not a Buffer is not what the framework sets, so it is not read.
    const impostor = new Uint8Array([1, 2, 3])
    expect(readRawBody({ rawBody: impostor })).toStrictEqual({ kind: 'missing' })
  })
})
