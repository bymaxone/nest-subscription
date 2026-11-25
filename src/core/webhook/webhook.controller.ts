/**
 * @fileoverview The optional webhook controller: one POST route, mounted by the module only when
 * the host turns it on, that hands the exact bytes of the request body and its headers to the
 * processor and answers with what the processor's outcome maps to. It adds no logic of its own to
 * the receiver; it only adapts HTTP.
 * @layer core
 */
import {
  Controller,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  type RawBodyRequest,
  type Type
} from '@nestjs/common'

import { SUBSCRIPTION_OPTIONS, type WebhookRequest } from '@bymax-one/nest-subscription/internal'

import { readRawBody } from './raw-body'
import { toHttpAnswer, type WebhookAnswer } from './webhook-outcome'
import { WebhookProcessor } from './webhook.processor'
import { logEvent } from '../logging/subscription-logger'
import { ObserverBridge } from '../observer/observer-bridge'
import type { ResolvedSubscriptionOptions } from '../options/subscription-options.types'

/** The parts of an incoming request the controller reads. */
type IncomingRequest = RawBodyRequest<{
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly body?: unknown
}>

/** The part of the response the controller writes: the status. The body is the return value. */
interface OutgoingResponse {
  /** Sets the HTTP status of the answer. */
  status(code: number): unknown
}

/** The request headers as the source port wants them: one string per name, or `undefined`. */
function headersOf(request: IncomingRequest): WebhookRequest['headers'] {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      typeof value === 'string' || value === undefined ? value : value.join(', ')
    ])
  )
}

/**
 * Receives a source's webhook over HTTP. Mount it with the module options `webhookController` and
 * `webhookPath`; it is off by default and registers no route otherwise.
 *
 * The application must be created with `rawBody: true` so the bytes the source signed reach the
 * adapter unchanged. NestJS only keeps them for a body its parser reads, so whether they are kept
 * cannot be known before the first request: a request that carries a body and arrives without
 * its bytes, whether a parser produced a value or the headers declare a body no parser read, is
 * answered with a temporary failure and never verified, so the source retries until the host
 * enables the raw body, and the first such request logs one warning (D44). A request with no
 * body at all is handed to the adapter as an empty body, which it refuses like any other
 * malformed request.
 *
 * The controller is written and tested for the Express adapter, the NestJS default. A host on
 * another adapter calls {@link WebhookProcessor} from its own route instead.
 *
 * An answer the framework's body parser gives before the controller runs, such as a rejection of a
 * body that is not valid JSON, is outside the uniform refusal of a failed check (D45); the
 * controller answers every request that reaches it as described above.
 *
 * The controller applies no guard of this library. The route must stay outside the host's
 * authentication guard, because the source cannot authenticate as a user and the adapter verifies
 * the request itself, and inside the host's rate limiting, so a flood of forged requests is
 * limited before it costs a verification.
 */
@Injectable()
export class SubscriptionWebhookController {
  #warned = false

  constructor(
    @Inject(WebhookProcessor) private readonly processor: WebhookProcessor,
    @Inject(ObserverBridge) private readonly observer: ObserverBridge,
    @Inject(SUBSCRIPTION_OPTIONS) private readonly options: ResolvedSubscriptionOptions
  ) {}

  /**
   * Handles one delivery. The status is the processor outcome's; the body is its fixed answer.
   *
   * @param request The request, with the raw body NestJS kept.
   * @param response The response, whose status is set here.
   * @returns The body of the answer.
   */
  @Post()
  async receive(
    @Req() request: IncomingRequest,
    @Res({ passthrough: true }) response: OutgoingResponse
  ): Promise<WebhookAnswer['body']> {
    const answer = await this.#answer(request)
    response.status(answer.status)
    return answer.body
  }

  /** The answer to one request. */
  async #answer(request: IncomingRequest): Promise<WebhookAnswer> {
    const reading = readRawBody(request)
    if (reading.kind === 'unconfigured') return this.#unconfigured()
    const bytes = reading.kind === 'present' ? reading.bytes : new Uint8Array()
    return toHttpAnswer(
      await this.processor.process({ rawBody: bytes, headers: headersOf(request) })
    )
  }

  /** The answer when the application kept no raw body: a failure the source will retry. */
  #unconfigured(): WebhookAnswer {
    this.observer.webhook('failed', this.observer.mark(), false)
    if (!this.#warned) {
      this.#warned = true
      logEvent(this.options.logger, 'webhook_raw_body_missing', null, null)
    }
    return toHttpAnswer({ kind: 'failed' })
  }
}

/**
 * The controller class mounted at a route. NestJS fixes a controller's route when the class is
 * decorated, so each route gets a subclass of its own.
 *
 * @param path The route, already validated.
 * @returns A class to list among a module's controllers.
 */
export function webhookControllerAt(path: string): Type<SubscriptionWebhookController> {
  class MountedWebhookController extends SubscriptionWebhookController {}
  Controller(path)(MountedWebhookController)
  return MountedWebhookController
}
