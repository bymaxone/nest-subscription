/**
 * @fileoverview The host application every run of the parity suite uses: one protected route, the
 * library's webhook controller with the raw body, a change hook and the in-memory store. It is
 * built from a module configuration it receives and holds no knowledge of which billing source that
 * configuration names, so a case that passes on one source and fails on another can only be a
 * difference in the sources.
 * @layer e2e
 */
import { Controller, Get, UseGuards, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  EntitlementGuard,
  RequiresEntitlement,
  SubscriptionModule,
  SubscriptionService,
  type AccountResolver,
  type SubscriptionChangeNotification,
  type SubscriptionFailPolicy,
  type SubscriptionModuleOptions
} from '@bymax-one/nest-subscription'
import {
  InMemorySubscriptionStore,
  createCapture,
  type Capture,
  type ManualClock
} from '@bymax-one/nest-subscription/testing'

/** The header the host's resolver reads the account from, standing in for its authentication. */
export const PARITY_ACCOUNT_HEADER = 'x-parity-account'

/** The route of the library's webhook controller. */
export const PARITY_WEBHOOK_ROUTE = '/webhooks/billing'

/** The route that needs the `premium` entitlement. */
export const PARITY_PREMIUM_ROUTE = '/premium'

/** The entitlement the protected route needs. */
export const PARITY_ENTITLEMENT = 'premium'

/** The host's resolver: the account is the value of the account header, and none without it. */
const resolveFromHeader: AccountResolver = (context) => {
  const request = context
    .switchToHttp()
    .getRequest<{ headers: Record<string, string | string[] | undefined> }>()
  const value = request.headers[PARITY_ACCOUNT_HEADER]
  const accountId = Array.isArray(value) ? value[0] : value
  return accountId === undefined ? null : { accountId }
}

/** The host's one protected route. */
@Controller()
@UseGuards(EntitlementGuard)
export class ParityController {
  /** Answers when the account holds the entitlement. */
  @Get(PARITY_PREMIUM_ROUTE.slice(1))
  @RequiresEntitlement(PARITY_ENTITLEMENT)
  premium(): { ok: true } {
    return { ok: true }
  }
}

/** What a run receives: the module configuration that differs, and the clock they share. */
export interface ParityConfig {
  /** The billing source, built by the entry of the source list. */
  readonly source: SubscriptionModuleOptions['source']
  /** The clock the library and the source read. */
  readonly clock: ManualClock
  /** What the guard does when it cannot show a snapshot current. Defaults to the library's. */
  readonly failPolicy?: SubscriptionFailPolicy
}

/** The running host application and what a case needs to observe it. */
export interface ParityApp {
  /** The application; its HTTP server answers the requests. */
  readonly app: INestApplication
  /** The service, for a refresh a case asks for. */
  readonly service: SubscriptionService
  /** The calls the host's change hook received, in order. */
  readonly notifications: SubscriptionChangeNotification[]
  /** What the library's logger and observer received. */
  readonly capture: Capture
}

/** Builds the host application over the given module configuration. */
export async function buildParityApp(config: ParityConfig): Promise<ParityApp> {
  const capture = createCapture()
  const notifications: SubscriptionChangeNotification[] = []
  const moduleRef = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source: config.source,
        store: new InMemorySubscriptionStore({ logger: () => undefined }),
        clock: config.clock,
        accountResolver: resolveFromHeader,
        onChange: (notification) => void notifications.push(notification),
        logger: capture.logger,
        observer: capture.observer,
        webhookController: true,
        webhookPath: PARITY_WEBHOOK_ROUTE,
        ...(config.failPolicy === undefined ? {} : { failPolicy: config.failPolicy })
      })
    ],
    controllers: [ParityController]
  }).compile()
  const app = moduleRef.createNestApplication({ rawBody: true })
  await app.init()
  return { app, service: moduleRef.get(SubscriptionService), notifications, capture }
}
