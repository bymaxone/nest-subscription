/**
 * @fileoverview Reads the unparsed request body the way NestJS exposes it: the bytes the body
 * parser saw, kept on the request as `rawBody` when the application is created with
 * `rawBody: true`. The bytes are never rebuilt from a parsed body, because a re-serialized body
 * does not match the signature computed over what was sent.
 * @layer core
 */

/** The parts of an HTTP request the reading looks at; an Express request has them. */
export interface RawBodyCarrier {
  /** The bytes the body parser read; set only when the application enables the raw body. */
  readonly rawBody?: unknown
  /** What the body parser made of the body; unset when no parser ran. */
  readonly body?: unknown
  /** The request headers; they say whether a body was sent. */
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
}

/**
 * What a request holds of its raw body. `present` carries the bytes. `missing` means the request
 * carries no body at all. `unconfigured` means a body was sent and no bytes were kept: a parser
 * produced a value of any type, or the headers declare a body no parser read. That happens when
 * the application was created without `rawBody: true`, and also for a body of a content type no
 * parser reads.
 */
export type RawBodyReading =
  | { readonly kind: 'present'; readonly bytes: Uint8Array }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unconfigured' }

/** Whether the headers say a body was sent: a length above zero, or any transfer encoding. */
function declaresBody(headers: RawBodyCarrier['headers']): boolean {
  return Number(headers['content-length']) > 0 || headers['transfer-encoding'] !== undefined
}

/**
 * Reads the raw body of a request. Fastify keeps it in the same property under the same
 * application option, but the controller is built and tested for Express only; a host on another
 * adapter calls the processor from its own route.
 *
 * @param request The request, as NestJS hands it to a route.
 * @returns The bytes, or why there are none.
 */
export function readRawBody(request: RawBodyCarrier): RawBodyReading {
  const { rawBody } = request
  if (Buffer.isBuffer(rawBody)) return { kind: 'present', bytes: rawBody }
  // Express 5's body parser leaves `req.body` undefined for a request it did not parse, so a
  // value of any type, an empty object included, means a parser ran and kept no bytes.
  const sent = request.body !== undefined || declaresBody(request.headers)
  return sent ? { kind: 'unconfigured' } : { kind: 'missing' }
}
