# The raw request body for the webhook route

A billing source signs the exact bytes it sends. The library verifies that signature over those bytes, before anything is parsed, so the receiver needs the request body as it arrived. NestJS parses a JSON body into an object and, unless asked, discards the bytes. A body rebuilt with `JSON.stringify` is not the body that was signed (key order, spacing and number formatting can differ), so a signature check over it fails or, worse, passes for the wrong reason. This guide shows how to keep the bytes, what the library does when they are missing, and what a host on Fastify does.

It applies to both forms of the receiver: the controller the library mounts (`webhookController: true` with a `webhookPath`) and the processor a host calls from its own route (`WebhookProcessor.process`).

## Express (the NestJS default)

Create the application with the `rawBody` option. NestJS then keeps the bytes of every body its parser reads on `request.rawBody`, as a `Buffer`.

```ts
// main.ts
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  await app.listen(3000)
}

void bootstrap()
```

Two conditions, both from the NestJS documentation on [raw body](https://docs.nestjs.com/faq/raw-body):

- The option works only while NestJS's built-in body parser is on. Do not set `bodyParser: false`.
- By default only the `json` and `urlencoded` parsers are registered. A body of another content type is not read by any parser, so no bytes are kept for it. If a source sends another type, register a parser for it with `app.useBodyParser(...)` (for example `app.useBodyParser('text')`), which also respects `rawBody`.

The default limit of the Express JSON parser is `100kb`; raise it with `app.useBodyParser('json', { limit: '1mb' })` if a source can send a larger notification.

### With the library's controller

Nothing else is needed. The controller reads `request.rawBody` and hands the bytes and the headers to the adapter.

### With a route the host owns

A route reads the bytes from the request itself, with the `RawBodyRequest` type from `@nestjs/common`, and passes them to the processor. The outcome becomes the HTTP answer the source expects through `toHttpAnswer`.

```ts
// billing-webhook.controller.ts
import { Controller, Inject, Post, Req, Res, type RawBodyRequest } from '@nestjs/common'
import type { Request, Response } from 'express'
import { WebhookProcessor, toHttpAnswer } from '@bymax-one/nest-subscription'

@Controller('webhooks')
export class BillingWebhookController {
  constructor(@Inject(WebhookProcessor) private readonly processor: WebhookProcessor) {}

  @Post('billing')
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Res({ passthrough: true }) response: Response
  ): Promise<unknown> {
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(', ') : value
      ])
    )
    const answer = toHttpAnswer(
      await this.processor.process({ rawBody: request.rawBody ?? new Uint8Array(), headers })
    )
    response.status(answer.status)
    return answer.body
  }
}
```

A multi-tenant host cannot mount the library's controller (the tenant must come from the host's own knowledge of the request, never from the body), so it uses a route like this one and passes the tenant as the second argument: `this.processor.process({ rawBody, headers }, { tenantId })`.

Keep the route outside the host's authentication guard, since the source cannot log in as a user and the adapter verifies the request itself, and inside the host's rate limiting.

## What breaks without it

| Situation                                                                                                  | What the library does                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A body was parsed and no bytes were kept (the application was created without `rawBody: true`)             | The controller answers `503` with `SUBSCRIPTION_SOURCE_UNAVAILABLE` and does not verify the request. The source retries, and the first such request logs one warning that names the option. Nothing is stored and no access changes until the option is turned on. |
| There is no body for a parser to read (an empty body, a content type no parser reads, `bodyParser: false`) | The controller hands the adapter an empty body, which the adapter refuses like any other malformed request: `401` with `SUBSCRIPTION_WEBHOOK_REFUSED`.                                                                                                             |
| The body is not valid JSON and the framework's parser rejects it                                           | The framework answers before the controller runs, usually with `400`. That answer is the framework's, outside the uniform refusal of a failed check.                                                                                                               |

The limit of the first row: it is detected at the first request that carries a body, not at boot, because NestJS keeps the bytes only for a body its parser reads, so the library cannot know beforehand that the option is missing. The way to find out before production is to send one signed notification to the deployed route and read the answer (a test of the host can build one with the signed request builders of the `testing` subpath).

## Fastify

The library's controller is written and tested for Express only. A host on Fastify mounts no controller and calls the processor from its own route.

Create the application with the Fastify adapter and the same `rawBody` option (NestJS documentation, [raw body](https://docs.nestjs.com/faq/raw-body)); the bytes are again on `request.rawBody`, typed through `RawBodyRequest<FastifyRequest>`. By default Fastify's parser reads `application/json` and `application/x-www-form-urlencoded`; register another content type with `app.useBodyParser('text/plain')`. Fastify's default body limit is 1 MiB.

```ts
// main.ts
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'

import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    rawBody: true
  })
  await app.listen(3000, '0.0.0.0')
}

void bootstrap()
```

```ts
// billing-webhook.controller.ts
import { Controller, Inject, Post, Req, Res, type RawBodyRequest } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { WebhookProcessor, toHttpAnswer } from '@bymax-one/nest-subscription'

@Controller('webhooks')
export class BillingWebhookController {
  constructor(@Inject(WebhookProcessor) private readonly processor: WebhookProcessor) {}

  @Post('billing')
  async receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<unknown> {
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(', ') : value
      ])
    )
    const answer = toHttpAnswer(
      await this.processor.process({ rawBody: request.rawBody ?? new Uint8Array(), headers })
    )
    void reply.status(answer.status)
    return answer.body
  }
}
```

The Fastify route is documented from the framework's own page and is not exercised by this repository's tests, which use Express. Run the signed test notification against it before relying on it.

## Checking it

One signed request proves the setup: send a notification the source signs (RevenueCat's event types include `TEST`, which names no account) and expect `200`. What a failure means depends on the route.

- **On the library's controller**, a `503` with `SUBSCRIPTION_SOURCE_UNAVAILABLE` (and one logged warning) means a body was parsed and its bytes were not kept, so `rawBody: true` is missing. A `401` with `SUBSCRIPTION_WEBHOOK_REFUSED` means the bytes were kept or there was no body for a parser to read, and the request failed a check (a wrong secret, a stale timestamp, an altered body, or a content type no parser reads).
- **On a route the host owns**, a `401` does **not** tell the two apart. The route in this guide passes `request.rawBody ?? new Uint8Array()`: when the bytes were not kept, the adapter receives an empty body and answers the same `401`, with no warning, as it does for a bad secret. Only the library's controller makes the distinction, because it looks at `request.body` as well (`src/core/webhook/raw-body.ts`). A host-owned route that wants the same signal makes it itself, before it calls the processor:

```ts
// Inside the route, before `processor.process(...)`: a body was parsed and no bytes were kept.
if (request.rawBody === undefined && request.body !== undefined) {
  response.status(503)
  return { code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE' }
}
```

Without that line, check a host-owned route by sending a request that must pass (a correctly signed one, built with the `testing` subpath's request builders) and failing the deployment if it is refused.
