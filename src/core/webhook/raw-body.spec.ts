/**
 * @fileoverview Unit tests for reading the raw body of a request.
 *
 * Goal: the bytes the parser kept are returned as they are, and a request without them is told
 * apart as one with no body to keep or one whose application did not enable the raw body.
 * Mocks: none.
 * @layer core
 */
import { readRawBody } from './raw-body'

/**
 * A request as Express hands it over. The reading looks at the kept bytes and the parsed body
 * only; the headers are here to show that what they declare changes nothing.
 */
interface SentRequest {
  rawBody?: unknown
  body?: unknown
  headers?: Record<string, string | undefined>
}

/** Reads a request that may carry headers the reading is meant to ignore. */
function read(request: SentRequest): ReturnType<typeof readRawBody> {
  return readRawBody(request)
}

describe('readRawBody', () => {
  it('returns the very buffer the parser kept', () => {
    // Scenario: the bytes are not copied or re-encoded, so a signature over them still matches.
    const rawBody = Buffer.from('{"a": 1,  "b":2}')
    const reading = read({ rawBody, body: { a: 1, b: 2 } })
    expect(reading.kind).toBe('present')
    expect(reading.kind === 'present' && reading.bytes).toBe(rawBody)
  })

  it('returns an empty body that the parser kept', () => {
    // Scenario: an empty buffer is still bytes, which the adapter will refuse.
    const rawBody = Buffer.alloc(0)
    expect(read({ rawBody })).toStrictEqual({ kind: 'present', bytes: rawBody })
  })

  it.each([
    ['nothing at all', {}],
    ['no length', { headers: {} }],
    ['a declared length of zero', { headers: { 'content-length': '0' } }],
    ['a declared length no parser read', { headers: { 'content-length': '12' } }],
    ['a declared transfer encoding no parser read', { headers: { 'transfer-encoding': 'chunked' } }]
  ])('reports a request with %s and nothing parsed as missing', (_name, request) => {
    // Scenario: no parser produced a value and no bytes were kept, whatever the headers declare:
    // the body is left to the verifier as empty bytes, and the application is not blamed.
    expect(read({ ...request, body: undefined })).toStrictEqual({ kind: 'missing' })
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
    expect(read({ body })).toStrictEqual({ kind: 'unconfigured' })
  })

  it('prefers the bytes a parser kept to anything the headers say', () => {
    // Scenario: bytes in hand are used whatever the length header declares.
    const rawBody = Buffer.from('x')
    expect(read({ rawBody, headers: { 'content-length': '0' } })).toStrictEqual({
      kind: 'present',
      bytes: rawBody
    })
  })

  it('does not accept bytes that are not a buffer', () => {
    // Scenario: a Uint8Array that is not a Buffer is not what the framework sets, so it is not read.
    const impostor = new Uint8Array([1, 2, 3])
    expect(read({ rawBody: impostor })).toStrictEqual({ kind: 'missing' })
    expect(read({ rawBody: impostor, body: {} })).toStrictEqual({ kind: 'unconfigured' })
  })
})
