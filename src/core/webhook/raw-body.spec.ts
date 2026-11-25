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
    const reading = readRawBody({ rawBody, body: { a: 1, b: 2 }, headers: {} })
    expect(reading.kind).toBe('present')
    expect(reading.kind === 'present' && reading.bytes).toBe(rawBody)
  })

  it('returns an empty body that the parser kept', () => {
    // Scenario: an empty buffer is still bytes, which the adapter will refuse.
    const rawBody = Buffer.alloc(0)
    expect(readRawBody({ rawBody, headers: {} })).toStrictEqual({ kind: 'present', bytes: rawBody })
  })

  it.each([
    ['no body and no length', { headers: {} }],
    ['a declared length of zero', { headers: { 'content-length': '0' } }],
    ['a length that is not a number', { headers: { 'content-length': 'abc' } }],
    ['a negative length', { headers: { 'content-length': '-1' } }],
    ['an undefined transfer encoding', { headers: { 'transfer-encoding': undefined } }]
  ])('reports a request with %s as missing', (_name, request) => {
    // Scenario: nothing was parsed and nothing declares a body, so there is genuinely no body.
    expect(readRawBody(request)).toStrictEqual({ kind: 'missing' })
  })

  it.each([
    ['an object', { a: 1 }],
    ['an empty object', {}],
    ['an array', [1]],
    ['an empty array', []],
    ['an empty string from a text parser', ''],
    ['a string from a text parser', 'text'],
    ['a buffer from a raw parser', Buffer.alloc(0)],
    ['a number', 0],
    ['null', null]
  ])('reports a parsed body that is %s, with no bytes, as unconfigured', (_name, body) => {
    // Scenario: a parser produced a value and kept no bytes, whatever the value is, so the
    // application did not keep the raw body.
    expect(readRawBody({ body, headers: {} })).toStrictEqual({ kind: 'unconfigured' })
  })

  it.each([
    ['a length', { 'content-length': '12' }],
    ['a transfer encoding', { 'transfer-encoding': 'chunked' }]
  ])('reports a request that declares %s and was not parsed as unconfigured', (_name, headers) => {
    // Scenario: the headers say a body was sent and no parser produced a value or kept bytes.
    expect(readRawBody({ headers })).toStrictEqual({ kind: 'unconfigured' })
  })

  it('prefers the bytes a parser kept to anything the headers say', () => {
    // Scenario: bytes in hand are used whatever the length header declares.
    const rawBody = Buffer.from('x')
    expect(readRawBody({ rawBody, headers: { 'content-length': '0' } })).toStrictEqual({
      kind: 'present',
      bytes: rawBody
    })
  })

  it('does not accept bytes that are not a buffer', () => {
    // Scenario: a Uint8Array that is not a Buffer is not what the framework sets, so it is not read.
    const impostor = new Uint8Array([1, 2, 3])
    expect(readRawBody({ rawBody: impostor, headers: {} })).toStrictEqual({ kind: 'missing' })
    expect(readRawBody({ rawBody: impostor, body: {}, headers: {} })).toStrictEqual({
      kind: 'unconfigured'
    })
  })
})
