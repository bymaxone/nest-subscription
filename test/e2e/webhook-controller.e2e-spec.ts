/**
 * @fileoverview The webhook controller end to end: no route unless the host switches it on, one
 * POST route at the host's path, the exact bytes reaching the adapter, a repeated header joined,
 * the route given to `forRootAsync`, and what an application without the raw body does.
 * @layer e2e
 */
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { SubscriptionModule } from '@bymax-one/nest-subscription'
import type { SourceNotification } from '@bymax-one/nest-subscription'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore
} from '@bymax-one/nest-subscription/testing'

import { CONTROLLER_ROUTE, START, buildWebhookApp } from './fixtures/webhook-app'

const NOTIFICATION: SourceNotification = {
  eventId: 'evt-1',
  accountIds: ['acc-1'],
  kind: 'RENEWAL',
  eventTime: START,
  environment: 'production'
}

describe('webhook controller', () => {
  it('registers no route when the switch is off', async () => {
    // Scenario: with the controller off, a POST to the path the host never configured is a 404.
    const built = await buildWebhookApp({ module: { webhookController: false } })
    const response = await request(built.app.getHttpServer()).post(CONTROLLER_ROUTE).send('{}')
    expect(response.status).toBe(404)
    await built.app.close()
  })

  it('registers one POST route at the configured path and no other method', async () => {
    // Scenario: a GET to the route finds nothing, and a POST reaches the receiver.
    const built = await buildWebhookApp()
    const server = built.app.getHttpServer()
    expect((await request(server).get(CONTROLLER_ROUTE)).status).toBe(404)
    expect((await request(server).post(CONTROLLER_ROUTE).send('{}')).status).toBe(401)
    await built.app.close()
  })

  it('hands the adapter the exact bytes it received, whitespace and key order included', async () => {
    // Scenario: a body whose formatting a re-serialization would change reaches verification as sent.
    const built = await buildWebhookApp()
    const verify = jest.spyOn(built.source, 'verifyWebhook')
    const sent = '{ "z":1,\n  "a" : [1,  2] }'
    await request(built.app.getHttpServer())
      .post(CONTROLLER_ROUTE)
      .set('Content-Type', 'application/json')
      .send(sent)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(Buffer.from(verify.mock.calls[0]?.[0].rawBody ?? []).toString('utf8')).toBe(sent)
    await built.app.close()
  })

  it('joins a header that arrives as a list', async () => {
    // Scenario: a header sent twice reaches the adapter as one string.
    const built = await buildWebhookApp()
    const verify = jest.spyOn(built.source, 'verifyWebhook')
    await request(built.app.getHttpServer())
      .post(CONTROLLER_ROUTE)
      .set('Content-Type', 'application/json')
      .set({ 'Set-Cookie': ['a=1', 'b=2'] })
      .send('{}')
    expect(verify.mock.calls[0]?.[0].headers['set-cookie']).toBe('a=1, b=2')
    await built.app.close()
  })

  it('answers a failure and warns once when the application did not enable the raw body', async () => {
    // Scenario: the application was created without the raw body; a parsed request is a temporary
    // failure, the adapter is never asked, and one warning is logged however many arrive.
    const built = await buildWebhookApp({ raw: false })
    const verify = jest.spyOn(built.source, 'verifyWebhook')
    const server = built.app.getHttpServer()
    const send = (): request.Test =>
      request(server)
        .post(CONTROLLER_ROUTE)
        .set('Content-Type', 'application/json')
        .send('{"id":"x"}')
    expect((await send()).status).toBe(503)
    expect((await send()).status).toBe(503)
    expect(verify).toHaveBeenCalledTimes(0)
    expect(built.capture.lines).toHaveLength(1)
    await built.app.close()
  })

  it('refuses a request with no body a parser could keep like any other failed check', async () => {
    // Scenario: without the raw body but with nothing parsed, the answer is the refusal, so a
    // caller cannot tell the application's setting from it.
    const built = await buildWebhookApp({ raw: false })
    const response = await request(built.app.getHttpServer())
      .post(CONTROLLER_ROUTE)
      .set('Content-Type', 'text/plain')
      .send('hello')
    expect(response.status).toBe(401)
    await built.app.close()
  })

  it('leaves a body that is not valid JSON to the framework, which answers before the controller', async () => {
    // Scenario: with a JSON content type the framework's parser rejects the text with its own
    // answer; the adapter is never asked.
    const built = await buildWebhookApp()
    const verify = jest.spyOn(built.source, 'verifyWebhook')
    const response = await request(built.app.getHttpServer())
      .post(CONTROLLER_ROUTE)
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(response.status).toBe(400)
    expect(verify).toHaveBeenCalledTimes(0)
    await built.app.close()
  })

  it('serves the route given to forRootAsync', async () => {
    // Scenario: a module configured by a factory mounts the controller at its static route.
    const source = new FakeSubscriptionSource()
    const moduleRef = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRootAsync({
          webhookPath: 'async/hooks',
          useFactory: () => ({
            source,
            store: new InMemorySubscriptionStore({ logger: () => undefined }),
            accountResolver: () => null
          })
        })
      ]
    }).compile()
    const app = moduleRef.createNestApplication({ rawBody: true })
    await app.init()
    const built = source.buildRequest(NOTIFICATION)
    const response = await request(app.getHttpServer())
      .post('/async/hooks')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', built.headers['x-fake-signature'] ?? '')
      .send(Buffer.from(built.rawBody).toString('utf8'))
    expect(response.status).toBe(200)
    expect(source.totalReads).toBe(1)
    await app.close()
  })
})
