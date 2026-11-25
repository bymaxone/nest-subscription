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
 * has no body a parser could keep, whatever the application's setting: a body of another content
 * type, or none. `unconfigured` means a parser ran and parsed the body and no bytes were kept,
 * which only happens when the application was created without `rawBody: true`.
 */
export type RawBodyReading =
  | { readonly kind: 'present'; readonly bytes: Uint8Array }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unconfigured' }

/** Whether a body parser produced something from the request. */
function wasParsed(body: unknown): boolean {
  return typeof body === 'object' && body !== null && Object.keys(body).length > 0
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
  return wasParsed(request.body) ? { kind: 'unconfigured' } : { kind: 'missing' }
}
