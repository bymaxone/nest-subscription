/**
 * @fileoverview The webhook receiver end to end, in both forms: the library's controller and a
 * host route that calls the processor. The same cases run against each, with requests sent as raw
 * bytes: every refusal gets one identical answer and changes nothing, an event is processed once,
 * events in reverse order leave the source's state, a slow source is a temporary failure whose
 * retry is processed, a payload's own state is never applied, and nothing of a request reaches a
 * log or an observer payload.
 * @layer e2e
 */
import { encodeAccountKey, toHttpAnswer } from '@bymax-one/nest-subscription'
import { assertNoSentinel } from '@bymax-one/nest-subscription/testing'

import {
  ACCOUNT,
  CONTROLLER_ROUTE,
  DEADLINE_MS,
  DIRECT_ROUTE,
  NOTIFICATION,
  START,
  buildWebhookApp,
  heard,
  send,
  signed,
  subscribed,
  until,
  type Delivery,
  type WebhookApp
} from './fixtures/webhook-app'

const REFUSED = toHttpAnswer({ kind: 'refused' })
const FORMS: ReadonlyArray<readonly [string, string]> = [
  ['the controller', CONTROLLER_ROUTE],
  ['the processor on a host route', DIRECT_ROUTE]
]

describe.each(FORMS)('webhook receiver through %s', (_form, route) => {
  let app: WebhookApp

  beforeEach(async () => {
    app = await buildWebhookApp()
  })

  afterEach(async () => {
    await app.app.close()
  })

  /** Every way a request fails a check, each as the delivery that makes it. */
  const REFUSALS: ReadonlyArray<readonly [string, (current: WebhookApp) => Delivery]> = [
    [
      'a forged signature',
      (current) => ({ ...signed(current), headers: { 'x-fake-signature': 'f'.repeat(64) } })
    ],
    ['no signature header', (current) => ({ bytes: signed(current).bytes })],
    [
      'a body altered after signing',
      (current) => {
        const delivery = signed(current)
        return {
          ...delivery,
          bytes: Buffer.from(delivery.bytes.toString().replace('acc-1', 'acc-9'))
        }
      }
    ],
    ['an unsigned body that is not a notification', () => ({ bytes: Buffer.from('{"a":1}') })],
    ['an empty body', () => ({ bytes: Buffer.alloc(0) })]
  ]

  it.each(REFUSALS)('answers %s with the one refusal and changes nothing', async (_name, build) => {
    // Scenario: the request fails a check; the answer is the shared refusal (status, body and
    // headers), and the store, the source and the hook are untouched (AC02).
    const reference = await send(app, route, { bytes: Buffer.alloc(0) })
    const answer = await send(app, route, build(app))
    expect(answer.status).toBe(401)
    expect(answer.body).toStrictEqual(REFUSED.body)
    expect(answer.headers).toStrictEqual(reference.headers)
    expect(app.source.totalReads).toBe(0)
    expect(await app.store.getSnapshot(encodeAccountKey(ACCOUNT))).toBeNull()
    expect(app.hook).toHaveBeenCalledTimes(0)
  })

  it('answers a signed body of a content type no parser reads with the one refusal', async () => {
    // Scenario: the bytes are sent but no parser keeps them; the adapter gets empty bytes and
    // refuses, so the answer is the refusal of every other failed check, and nothing is read,
    // recorded or stored.
    const reference = await send(app, route, { bytes: Buffer.alloc(0) })
    const verify = jest.spyOn(app.source, 'verifyWebhook')
    const answer = await send(app, route, { ...signed(app), contentType: 'text/plain' })
    expect(answer.status).toBe(401)
    expect(answer.body).toStrictEqual(REFUSED.body)
    expect(answer.headers).toStrictEqual(reference.headers)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify.mock.calls[0]?.[0].rawBody).toStrictEqual(new Uint8Array())
    expect(app.source.totalReads).toBe(0)
    expect(await app.store.getSnapshot(encodeAccountKey(ACCOUNT))).toBeNull()
  })

  it('processes a signed notification and stores the source state', async () => {
    // Scenario: a good request ends in the stored state of the source, and the host hook is told.
    app.source.setAccount(ACCOUNT, subscribed('acc-1', '2026-01-01T00:00:10.000Z'))
    const answer = await send(app, route, signed(app))
    expect(answer.status).toBe(200)
    expect(answer.body).toStrictEqual({ outcome: 'processed', accounts: 1 })
    const stored = await app.store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(stored?.snapshot.subscriptions).toHaveLength(1)
    await new Promise((resolve) => setImmediate(resolve))
    expect(app.hook).toHaveBeenCalledTimes(1)
  })

  it('does not store the subscription a signed payload claims', async () => {
    // Scenario: the signed payload claims an active subscription; the source says there is none.
    const claimed = { ...NOTIFICATION, subscriptions: [{ status: 'active', givesAccess: true }] }
    const answer = await send(app, route, signed(app, claimed))
    const stored = await app.store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(answer.status).toBe(200)
    expect(stored?.snapshot.subscriptions).toStrictEqual([])
    expect(stored?.snapshot.entitlements).toStrictEqual([])
  })

  it('reads the source once for the same event delivered five times', async () => {
    // Scenario: one event, five deliveries (AC03): one read and one host notification.
    app.source.setAccount(ACCOUNT, subscribed('acc-1', '2026-01-01T00:00:10.000Z'))
    const answers = []
    for (let n = 0; n < 5; n += 1) answers.push(await send(app, route, signed(app)))
    await new Promise((resolve) => setImmediate(resolve))
    expect(answers.map((answer) => answer.status)).toStrictEqual([200, 200, 200, 200, 200])
    expect(answers.map((answer) => (answer.body as { outcome: string }).outcome)).toStrictEqual([
      'processed',
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate'
    ])
    expect(app.source.readCount(ACCOUNT)).toBe(1)
    expect(app.hook).toHaveBeenCalledTimes(1)
  })

  it('reads the source once for the same event delivered five times at once', async () => {
    // Scenario: five simultaneous deliveries while the read is held; exactly one reads.
    app.source.setAccount(ACCOUNT, subscribed('acc-1', '2026-01-01T00:00:10.000Z'))
    const release = app.source.delayNextRead()
    const all = Promise.all([1, 2, 3, 4, 5].map(() => send(app, route, signed(app))))
    await until(() => heard(app) === 4)
    release()
    const answers = await all
    expect(
      answers.filter((answer) => (answer.body as { outcome: string }).outcome === 'processed')
    ).toHaveLength(1)
    expect(app.source.readCount(ACCOUNT)).toBe(1)
  })

  it('leaves the source state when events arrive in reverse order', async () => {
    // Scenario: the newer event is delivered first and the older one after it (AC04); the stored
    // snapshot is the source's current state, never an older one.
    app.source.setAccount(ACCOUNT, subscribed('acc-1', '2026-01-01T00:00:20.000Z'))
    await send(app, route, signed(app, { ...NOTIFICATION, eventId: 'evt-2' }))
    await send(app, route, signed(app, { ...NOTIFICATION, eventId: 'evt-1' }))
    const stored = await app.store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(stored?.snapshot.sourceUpdatedAt).toBe('2026-01-01T00:00:20.000Z')
    expect(stored?.snapshot.subscriptions).toHaveLength(1)
    expect(app.source.readCount(ACCOUNT)).toBe(2)
  })

  it('answers a slow source as a temporary failure before the deadline, and processes the retry', async () => {
    // Scenario: the read is held past the deadline; the answer is 503 at the deadline by the
    // injected clock, and the retry of the same event is processed.
    app.source.setAccount(ACCOUNT, subscribed('acc-1', '2026-01-01T00:00:10.000Z'))
    const mark = jest.spyOn(app.store, 'markEventProcessed')
    const release = app.source.delayNextRead()
    const first = send(app, route, signed(app))
    await until(() => app.source.totalReads === 1)
    app.expire()
    const answer = await first
    expect(answer.status).toBe(503)
    expect(app.clock.now().getTime() - new Date(START).getTime()).toBe(DEADLINE_MS)
    const retry = send(app, route, signed(app))
    await until(() => mark.mock.calls.length === 2)
    release()
    expect((await retry).status).toBe(200)
    expect(app.source.readCount(ACCOUNT)).toBe(1)
  })

  it('answers 503 for a source that cannot be read and 200 for the retry', async () => {
    // Scenario: a failed read frees the event, so the source's retry is processed (D16).
    app.source.failNextRead(new Error('source down'))
    const first = await send(app, route, signed(app))
    const second = await send(app, route, signed(app))
    expect([first.status, second.status]).toStrictEqual([503, 200])
  })

  it('answers 200 and reads nothing for a notification that names no account', async () => {
    // Scenario: an event that concerns nothing is accepted so the source stops retrying it.
    const answer = await send(app, route, signed(app, { ...NOTIFICATION, accountIds: [] }))
    expect(answer.status).toBe(200)
    expect(answer.body).toStrictEqual({ outcome: 'ignored' })
    expect(app.source.totalReads).toBe(0)
  })

  it('does not wait for the host hook', async () => {
    // Scenario: a hook that never returns does not hold the answer.
    app.hook.mockReturnValue(new Promise(() => undefined))
    app.source.setAccount(ACCOUNT, subscribed('acc-1', '2026-01-01T00:00:10.000Z'))
    expect((await send(app, route, signed(app))).status).toBe(200)
  })

  it('keeps every sentinel of the request out of the logs and the observer payloads', async () => {
    // Scenario: sentinels in the account, the event, a header and the body, across every outcome.
    const sentinels = [
      'sentinel-account-1',
      'sentinel-event-1',
      'sentinel-header-1',
      'sentinel-body-1'
    ]
    const notification = {
      ...NOTIFICATION,
      eventId: sentinels[1],
      accountIds: [sentinels[0]],
      note: sentinels[3]
    }
    const withHeader = (delivery: Delivery): Delivery => ({
      ...delivery,
      headers: { ...delivery.headers, authorization: sentinels[2] ?? '' }
    })
    app.source.failNextRead(new Error(sentinels.join(' ')))
    await send(app, route, withHeader(signed(app, notification)))
    await send(app, route, withHeader(signed(app, notification)))
    await send(app, route, withHeader(signed(app, notification)))
    await send(
      app,
      route,
      withHeader({ bytes: Buffer.from(JSON.stringify({ body: sentinels[3] })) })
    )
    await send(
      app,
      route,
      withHeader(signed(app, { ...notification, eventId: 'other', accountIds: [] }))
    )
    assertNoSentinel(app.capture, sentinels)
    const heard = app.capture.payloads
      .filter((entry) => entry.method === 'onWebhook')
      .map((entry) => (entry.payload as { outcome: string }).outcome)
    expect(heard).toStrictEqual(['failed', 'processed', 'duplicate', 'refused', 'ignored'])
  })
})
