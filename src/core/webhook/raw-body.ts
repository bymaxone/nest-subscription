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
}

/**
 * What a request holds of its raw body. `present` carries the bytes. `missing` means the request
 * has no body a parser read, whatever its headers declare: a body of a content type no parser
 * reads is `missing`, left to the verifier as empty bytes. `unconfigured` means a parser produced
 * a value and no bytes were kept, which happens when the application was created without
 * `rawBody: true`.
 */
export type RawBodyReading =
  | { readonly kind: 'present'; readonly bytes: Uint8Array }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unconfigured' }

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
  return request.body === undefined ? { kind: 'missing' } : { kind: 'unconfigured' }
}
