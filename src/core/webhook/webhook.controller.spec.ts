/**
 * @fileoverview Unit tests for the webhook controller.
 *
 * Goal: the controller hands the exact bytes and the headers to the processor, answers with the
 * status and body of the outcome, tells a request without bytes from a misconfigured application,
 * and is mounted at the route it is given.
 * Mocks: the processor's `process` is replaced; requests and responses are plain objects, so no
 * server is started.
 * @layer core
 */
import type { SubscriptionStore } from '@bymax-one/nest-subscription/internal'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock,
  createCapture
} from '@bymax-one/nest-subscription/testing'

import { ObserverBridge } from '../observer/observer-bridge'
import { resolveOptions } from '../options/resolve-options'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { timerWait } from './deadline'
import { SubscriptionWebhookController, webhookControllerAt } from './webhook.controller'
import { WebhookProcessor } from './webhook.processor'
import { toHttpAnswer, type WebhookOutcome } from './webhook-outcome'

/** A request as Express hands it to a route, with only what the controller reads. */
interface FakeRequest {
  headers: Record<string, string | string[] | undefined>
  rawBody?: Buffer
  body?: unknown
}

/** The pieces of one controller. */
function build(
  adapterType: string | null = 'express',
  withHost = true
): {
  controller: SubscriptionWebhookController
  process: jest.SpyInstance
  capture: ReturnType<typeof createCapture>
  status: jest.Mock
} {
  const source = new FakeSubscriptionSource()
  const store: SubscriptionStore = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock()
  const capture = createCapture()
  const options = resolveOptions({
    source,
    store,
    clock,
    accountResolver: () => null,
    logger: capture.logger,
    observer: capture.observer
  })
  const bridge = new ObserverBridge(options.observer, clock)
  const refresher = new SnapshotRefresher(source, store, clock, null, null, bridge)
  const processor = new WebhookProcessor(
    source,
    store,
    clock,
    options,
    refresher,
    bridge,
    timerWait
  )
  const process = jest
    .spyOn(processor, 'process')
    .mockResolvedValue({ kind: 'processed', accounts: 1 })
  const controller = new SubscriptionWebhookController(processor, bridge, options)
  return { controller, process, capture, status: jest.fn() }
}

const SIGNED = Buffer.from('{"id": "evt-1",  "spacing":  "kept"}')

describe('SubscriptionWebhookController receive', () => {
  it('hands the very bytes it received and the headers to the processor', async () => {
    // Scenario: the buffer the parser kept reaches the processor as the same object, untouched.
    const { controller, process, status } = build()
    await controller.receive(
      { headers: { 'x-signature': 'abc', authorization: undefined }, rawBody: SIGNED, body: {} },
      { status }
    )
    expect(process).toHaveBeenCalledTimes(1)
    const request = process.mock.calls[0]?.[0]
    expect(request.rawBody).toBe(SIGNED)
    expect(request.headers).toStrictEqual({ 'x-signature': 'abc', authorization: undefined })
  })

  it('joins a header that arrived more than once', async () => {
    // Scenario: the port wants one string per header, so repeated values are joined in order.
    const { controller, process, status } = build()
    await controller.receive({ headers: { 'x-multi': ['a', 'b'] }, rawBody: SIGNED }, { status })
    expect(process.mock.calls[0]?.[0].headers).toStrictEqual({ 'x-multi': 'a, b' })
  })

  it('keeps a header named like an object property as data', async () => {
    // Scenario: a hostile header name becomes an own property and changes no prototype.
    const { controller, process, status } = build()
    const headers = JSON.parse('{"__proto__": "x"}') as FakeRequest['headers']
    await controller.receive({ headers, rawBody: SIGNED }, { status })
    const received = process.mock.calls[0]?.[0].headers
    expect(Object.getPrototypeOf(received)).toBe(Object.prototype)
    expect(Object.keys(received)).toStrictEqual(['__proto__'])
  })

  const OUTCOMES: ReadonlyArray<readonly [WebhookOutcome]> = [
    [{ kind: 'processed', accounts: 3 }],
    [{ kind: 'duplicate' }],
    [{ kind: 'ignored' }],
    [{ kind: 'refused' }],
    [{ kind: 'failed' }]
  ]

  it.each(OUTCOMES)(
    'answers a %j outcome with the status and body toHttpAnswer gives',
    async (outcome) => {
      // Scenario: one row per outcome; the status written and the body returned are the mapping's.
      const { controller, process, status } = build()
      process.mockResolvedValue(outcome)
      const body = await controller.receive({ headers: {}, rawBody: SIGNED }, { status })
      expect(status).toHaveBeenCalledTimes(1)
      expect(status).toHaveBeenCalledWith(toHttpAnswer(outcome).status)
      expect(body).toStrictEqual(toHttpAnswer(outcome).body)
    }
  )

  it('hands an empty body to the processor when the request has no body to keep', async () => {
    // Scenario: a request whose body no parser read is refused by the adapter, like any other.
    const { controller, process, status } = build()
    await controller.receive({ headers: {}, body: undefined }, { status })
    expect(process.mock.calls[0]?.[0].rawBody).toStrictEqual(new Uint8Array())
  })

  it('answers a failure, and does not call the processor, when the raw body is not enabled', async () => {
    // Scenario: a parser ran and no bytes were kept; the source is told to retry, and nothing is
    // verified from bytes rebuilt out of the parsed body.
    const { controller, process, status } = build()
    const body = await controller.receive({ headers: {}, body: { id: 'evt-1' } }, { status })
    expect(process).toHaveBeenCalledTimes(0)
    expect(status).toHaveBeenCalledWith(503)
    expect(body).toBe(toHttpAnswer({ kind: 'failed' }).body)
  })

  it('logs one warning for two such requests and reports each to the observer', async () => {
    // Scenario: the warning is a fixed sentence written once; the observer hears every failure.
    const { controller, capture, status } = build()
    const request = { headers: {}, body: { id: 'evt-1' } }
    await controller.receive(request, { status })
    await controller.receive(request, { status })
    expect(capture.lines).toStrictEqual([
      'A webhook request arrived without its raw body; create the application with rawBody: true: unclassified.'
    ])
    expect(capture.payloads.map((entry) => entry.payload)).toStrictEqual([
      { outcome: 'failed', durationMs: 0, retained: false },
      { outcome: 'failed', durationMs: 0, retained: false }
    ])
  })
})

describe('webhookControllerAt', () => {
  it('mounts a controller at the route it is given', () => {
    // Scenario: the route is the class's path metadata, set when the class is decorated.
    const mounted = webhookControllerAt('hooks/billing')
    expect(Reflect.getMetadata('path', mounted)).toBe('hooks/billing')
  })

  it('gives each route a class of its own, and leaves the base class unmounted', () => {
    // Scenario: two routes do not share a class, and the exported class has no route.
    const first = webhookControllerAt('a')
    const second = webhookControllerAt('b')
    expect(first).not.toBe(second)
    expect(Reflect.getMetadata('path', first)).toBe('a')
    expect(Reflect.getMetadata('path', second)).toBe('b')
    expect(Reflect.getMetadata('path', SubscriptionWebhookController)).toBeUndefined()
  })

  it('inherits the POST route of the base class', () => {
    // Scenario: the mounted class serves the one receiving route.
    const mounted = webhookControllerAt('hooks/billing')
    const method = Reflect.getMetadata('method', mounted.prototype.receive)
    expect(method).toBe(1)
  })
})
