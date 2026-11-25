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
  it.each(['post', 'get', 'put', 'patch', 'delete'] as const)(
    'answers 404 to a %s request at the route when the switch is off',
    async (method) => {
      // Scenario: with the controller off nothing is registered at the path, for any of these
      // methods, and the adapter is never asked.
      const built = await buildWebhookApp({ module: { webhookController: false } })
      const verify = jest.spyOn(built.source, 'verifyWebhook')
      const response = await request(built.app.getHttpServer())[method](CONTROLLER_ROUTE).send('{}')
      expect(response.status).toBe(404)
      expect(verify).toHaveBeenCalledTimes(0)
      await built.app.close()
    }
  )

  it('reaches the receiver with a POST to the configured path', async () => {
    // Scenario: a POST with a body nobody signed reaches the receiver and is refused.
    const built = await buildWebhookApp()
    const response = await request(built.app.getHttpServer()).post(CONTROLLER_ROUTE).send('{}')
    expect(response.status).toBe(401)
    await built.app.close()
  })

  it.each(['get', 'put', 'patch', 'delete'] as const)(
    'finds no route at the configured path for a %s request',
    async (method) => {
      // Scenario: only POST is registered, so each of the other methods finds nothing, and the
      // adapter is never asked.
      const built = await buildWebhookApp()
      const verify = jest.spyOn(built.source, 'verifyWebhook')
      const response = await request(built.app.getHttpServer())[method](CONTROLLER_ROUTE).send('{}')
      expect(response.status).toBe(404)
      expect(verify).toHaveBeenCalledTimes(0)
      await built.app.close()
    }
  )

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

  it.each([
    ['an empty object', 'application/json', '{}'],
    ['an empty array', 'application/json', '[]'],
    ['an object', 'application/json', '{"id":"x"}']
  ])(
    'answers a failure without verifying when a body parsed as %s kept no bytes',
    async (_name, contentType, body) => {
      // Scenario: the application did not enable the raw body and a parser produced a value, even
      // an empty one; the adapter is never asked (D44).
      const built = await buildWebhookApp({ raw: false })
      const verify = jest.spyOn(built.source, 'verifyWebhook')
      const response = await request(built.app.getHttpServer())
        .post(CONTROLLER_ROUTE)
        .set('Content-Type', contentType)
        .send(body)
      expect(response.status).toBe(503)
      expect(verify).toHaveBeenCalledTimes(0)
      await built.app.close()
    }
  )

  it.each([true, false])(
    'answers a failure without verifying for a body of a content type no parser reads, with rawBody %s',
    async (raw) => {
      // Scenario: the headers declare a body and no parser kept bytes, whatever the application's
      // raw body setting; the adapter is never asked (D44).
      const built = await buildWebhookApp({ raw })
      const verify = jest.spyOn(built.source, 'verifyWebhook')
      const response = await request(built.app.getHttpServer())
        .post(CONTROLLER_ROUTE)
        .set('Content-Type', 'text/plain')
        .send('hello')
      expect(response.status).toBe(503)
      expect(verify).toHaveBeenCalledTimes(0)
      await built.app.close()
    }
  )

  it('refuses a request with no body at all like any other failed check', async () => {
    // Scenario: nothing is sent and nothing is parsed, so the adapter gets empty bytes and refuses.
    const built = await buildWebhookApp({ raw: false })
    const verify = jest.spyOn(built.source, 'verifyWebhook')
    const response = await request(built.app.getHttpServer()).post(CONTROLLER_ROUTE)
    expect(response.status).toBe(401)
    expect(verify).toHaveBeenCalledTimes(1)
    await built.app.close()
  })

  it('leaves a body that is not valid JSON to the framework, which answers before the controller (D45)', async () => {
    // Scenario: with a JSON content type the framework's parser rejects the text with its own
    // answer, which D45 puts outside the uniform refusal; the adapter is never asked.
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
