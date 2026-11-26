/**
 * @fileoverview A NestJS application with both forms of the receiver: the library's controller at
 * `/webhooks/billing` and a host route at `/direct` that calls the processor itself. The
 * application is created with the raw body enabled, the source is the fake one, the store is the
 * in-memory one, time is a manual clock, the host's hook is a mock and the deadline's wait is one
 * a test expires by hand. Requests are sent as raw bytes.
 * @layer e2e
 */
import {
  Controller,
  Inject,
  Post,
  Req,
  Res,
  type INestApplication,
  type RawBodyRequest
} from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import request from 'supertest'
import {
  SubscriptionModule,
  WebhookProcessor,
  toHttpAnswer,
  type SubscriptionChangeNotification,
  type AccountReference,
  type SourceNotification,
  type SubscriptionModuleOptions,
  type SubscriptionStore
} from '@bymax-one/nest-subscription'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock,
  createCapture,
  type Capture
} from '@bymax-one/nest-subscription/testing'
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { watch } from '../setup/sentinel-sweep'
import { WEBHOOK_WAIT, type DeadlineWait } from '../../../src/core/webhook/deadline'

/** The route of the library's controller. */
export const CONTROLLER_ROUTE = '/webhooks/billing'
/** The route of the host's own route that calls the processor. */
export const DIRECT_ROUTE = '/direct'
/** The header the host route reads the tenant from, standing in for its authentication. */
export const TENANT_HEADER = 'x-test-tenant'
/** The instant every test starts at. */
export const START = '2026-01-01T00:00:00.000Z'
/** The deadline the application is configured with, in milliseconds. */
export const DEADLINE_MS = 5000

/** The request headers a route hands the processor, as Express keeps them. */
interface IncomingHeaders {
  headers: Record<string, string | string[] | undefined>
}

/** The host's route: it hands the processor the bytes and headers and answers as the library does. */
@Controller('direct')
export class DirectProcessorController {
  constructor(@Inject(WebhookProcessor) private readonly processor: WebhookProcessor) {}

  /** Receives a delivery. */
  @Post()
  async receive(
    @Req() request: RawBodyRequest<IncomingHeaders>,
    @Res({ passthrough: true }) response: { status(code: number): unknown }
  ): Promise<unknown> {
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(', ') : value
      ])
    )
    const tenantId = headers[TENANT_HEADER]
    const answer = toHttpAnswer(
      await this.processor.process(
        { rawBody: request.rawBody ?? new Uint8Array(), headers },
        tenantId === undefined ? {} : { tenantId }
      )
    )
    response.status(answer.status)
    return answer.body
  }
}

/** The running application and what a test needs to arrange and observe it. */
export interface WebhookApp {
  /** The application; its HTTP server answers the requests. */
  readonly app: INestApplication
  /** The compiled testing module, for what a test needs to resolve from it. */
  readonly moduleRef: TestingModule
  /** The fake source. */
  readonly source: FakeSubscriptionSource
  /** The in-memory store the application reads and writes through `options.store`. */
  readonly store: InMemorySubscriptionStore
  /** The clock every part reads. */
  readonly clock: ManualClock
  /** What the logger and the observer received. */
  readonly capture: Capture
  /** The host's change hook. */
  readonly hook: jest.Mock<unknown, [SubscriptionChangeNotification]>
  /** Ends the deadline wait that is running, moving the clock by the deadline. */
  readonly expire: () => void
}

/** A subscription that gives access. */
export const RECORD: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: 'P1M',
  currentPeriodStart: START,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** The source's state of an account: one subscription that gives access, as of an instant. */
export function subscribed(accountId: string, sourceUpdatedAt: string): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId, source: 'fake', fetchedAt: START }),
    sourceUpdatedAt,
    subscriptions: [RECORD]
  }
}

/** Builds the application. `raw` turns the raw body on; the options override the defaults. */
export async function buildWebhookApp(
  options: {
    raw?: boolean
    module?: Partial<SubscriptionModuleOptions>
    source?: FakeSubscriptionSource
    wrapStore?: (store: InMemorySubscriptionStore) => SubscriptionStore
    wait?: DeadlineWait | 'timer'
  } = {}
): Promise<WebhookApp> {
  const source = options.source ?? new FakeSubscriptionSource({ clock: new ManualClock(START) })
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(START)
  const capture = createCapture()
  watch(capture)
  const hook = jest.fn<unknown, [SubscriptionChangeNotification]>()
  let expire = (): void => undefined
  const manual: DeadlineWait = (milliseconds) =>
    new Promise<void>((resolve) => {
      expire = () => {
        clock.advance(milliseconds)
        resolve()
      }
    })
  const builder = Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source,
        store: options.wrapStore?.(store) ?? store,
        clock,
        accountResolver: () => null,
        onChange: hook,
        logger: capture.logger,
        observer: capture.observer,
        webhookController: true,
        webhookPath: CONTROLLER_ROUTE,
        webhookDeadlineMs: DEADLINE_MS,
        ...options.module
      })
    ],
    controllers: [DirectProcessorController]
  })
  const wait = options.wait ?? manual
  const moduleRef = await (
    wait === 'timer' ? builder : builder.overrideProvider(WEBHOOK_WAIT).useValue(wait)
  ).compile()
  const app = moduleRef.createNestApplication({ rawBody: options.raw ?? true })
  await app.init()
  return { app, source, store, moduleRef, clock, capture, hook, expire: () => expire() }
}

/** The account most cases are about. */
export const ACCOUNT: AccountReference = { accountId: 'sentinel-acc-1' }

/** The notification most cases deliver. */
export const NOTIFICATION: SourceNotification = {
  eventId: 'evt-1',
  accountIds: ['sentinel-acc-1'],
  kind: 'RENEWAL',
  eventTime: START,
  environment: 'production'
}

/** One delivery: raw bytes, a content type and headers. */
export interface Delivery {
  readonly bytes: Buffer
  readonly contentType?: string
  readonly headers?: Record<string, string>
}

/** Sends a delivery as raw bytes and returns the status, the body and the headers but the date. */
export async function send(
  app: WebhookApp,
  route: string,
  delivery: Delivery
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  let call = request(app.app.getHttpServer()).post(route)
  call = call.set('Content-Type', delivery.contentType ?? 'application/json')
  for (const [name, value] of Object.entries(delivery.headers ?? {})) call = call.set(name, value)
  // The bytes are UTF-8 text, and a string is written to the socket as it is; a Buffer sent with a
  // JSON content type would be serialized as an object by the client.
  const response = await call.send(delivery.bytes.toString('utf8'))
  const headers = { ...response.headers } as Record<string, string>
  delete headers['date']
  return { status: response.status, body: response.body as unknown, headers }
}

/** The delivery the fake source accepts for a notification. */
export function signed(app: WebhookApp, notification: object = NOTIFICATION): Delivery {
  const built = app.source.buildRequest(notification as SourceNotification)
  return {
    bytes: Buffer.from(built.rawBody),
    headers: { 'x-fake-signature': built.headers['x-fake-signature'] ?? '' }
  }
}

/** Lets the event loop turn until the condition holds; no timer is involved. */
export async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 2000 && !condition(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  expect(condition()).toBe(true)
}

/** How many webhook outcomes the observer has heard. */
export function heard(app: WebhookApp): number {
  return app.capture.payloads.filter((entry) => entry.method === 'onWebhook').length
}
