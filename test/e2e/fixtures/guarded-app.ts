/**
 * @fileoverview A small NestJS application that protects real routes with the library's guard. A
 * stand-in authentication guard copies a test header into the request, the host's resolver reads
 * the account from there, and the library's guard never reads a header itself. The store is a
 * failing store over the in-memory one, the source is the fake one and time is a manual clock.
 * @layer e2e
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  Injectable,
  Post,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  type INestApplication
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
  EntitlementGuard,
  RequiresEntitlement,
  SubscriptionModule,
  SubscriptionService,
  encodeAccountKey
} from '@bymax-one/nest-subscription'
import type {
  AccountReference,
  AccountResolver,
  ResolvedAccount,
  SubscriptionModuleOptions
} from '@bymax-one/nest-subscription'
import {
  resolveEntitlements,
  type SubscriptionRecord,
  type SubscriptionSnapshot,
  createEmptySnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock,
  createFailingStore,
  type FailingStore
} from '@bymax-one/nest-subscription/testing'

/** The header the stand-in authentication guard reads for the account. */
export const ACCOUNT_HEADER = 'x-test-account'
/** The header the stand-in authentication guard reads for the tenant. */
export const TENANT_HEADER = 'x-test-tenant'
/** The header that makes the resolver answer with the JSON it holds, whatever its shape. */
export const RAW_HEADER = 'x-test-raw'
/** The header that makes the resolver throw: `http:<status>` for an HTTP exception, else an error. */
export const THROW_HEADER = 'x-test-throw'

/** The instant every test starts at, and the one the clock reads before it is moved. */
export const START = '2026-01-01T00:00:00.000Z'

/** What the stand-in authentication guard leaves on a request for the resolver. */
interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>
  testAccount?: { accountId: string; tenantId?: string }
}

/** The first value of a header, or `undefined`. */
function headerOf(request: AuthenticatedRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** Stands in for the host's authentication: it lets every request through and records who it is. */
@Injectable()
export class StandInAuthGuard implements CanActivate {
  /** Copies the account and tenant headers onto the request; allows everything. */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const accountId = headerOf(request, ACCOUNT_HEADER)
    const tenantId = headerOf(request, TENANT_HEADER)
    if (accountId !== undefined) {
      request.testAccount = tenantId === undefined ? { accountId } : { accountId, tenantId }
    }
    return true
  }
}

/** The host's resolver: what the stand-in authentication left, or what a test header dictates. */
export const resolveFromRequest: AccountResolver = (context) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
  const failure = headerOf(request, THROW_HEADER)
  if (failure?.startsWith('http:') === true) {
    throw new HttpException({ hint: 'host refusal' }, Number(failure.slice('http:'.length)))
  }
  if (failure !== undefined) throw new Error('resolver failed')
  const raw = headerOf(request, RAW_HEADER)
  if (raw !== undefined) {
    const parsed: unknown = JSON.parse(raw)
    return parsed as ResolvedAccount | null
  }
  return request.testAccount ?? null
}

/** Routes that need `premium`, one on the handler and one that reads the body to prove it is unused. */
@Controller('premium')
@UseGuards(StandInAuthGuard, EntitlementGuard)
export class PremiumController {
  /** A route with the decorator on its handler. */
  @Get()
  @RequiresEntitlement('premium')
  read(): { ok: true } {
    return { ok: true }
  }

  /** A route whose body names another account; the guard must not read it. */
  @Post()
  @RequiresEntitlement('premium')
  write(@Body() _body: unknown): { ok: true } {
    return { ok: true }
  }

  /** A route in the same controller with no decorator: the guard leaves it alone. */
  @Get('open')
  open(): { ok: true } {
    return { ok: true }
  }
}

/** A controller that names its entitlement on the class, with one handler that overrides it. */
@Controller('basic')
@UseGuards(StandInAuthGuard, EntitlementGuard)
@RequiresEntitlement('basic')
export class BasicController {
  /** Inherits `basic` from the class. */
  @Get()
  read(): { ok: true } {
    return { ok: true }
  }

  /** Overrides the class with `premium`. */
  @Get('premium')
  @RequiresEntitlement('premium')
  readPremium(): { ok: true } {
    return { ok: true }
  }
}

/** A subscription that does or does not give access, granting the entitlement of its name. */
export function subscription(givesAccess: boolean, accessUntil: string | null): SubscriptionRecord {
  return {
    subscriptionReference: 'sub-1',
    status: givesAccess ? 'active' : 'on_hold',
    givesAccess,
    willRenew: 'yes',
    origin: 'web',
    environment: 'production',
    productReference: 'pro',
    billingInterval: 'month',
    currentPeriodStart: START,
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    accessUntil,
    billingIssueSince: givesAccess ? null : START,
    cancelledAt: null,
    refundedAt: null,
    managementReference: null
  }
}

/** A snapshot of an account whose one subscription grants the named entitlement. */
export function snapshotOf(
  account: AccountReference,
  options: {
    givesAccess: boolean
    entitlement: string
    fetchedAt?: string
    accessUntil?: string | null
  }
): SubscriptionSnapshot {
  const record = subscription(options.givesAccess, options.accessUntil ?? null)
  const { entitlements } = resolveEntitlements(
    [record],
    new Map([[record.subscriptionReference, [options.entitlement]]])
  )
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: options.fetchedAt ?? START
    }),
    entitlements,
    subscriptions: [record]
  }
}

/** The running application and what a test needs to arrange and observe it. */
export interface GuardedApp {
  /** The application; its HTTP server answers the requests. */
  readonly app: INestApplication
  /** The fake source: its read counter shows when the source was called. */
  readonly source: FakeSubscriptionSource
  /** The store, switchable to failing. */
  readonly store: FailingStore
  /** The clock every part reads. */
  readonly clock: ManualClock
  /** The service the guard reads through. */
  readonly service: SubscriptionService
  /** The guard, for a case a request cannot make. */
  readonly guard: EntitlementGuard
  /** Writes a snapshot straight into the store, as a past refresh would have. */
  readonly seed: (snapshot: SubscriptionSnapshot) => Promise<void>
}

/** Builds the application with the given option overrides. */
export async function buildGuardedApp(
  overrides: Partial<SubscriptionModuleOptions> = {}
): Promise<GuardedApp> {
  const source = new FakeSubscriptionSource({ clock: new ManualClock(START) })
  const inner = new InMemorySubscriptionStore({ logger: () => undefined })
  const store = createFailingStore(inner)
  const clock = new ManualClock(START)
  const moduleRef = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source,
        store,
        clock,
        accountResolver: resolveFromRequest,
        ...overrides
      })
    ],
    controllers: [PremiumController, BasicController],
    providers: [StandInAuthGuard]
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return {
    app,
    source,
    store,
    clock,
    service: moduleRef.get(SubscriptionService),
    guard: moduleRef.get(EntitlementGuard),
    seed: async (snapshot) => {
      const key = encodeAccountKey({
        accountId: snapshot.accountId,
        ...(snapshot.tenantId === undefined ? {} : { tenantId: snapshot.tenantId })
      })
      await inner.putSnapshot(key, snapshot, [], snapshot.fetchedAt)
    }
  }
}
