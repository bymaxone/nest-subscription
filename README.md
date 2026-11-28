<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--subscription-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-subscription" />
</p>

<h1 align="center">@bymax-one/nest-subscription</h1>

<p align="center">
  <strong>One normalized subscription snapshot per account, for NestJS 11</strong><br />
  <sub>RevenueCat adapter · Entitlement guard · Verified webhooks · Typed change notifications · Management operations · Zero direct dependencies</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-subscription"><img src="https://img.shields.io/npm/v/@bymax-one/nest-subscription?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-subscription"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-subscription?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-subscription/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-subscription/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-100%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score 100%, measured on 2026-11-28" /></a>
  <a href="docs/acceptance.md"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage 100%, measured on 2026-11-26" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/bymaxone/nest-subscription"><img src="https://api.scorecard.dev/projects/github.com/bymaxone/nest-subscription/badge?style=flat-square" alt="OpenSSF Scorecard" /></a>
  <a href="https://github.com/bymaxone/nest-subscription/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-subscription?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-26%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" /></a>
  <a href="https://nestjs.com/"><img src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-subscription">GitHub</a> ·
  <a href="https://github.com/bymaxone/nest-subscription/issues">Issues</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-api-reference">API Reference</a> ·
  <a href="#-security-model">Security Model</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## ✨ Overview

`@bymax-one/nest-subscription` is a NestJS library that answers one question for a backend: _does this account have `premium`, until when, and where did they buy it?_ It keeps a normalized snapshot of each account's subscription, fed by one billing source through an adapter, and exposes it through a service, a route guard and typed change notifications. The host's code is the same whichever source feeds it.

The first release ships the **RevenueCat** adapter. A **Bymax Finance** adapter is planned and is not available: its subpath exists and exports nothing, and it waits for Bymax Finance to publish an API (see [What This Library Does Not Do](#-what-this-library-does-not-do)).

The library has **zero direct dependencies**. NestJS, `reflect-metadata` and `rxjs` are peer dependencies; the RevenueCat adapter uses the runtime's own `fetch` and `node:crypto`, with no provider SDK.

### Why nest-subscription?

- **Access comes from a read of the source, never from a webhook payload.** A verified notification is a trigger: the library reads the account's current state from the source and stores that. Processing the same event twice, or in the wrong order, is harmless.
- **One typed answer.** App Store, Google Play and web purchases become one `SubscriptionSnapshot` with entitlements, status, `givesAccess`, `accessUntil`, origin and environment.
- **The source's own access flag decides.** The guard reads `givesAccess`, not the status name, so a source that keeps access during a grace period is followed and not second-guessed.
- **Honest operations.** Stop renewal, resume, change product, extend and refund report what the source shows after the request, not what was asked, and say plainly when only the person can do it.
- **Fail closed by default.** An unreadable store or a stale snapshot refuses access unless the host chooses `last_known_state` on purpose, and the documentation says what that costs.

---

## 🔥 Features

### Reading and guarding

- A `SubscriptionService` that returns an account's snapshot with its age, and answers "does this account hold this entitlement now?", both from the store and never waiting for the source unless a refresh is requested
- An `@RequiresEntitlement('name')` decorator and an `EntitlementGuard` that take the account from a resolver the host writes, and refuse with a stable code that tells "no subscription" from "a subscription that gives no access"
- Two fail policies, `refuse` (default) and `last_known_state` with a bounded tolerance

### Keeping the snapshot current

- A webhook receiver in two forms: a controller mounted with one switch (off by default), and a processor a host calls from its own route
- Verification of RevenueCat deliveries over the raw bytes: HMAC-SHA256 signature with a timestamp tolerance, the static authorization header, or both
- De-duplication by event identifier, a response deadline, and five outcomes mapped to the HTTP answers RevenueCat expects
- Refresh on demand (concurrent refreshes of one account share one source call), background refresh of stale snapshots, and a reconciliation method the host runs from its own scheduler

### Telling the host

- A change hook with typed changes (`started`, `renewed`, `refunded`, ...), each with a key that is stable for the same change, delivered at least once and redelivered by reconciliation
- An optional observer that receives counters and timings and never an account identifier or a payload

### Managing subscriptions

- Capabilities per subscription, then stop renewal, resume, change product, extend and refund where a server can do it, and the management reference where it cannot

### Testing and quality

- A `testing` subpath: an in-memory store, a scriptable fake source, a manual clock, signed request builders, a capturing logger and a conformance suite for the host's own store
- TypeScript `strict`, no suppression comment in the source, ESM and CommonJS output with declarations for each, verified against the packed tarball

---

## 📦 Subpath Exports

| Subpath            | Import                                    | Purpose                                                                                                                  | Dependencies                     |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| **`.`**            | `@bymax-one/nest-subscription`            | Module, service, guard, decorator, webhook controller and processor, option and result types, ports, tokens, error class | NestJS peers                     |
| **`./shared`**     | `@bymax-one/nest-subscription/shared`     | The model's types, closed value sets, error codes, `createEmptySnapshot`, `resolveEntitlements`, `parseInstant`          | none                             |
| **`./revenuecat`** | `@bymax-one/nest-subscription/revenuecat` | `revenueCatSource`, `signRevenueCatWebhook` and the adapter's option types                                               | none (imports no NestJS package) |
| **`./finance`**    | `@bymax-one/nest-subscription/finance`    | Reserved for the Bymax Finance adapter: **planned, not available**. It exports nothing yet                               | none                             |
| **`./testing`**    | `@bymax-one/nest-subscription/testing`    | In-memory store, fake source, manual clock, request builders, capture helpers, store conformance cases                   | none (imports no NestJS package) |
| `./internal`       | `@bymax-one/nest-subscription/internal`   | Classes and tokens that more than one entry point shares. **Not for hosts**                                              | none                             |

A host loads only the adapter it uses: with one adapter configured, the other adapter's code is never loaded, which the packaging check proves on the packed tarball in ESM and CommonJS.

```
        @bymax-one/nest-subscription        (the module; needs the NestJS peers)
          │        │          │
          ▼        ▼          ▼
   /revenuecat   /testing   /finance (planned, empty)
          │        │
          ▼        ▼
        /internal ───────▶ /shared          (no dependencies)
```

`./shared` can be imported by a client or a worker that has no NestJS package, to share the model's types and the error codes. The entry points are separate bundles that reach `./internal` and `./shared` by package specifier, so `SubscriptionError` is one class and `instanceof` holds across them.

### Peer dependency matrix

| Peer                                            | Range      | Needed by                                                                                                             |
| ----------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/common`                                | `^11.0.16` | the root entry point                                                                                                  |
| `@nestjs/core`                                  | `^11.1.18` | the root entry point                                                                                                  |
| `reflect-metadata`                              | `^0.2.0`   | the root entry point (the application loads it once)                                                                  |
| `rxjs`                                          | `^7.8.0`   | the root entry point                                                                                                  |
| `@bymax-one/nest-cache`, `@bymax-one/nest-core` | optional   | declared so a host on the family resolves compatible ranges; the library imports neither today, and runs without them |

The runtime is **Node.js 26 or newer**. A backend moves to Node.js 26 before it installs this library.

---

## 🚀 Quick Start

```bash
pnpm add @bymax-one/nest-subscription @nestjs/common @nestjs/core reflect-metadata rxjs
```

A host needs five things: the module, a **store**, an **account resolver**, one **protected route** and, for a source that sends webhooks, the **webhook controller with the raw body**.

The resolver tells the guard which account a request belongs to. It reads what the host's own authentication left on the request and never a header or a body the caller controls:

```ts
// account-resolver.ts
import type { AccountResolver } from '@bymax-one/nest-subscription'

/** The host's authentication leaves the signed-in user on the request. */
interface AuthenticatedRequest {
  user?: { id: string }
}

export const accountFromRequest: AccountResolver = (context) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
  return request.user === undefined ? null : { accountId: request.user.id }
}
```

Configure the module with the RevenueCat adapter. The store below is the in-memory one, which is for tests and development only: it persists nothing and shares nothing between processes. A production host implements the store over its own database; [`docs/reference-store.md`](docs/reference-store.md) is a reference for PostgreSQL.

```ts
// app.module.ts
import { Module } from '@nestjs/common'
import { SubscriptionModule } from '@bymax-one/nest-subscription'
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'
import { InMemorySubscriptionStore } from '@bymax-one/nest-subscription/testing'

import { accountFromRequest } from './account-resolver'
import { ReportsController } from './reports.controller'

/** The host reads its own environment; the library reads none. */
function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

@Module({
  imports: [
    SubscriptionModule.forRoot({
      global: true,
      source: revenueCatSource({
        projectId: required('REVENUECAT_PROJECT_ID'),
        apiKey: required('REVENUECAT_API_KEY'),
        webhookSigningSecret: required('REVENUECAT_WEBHOOK_SIGNING_SECRET'),
        isProduction: process.env['NODE_ENV'] === 'production'
      }),
      store: new InMemorySubscriptionStore(),
      accountResolver: accountFromRequest,
      webhookController: true,
      webhookPath: 'webhooks/revenuecat',
      onChange: (notification) => {
        // Make the reaction idempotent on `notification.changes[].key`: delivery is at least once.
        console.log(notification.changes.map((change) => change.kind))
      }
    })
  ],
  controllers: [ReportsController]
})
export class AppModule {}
```

Protect a route with the decorator and the guard:

```ts
// reports.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common'
import { EntitlementGuard, RequiresEntitlement } from '@bymax-one/nest-subscription'

@Controller('reports')
@UseGuards(EntitlementGuard)
export class ReportsController {
  @Get()
  @RequiresEntitlement('premium')
  read(): { ok: true } {
    return { ok: true }
  }
}
```

Create the application with the **raw body** enabled. The source signs the exact bytes it sends, and the receiver verifies them before anything is parsed; without the option the controller answers a temporary failure and verifies nothing. [`docs/raw-body.md`](docs/raw-body.md) has the details, including Fastify.

```ts
// main.ts
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true })
  await app.listen(3000)
}

void bootstrap()
```

Then, in RevenueCat, point a webhook integration at `https://your-host/webhooks/revenuecat` and set its signing secret. Keep the route outside the host's authentication guard, because RevenueCat cannot sign in as a user and the adapter verifies the request itself, and inside the host's rate limiting.

An account with nothing stored is "no subscription" until a webhook arrives or the host calls `refresh`. After the app reports a purchase, call `refresh` for the account instead of waiting for the webhook (see [Refresh and reconciliation](#-refresh-and-reconciliation)).

---

## ⚙️ Configuration

`SubscriptionModule.forRoot(options)` and `SubscriptionModule.forRootAsync({ useFactory, inject, imports, webhookPath })` take the same options. An invalid configuration stops the boot with one `SubscriptionError` (`SUBSCRIPTION_CONFIG_INVALID`) that names every offending option and none of its values. `forRootAsync` takes `webhookPath` beside the factory, because NestJS registers routes before a factory runs.

| Option                                                       | Type                                   | Default          | Meaning                                                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                                                     | `SubscriptionSource`                   | required         | The billing source, as an adapter factory returns it                                                                                                    |
| `store`                                                      | `SubscriptionStore` or injection token | required         | The persistence port, as an instance or the token under which the host provides one                                                                     |
| `accountResolver`                                            | `AccountResolver`                      | required         | Tells the guard which account a request belongs to                                                                                                      |
| `onChange`                                                   | `SubscriptionChangeHook`               | none             | Told about every stored change, at least once. Without a hook no change is stored                                                                       |
| `failPolicy`                                                 | `'refuse'` or `'last_known_state'`     | `'refuse'`       | What the guard does when it cannot show a snapshot current                                                                                              |
| `lastKnownStateToleranceMs`                                  | number                                 | 72 hours         | How old a snapshot may be and still be trusted under `last_known_state`                                                                                 |
| `maxSnapshotAgeMs`                                           | number                                 | 24 hours         | The age after which a snapshot is refreshed in the background on its next read                                                                          |
| `cache`, `cacheTtlMs`                                        | `SubscriptionCache`, number            | none, 30 seconds | An optional string cache in front of the store                                                                                                          |
| `observer`                                                   | `SubscriptionObserver`                 | none             | Counters and timings                                                                                                                                    |
| `logger`                                                     | `SubscriptionLogger`                   | NestJS `Logger`  | Where warnings go: a fixed sentence, an error code and, at most, a short salted hash of the account                                                     |
| `eventRetentionMs`                                           | number                                 | 7 days           | How long processed event identifiers are kept for de-duplication                                                                                        |
| `webhookDeadlineMs`                                          | number                                 | 30 seconds       | How long the receiver works on one notification before it answers with a temporary failure (at most 60 seconds)                                         |
| `webhookController`                                          | boolean                                | `false`          | Mounts the webhook controller. Needs `webhookPath` and cannot be combined with `multiTenant`                                                            |
| `webhookPath`                                                | string                                 | none             | The route of the controller, chosen by the host                                                                                                         |
| `multiTenant`                                                | boolean                                | `false`          | The tenant becomes part of every key and must come from the authenticated request                                                                       |
| `allowSandbox`, `confirmSandboxInProduction`, `isProduction` | boolean                                | `false`          | See [Security Model](#sandbox-purchases-sec07); on the module they are validated at boot, and `allowSandbox` set here must match what the source admits |
| `clock`                                                      | `Clock`                                | system clock     | The time source; a test passes `ManualClock`                                                                                                            |
| `global`, `imports`                                          | boolean, modules                       | `false`, none    | As for any NestJS dynamic module                                                                                                                        |

The options of `revenueCatSource`:

| Option                                                       | Meaning                                                                                                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`, `apiKey`                                        | The RevenueCat project and a version 2 secret key                                                                                                                                         |
| `apiKeyV1`                                                   | A version 1 secret key, needed for exactly two operations (Google Play stop renewal and Google Play one-time-purchase refund). A version 2 key is refused by version 1                    |
| `webhookSigningSecret`, `webhookAuthorization`               | The signing secret and the `Authorization` value RevenueCat sends. Setting one turns its check on; with neither, every webhook is refused. Each takes a string or `{ current, previous }` |
| `signatureToleranceMs`                                       | How far a signature's timestamp may be from now. Default 5 minutes, at most 1 hour                                                                                                        |
| `requestTimeoutMs`                                           | How long one request to RevenueCat may take. Default 10 seconds, at most 60 seconds                                                                                                       |
| `baseUrl`                                                    | The address of the REST API; HTTPS, or plain HTTP to a loopback address (for a local stand-in)                                                                                            |
| `allowSandbox`, `confirmSandboxInProduction`, `isProduction` | Sandbox handling of the adapter, see the Security Model                                                                                                                                   |
| `fetch`, `clock`, `logger`, `onUnidentifiedEvent`            | The `fetch` to call, the time source, a warning logger, and a callback with no identifier for an event that names only anonymous users                                                    |

Secrets are held in a `Secret` that prints `[Secret]` to JSON, `util.inspect` and spread. A secret is read back only by a deliberate call.

---

## 🛂 Reading and guarding

The service answers from the store:

```ts
import { Injectable } from '@nestjs/common'
import { SubscriptionService } from '@bymax-one/nest-subscription'

@Injectable()
export class PlanService {
  constructor(private readonly subscriptions: SubscriptionService) {}

  async summary(accountId: string): Promise<{ premium: boolean; ageMs: number }> {
    const snapshot = await this.subscriptions.getSnapshot({ accountId })
    const premium = await this.subscriptions.hasEntitlement({ accountId }, 'premium')
    return { premium, ageMs: snapshot.ageMs }
  }
}
```

- `getSnapshot(account)` returns the stored snapshot, deeply frozen, with `ageMs`. An account with nothing stored reads as an account with no entitlements and no subscriptions. A snapshot older than `maxSnapshotAgeMs` is returned as stored and refreshed in the background; a failure of that refresh is logged and reported to the observer and never reaches the caller.
- `hasEntitlement(account, name)` is true when the entitlement's active flag, which the source's access flag gave it, is true and its `until` is `null` or later than now by the library's clock.
- In a multi-tenant host every call needs `tenantId` in the account reference.

**The guard.** `@RequiresEntitlement('premium')` marks a handler or a controller (a handler's decorator overrides its class's). `EntitlementGuard` takes the account from the resolver, never from a body, a query or a header it chose to read, and answers:

| Situation                                                                                     | Status  | `code`                              |
| --------------------------------------------------------------------------------------------- | ------- | ----------------------------------- |
| The account holds the entitlement and its subscription gives access                           | allowed | none                                |
| The request has no account (the resolver answered `null`, or anything that is not an account) | `401`   | `SUBSCRIPTION_UNAUTHENTICATED`      |
| The account has no subscription, or not this entitlement                                      | `403`   | `SUBSCRIPTION_ENTITLEMENT_REQUIRED` |
| A subscription exists and gives no access (for example on hold)                               | `403`   | `SUBSCRIPTION_NO_ACCESS`            |
| The snapshot cannot be shown current and the policy refuses                                   | `503`   | `SUBSCRIPTION_SOURCE_UNAVAILABLE`   |

The body of a refusal is the catalogue's code and fixed message and nothing else: no account, tenant or entitlement name. An HTTP exception the host's own resolver throws (status 400 to 599) passes through unchanged.

**The fail policy, and its limit.** The guard never waits for the source. `refuse` (default) denies access when the store cannot be read or the stored snapshot is older than `maxSnapshotAgeMs`. `last_known_state` trusts a stored snapshot that is strictly younger than `lastKnownStateToleranceMs` (72 hours by default) when it cannot be shown current. That **extends access during an outage, including for an account whose subscription was refunded or cancelled during it**, until the snapshot is refreshed or ages past the tolerance. Choose it only where that exposure is acceptable. A store that answers with no record is not a failure: the account has no subscription, and both values refuse it as such.

---

## 🪝 Webhooks

A notification is a trigger, not the truth. On a verified notification the library reads the named accounts from the source and stores what it reads; it never applies the payload's state.

Mount the controller with `webhookController: true` and a `webhookPath`, and create the application with `rawBody: true` ([guide](docs/raw-body.md)). A host that owns its routing, or is multi-tenant, or runs on Fastify, calls `WebhookProcessor.process({ rawBody, headers }, { tenantId })` from its own route and turns the outcome into an answer with `toHttpAnswer`. The controller is written and tested for Express.

| Outcome     | Meaning                                                                             | HTTP |
| ----------- | ----------------------------------------------------------------------------------- | ---- |
| `processed` | New event; every account it names was read from the source and stored               | 200  |
| `duplicate` | The event identifier was recorded already; the source was not read                  | 200  |
| `ignored`   | Verified, and it names no account (for example a `TEST` event)                      | 200  |
| `refused`   | Any check failed. One status and one body, whatever the cause                       | 401  |
| `failed`    | The source could not be read in time. The identifier is forgotten so the retry runs | 503  |

What this covers, and what it does not:

- **De-duplication is by event identifier and is not a lock on state.** The identifier is recorded when processing starts, for `eventRetentionMs`. Reconciliation purges older identifiers; nothing else purges them, so a host that never runs reconciliation never purges. Keep the retention longer than the longest span in which the source can deliver an event again (RevenueCat retries for about 80 minutes and allows a manual resend with no stated limit).
- **A failed event's identifier is forgotten in the background.** The removal is started before the failed answer and is never awaited, so a slow store cannot hold the answer past the deadline. While that removal is in flight the processor remembers the event in memory (up to a bound, oldest out) and answers a retry as a failure at once. **A `forgetEvent` that never settles keeps retries of that event at `503` on that instance until a restart or until the event is evicted from that memory.** The memory belongs to one process: a retry that lands on another instance while the removal is in flight may find the identifier recorded and be answered as already seen until the retention purges it.
- **A retry of a timed-out webhook reads the source twice.** The deadline answers a temporary failure and the work is not cancelled.
- **An answer the framework's body parser gives** before the controller runs, such as a rejection of invalid JSON, is outside the uniform refusal.

RevenueCat specifics: the `Authorization` value and the signature (`X-RevenueCat-Webhook-Signature`, HMAC-SHA256 over `<timestamp>.<raw body>`) are checked when configured, and a request passes only if every configured method passes. With only the static header configured, `revenueCatSource` warns once when it is created, through its `logger` option; with no `logger` the warning is not written. **Rotating the signing secret or the authorization value takes effect immediately on RevenueCat's side**: it offers no overlap of two valid secrets, so deliveries sent between the rotation and the host's restart with the new value are refused and retried by RevenueCat. Setting `{ current, previous }` lets the host accept both values on its side during that gap, and does not make RevenueCat sign with two.

---

## 🔄 Refresh and reconciliation

```ts
import { Injectable } from '@nestjs/common'
import { SubscriptionService } from '@bymax-one/nest-subscription'

@Injectable()
export class SubscriptionJobs {
  constructor(private readonly subscriptions: SubscriptionService) {}

  // Where the last run stopped, so the next call goes on from there instead of starting over.
  // Kept in memory here; a host with several instances keeps them where all instances read them.
  private cursor: string | null = null
  private pendingCursor: string | null = null

  /** Called by the host's own scheduler, one run per call. */
  async reconcileBatch(): Promise<void> {
    const result = await this.subscriptions.reconcile({
      cursor: this.cursor,
      pendingCursor: this.pendingCursor,
      batchSize: 100,
      maxCallsPerSecond: 10,
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    })
    this.cursor = result.cursor
    this.pendingCursor = result.pendingCursor
  }

  /** After the app reports a purchase. */
  async afterPurchase(accountId: string): Promise<void> {
    await this.subscriptions.refresh({ accountId })
  }
}
```

- `refresh(account)` reads the source and returns the snapshot the store holds afterwards. Concurrent refreshes of one account share one source call. **The host's `refresh` joins a read already in flight for the account**, so the snapshot it returns may have been read before the call; a webhook's read, and the reads of a management operation, start after their call instead.
- `reconcile(options)` refreshes the accounts whose snapshot was fetched before a threshold (`olderThanMs`, default `maxSnapshotAgeMs`), at most `batchSize` per run (default 100) and at most `maxCallsPerSecond` source reads in any second (default 10). It also delivers the changes still marked as not delivered and purges event identifiers past the retention. The result carries two independent cursors, and the host passes both back to go on: `cursor` for the stale snapshots, `null` only when that listing is exhausted, and `pendingCursor` for the redelivery of pending changes, `null` when that listing is exhausted or no change hook is set. Each run redelivers at most `batchSize` accounts, starting from the `pendingCursor` it is given; a host that passes only `cursor` starts every run at the first account with pending changes. The rate is kept per run, not across runs: run one at a time, because concurrent runs add their rates together.
- Reconciliation is what covers a lost webhook. It runs only when the host calls it.

---

## 🔔 Change notifications

```ts
import type { SubscriptionChangeNotification } from '@bymax-one/nest-subscription'

/** The hook the host passes as `onChange`. */
async function onSubscriptionChange(notification: SubscriptionChangeNotification): Promise<void> {
  for (const change of notification.changes) {
    // `change.key` is the same every time the same change is reported: use it to be idempotent.
    console.log(change.kind, change.key, notification.redelivery)
  }
}
```

Changes are `started`, `renewed`, `trial_converted`, `will_not_renew`, `will_renew_again`, `entered_grace`, `put_on_hold`, `recovered`, `paused`, `resumed`, `product_changed`, `expired`, `refunded`, `transferred` and `overlap_detected`. They are computed by comparing the stored snapshot with the new one, so a webhook payload never decides what changed.

- **Delivery is at least once, not exactly once.** The changes are stored with the snapshot, in the same write, marked as not delivered, and cleared only after the hook returns. A hook that throws, a crash between the write and the call, and a failure to clear all leave them pending, and the next reconciliation run calls the hook again with the same keys and `redelivery: true`. A redelivery carries the current snapshot and no previous one. The host's reaction must be idempotent on `changes[].key`. Redelivery happens only when the host calls `reconcile`, and each run redelivers at most `batchSize` accounts: an account whose hook keeps failing stays pending and stays in the listing, so a host that does not carry `pendingCursor` from one run to the next restarts at the first account every time, and with more than `batchSize` such accounts the later ones are never redelivered.
- **A hook that throws is contained.** The failure is logged by its error code and reported to the observer; it never reaches the operation that stored the change.
- **A change hook must not await `reconcile()`.** Reconciliation delivers pending changes, including the ones this hook is being called for, so a hook that waits for a run waits on its own pending changes and they are delivered again.
- The hook is never awaited inside the webhook's response deadline.

An optional **observer** receives `onRefresh`, `onSourceError`, `onCacheLookup`, `onGuardDecision`, `onChangeDelivery`, `onWebhook` and `onBackgroundRefreshFailure`. Its payloads hold counts, outcomes, durations and error codes, and no account identifier and no payload.

---

## 🛠️ Management operations

```ts
import type { SubscriptionService } from '@bymax-one/nest-subscription'

async function stopRenewal(
  subscriptions: SubscriptionService,
  accountId: string,
  subscriptionReference: string
): Promise<string> {
  const capabilities = await subscriptions.getCapabilities({ accountId }, subscriptionReference)
  if (!capabilities.possible.stop_renewal) {
    return `Manage it at ${capabilities.managementReference ?? 'the store'}`
  }
  const result = await subscriptions.stopRenewal({ accountId }, subscriptionReference)
  switch (result.outcome) {
    case 'stopped':
      return 'The renewal is stopped'
    case 'not_stopped':
      return 'The source accepted, and the read-back still shows a renewing subscription'
    case 'person_must_act':
      return `Manage it at ${result.managementReference ?? 'the store'}`
    case 'unconfirmed':
      return 'Accepted, effect unknown: do not repeat before a later read shows the record'
  }
}
```

`getCapabilities`, `getManagementReference`, `stopRenewal`, `resume`, `changeProduct`, `extend` and `refund` act only on a subscription or a non-renewing purchase found inside the caller's own stored snapshot; a reference of another account or tenant is refused as `SUBSCRIPTION_ACCOUNT_UNKNOWN` and reaches no source.

- **The result is the snapshot read back, never the request.** `stopped`, `resumed`, `product_changed`, `extended` and `refunded` mean the read-back shows the effect; the `not_` forms mean the source accepted and the read-back contradicts it. Where a server cannot do the operation the result is `person_must_act` with the management reference, which is a value and not an error.
- **An operation that reaches the source makes two reads.** A fresh read before the write, and the read-back after it. The fresh read stores the snapshot and **may notify the change hook before the write happens**.
- **`unconfirmed` means the source accepted and the read-back failed**, so the effect is unknown. Do not repeat the operation before a later read shows the record: an extension or a refund repeated blindly can happen twice.
- **`SUBSCRIPTION_SOURCE_UNAVAILABLE` from a write means the effect is unknown.** A write that throws may have reached the source. Refresh, and read the record, before repeating it.
- **The extend read-back checks only that the period end is later**, not by how much.

What RevenueCat allows a server to do, by origin (version 2 of the API unless it says otherwise):

| Origin                        | Stop renewal         | Resume | Change product | Extend                                   | Refund                                                       |
| ----------------------------- | -------------------- | ------ | -------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Google Play                   | Only with `apiKeyV1` | No     | No             | Yes                                      | A subscription yes; a one-time purchase only with `apiKeyV1` |
| App Store                     | No                   | No     | No             | Yes, with a reason code, at most 90 days | No                                                           |
| RevenueCat web billing        | Yes                  | No     | No             | Yes                                      | Yes                                                          |
| Stripe tracked by RevenueCat  | No: through Stripe   | No     | No             | No                                       | No: through Stripe                                           |
| Other web stores, promotional | No                   | No     | No             | No                                       | No                                                           |

`apiKeyV1` (D50) is needed for Google Play stop renewal and Google Play one-time-purchase refund. A version 2 key is refused by version 1. **Without it, those two operations answer "not possible from a server"** with the management reference. The table is as RevenueCat documents it, read on 2026-11-25 ([`docs/revenuecat-facts.md`](docs/revenuecat-facts.md)).

---

## 🔌 RevenueCat adapter: what it maps, and what it does not

The adapter reads `GET /projects/{id}/customers/{id}/subscriptions`, `/purchases` and `/active_entitlements` and maps them to the normalized snapshot. Its limits, stated where the code makes them:

- **`billingInterval` is empty, and `cancelledAt`, `billingIssueSince` and `sourceUpdatedAt` are `null`.** Version 2 of the API does not give them on the objects the adapter reads. A host that needs them must not rely on this adapter for them.
- **The customer is the RevenueCat App User ID.** The host's account identifier must be that identifier. An event that names only anonymous identifiers (`$RCAnonymousID:`) names no account of the host: it is answered as ignored, and `onUnidentifiedEvent` is called with the event kind and environment and no identifier.
- **Unknown event kinds and fields are accepted** and trigger a refresh; a new kind added by RevenueCat does not break the receiver. An unrecognised status maps to `unknown`, and the guard reads the source's own `gives_access` flag.
- **A list that cannot be read to its end is a failed read.** The adapter reads each list to its end, taking the cursor from the `starting_after` in the query of `next_page` and never requesting the address `next_page` names; a list past 50 pages, or one it cannot continue, fails as `SUBSCRIPTION_SOURCE_UNAVAILABLE` and never becomes a partial snapshot.
- **Sandbox purchases grant nothing unless the adapter was told to** (see the Security Model).
- **Consumables grant nothing.** A non-renewing or lifetime purchase that RevenueCat reports as granting an entitlement is held beside the subscriptions.

---

## 🧰 Testing your host

The `testing` subpath lets a host test its own wiring without a network:

```ts
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'
import { SubscriptionModule, SubscriptionService } from '@bymax-one/nest-subscription'
import { Test } from '@nestjs/testing'

async function premiumHolder(): Promise<boolean> {
  const clock = new ManualClock('2026-01-01T00:00:00.000Z')
  const source = new FakeSubscriptionSource({ clock })
  const account = { accountId: 'account-1' }
  source.setAccount(
    account,
    createEmptySnapshot({ ...account, source: 'fake', fetchedAt: clock.now().toISOString() })
  )
  const moduleRef = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source,
        store: new InMemorySubscriptionStore({ logger: () => undefined }),
        accountResolver: () => null,
        clock
      })
    ]
  }).compile()
  const service = moduleRef.get(SubscriptionService)
  await service.refresh(account)
  return service.hasEntitlement(account, 'premium')
}
```

`createFailingStore` wraps a store so a test can see what the host does while the store is down:

```ts
import {
  createFailingStore,
  InMemorySubscriptionStore,
  type FailingStore,
  type FailingStoreMethod
} from '@bymax-one/nest-subscription/testing'

const reads: readonly FailingStoreMethod[] = ['getSnapshot']

/** Pass this to the module as its `store`. */
const store: FailingStore = createFailingStore(
  new InMemorySubscriptionStore({ logger: () => undefined })
)

async function duringAnOutage(scenario: () => Promise<void>): Promise<void> {
  store.fail(reads) // these methods reject until `recover`; `fail()` with no names fails them all
  try {
    await scenario()
  } finally {
    store.recover()
  }
}
```

- `createFailingStore(store)` returns the same store port with `fail(methods?, error?)` and `recover()`. Without an `error`, a failing method rejects with an `Error` whose message names the method and holds no argument of the call.
- `FakeSubscriptionSource` sets an account's state, queues signed notifications (`buildRequest`, `queueNotification`), delays or fails the next read, counts reads and scripts the management operations.
- `buildRevenueCatWebhookRequest` builds a signed request the adapter accepts, and each way a request can be wrong on purpose (`REVENUECAT_REQUEST_FLAWS`).
- `InMemorySubscriptionStore` is for tests and development only. `storeConformanceCases()` returns the cases a host runs against its own store from any test runner; each fails by throwing an assertion error (see [Examples by subpath](#examples-by-subpath)).
- `createCapture()` and `assertNoSentinel(capture, sentinels)` check that no log line or observer payload holds a value the test chose as a sentinel. **`assertNoSentinel` searches plain data only**: strings, numbers, bigints, booleans, property names, and the members of `Map` and `Set`. It does not search `Date`, `Buffer` or `Error` objects, getters or symbol keys, so a value that reaches a log only through one of those is not found.

This repository's own end-to-end suite runs one set of routes and one change hook against the fake source and against the RevenueCat adapter over HTTP to a local stand-in that serves recorded fixtures, with the module configuration as the only difference between the runs.

---

## 🏗️ Architecture

```
 request ──▶ host authentication ──▶ AccountResolver
                                          │
                                          ▼
   @RequiresEntitlement ──▶ EntitlementGuard ──▶ SubscriptionService ──▶ cache? ──▶ store port ──▶ host database
                                 │                       │
                                 │ never waits           │ stale: background refresh
                                 ▼                       ▼
                          fail policy              source port ──▶ RevenueCat adapter ──▶ RevenueCat REST API

 RevenueCat ──▶ POST /webhooks/... ──▶ raw body ──▶ verify (signature, header) ──▶ de-duplicate (store port)
                                                                                        │
                                              store snapshot + changes  ◀── read the account from the source
                                                        │
                                                        ▼
                                              host hook (at least once) ──▶ reconcile redelivers what is pending
```

### Design principles

1. **A webhook is a trigger.** Access comes from a read of the source, or from a stored snapshot that came from one.
2. **Reads are cheap and local.** A guard decision reads the store and never waits for a billing platform.
3. **Writes are ordered.** A stored snapshot is never replaced by one the source reports as older.
4. **Delivery is honest.** At least once, with a stable key per change, and a redelivery path.
5. **Nothing is claimed that was not read back.** Operation results are the source's snapshot, not the request.
6. **The source's flag decides access.** Status names are descriptive.
7. **No hidden state in the library.** The host owns the store, the scheduler, the routes and the account resolver; the library runs no background schedule and reads no environment variable.

---

## 🔐 Security Model

### Access is granted only from a read of the source (SEC01)

No access is granted from a webhook payload. Access comes from a read of the source, or from a stored snapshot that came from one. **Limit:** a stored snapshot is only as current as its last read, up to `maxSnapshotAgeMs` plus the time to the next refresh. `last_known_state` trades that further, on purpose. A verified payload still chooses which accounts are read, so a verified event that names an account causes a read of it.

### Webhooks are verified over the raw bytes (SEC02, SEC03)

The signature is HMAC-SHA256 over `<timestamp>.<raw body>`, compared in constant time, with a timestamp tolerance (default 5 minutes, at most 1 hour). Every failed check gives the same `401` and body, so an attacker learns nothing about which check failed. **Limits:** with no method configured every request is refused; the static header alone is a shared secret sent with each request, so the adapter warns when it is the only method; the uniform refusal covers the checks the library makes and not an answer the framework's body parser gives first; a replay inside the tolerance window of an event still retained is answered as `duplicate`, and one after the retention needs a fresh signature, which needs the secret.

### Fail closed (SEC04)

The default on a missing snapshot, an unreadable store or a stale snapshot is to refuse. **Limit:** `last_known_state` extends access, including to a refunded or cancelled account, for up to the tolerance (72 hours by default).

### Secrets stay out of output (SEC05)

Credentials and webhook secrets are held in a `Secret`. Serialization, spread and inspection of a library object, with hidden properties shown, expose none, and no secret appears in an error or a log line. **Limits:** the secret exists in process memory and is read back by the adapter when it signs or compares; a host that logs or serializes its own configuration before passing it in is outside the library; the checks are tests over the paths named, and a path nobody listed is not covered.

### No payment data, and identifiers only as a short hash (SEC06)

The library stores no payment data, no price paid and no raw webhook payload. In a log line an account appears only as a 12-character salted HMAC hash, with a salt made once per process, so a hash cannot be matched to an account across processes. **Limit:** the hash is for correlation, not access control, and two accounts can share one. The snapshot the store holds contains the account identifier and entitlement names, because it must; secure the store like any user table.

### Sandbox purchases (SEC07)

Sandbox purchases grant nothing unless access is enabled explicitly, and enabling it in a production environment is refused at boot unless a second option confirms it (`allowSandbox`, `isProduction` and `confirmSandboxInProduction`). For RevenueCat it is the **adapter's** `allowSandbox` that admits sandbox purchases, so set it on `revenueCatSource`. The module accepts the same three options and refuses the same production combination at boot. When `allowSandbox` is also set on the module and the source declares what it admits (`revenueCatSource` does, from its own `allowSandbox`), the two must be equal, or the boot fails with `SUBSCRIPTION_CONFIG_INVALID` naming `allowSandbox` (D53). A module that leaves `allowSandbox` unset is never refused, and a custom source that does not declare `admitsSandbox` is not compared. The module's option never changes what the adapter admits.

### Tenants are separate (SEC08)

In a multi-tenant host the tenant is part of every key, and a request without a tenant is refused as unauthenticated. **Limit:** the tenant comes from the host's resolver, which the library trusts; it never reads a tenant from a body. The webhook controller cannot be mounted on a multi-tenant host; use the processor from a route that knows the tenant.

### Secret rotation (SEC09)

Each adapter secret takes `{ current, previous }`, so a host can accept both values while it rolls a secret out. **Limit:** RevenueCat invalidates the old webhook secret immediately and offers no overlap, so a rotation always has a window in which RevenueCat signs with the new value and a host not yet restarted refuses it; RevenueCat retries failed deliveries (up to five times over about 80 minutes), and reconciliation covers what is lost after that.

### Management operations act only on the caller's records (SEC10)

An operation finds its record inside the authenticated account's own snapshot and acts on no other. A record of another account or tenant is refused and reaches no source. **Limit:** the library decides this from the snapshot it holds, so an operation on a subscription the snapshot does not yet show (a purchase not yet read) is refused until a refresh stores it.

---

## 🛡️ Security Table

Only controls this repository runs are listed.

| Control                                  | What runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Where                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Static analysis of the source            | CodeQL, on pushes, pull requests and weekly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `.github/workflows/codeql.yml`                                     |
| Known-vulnerability scan of the lockfile | OSV-Scanner, on pushes, pull requests and weekly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `.github/workflows/osv-scanner.yml`                                |
| Dependency review of a pull request      | `security / Dependency review`, failing on severity `high`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `.github/workflows/ci.yml` (reusable workflow)                     |
| Supply-chain alerts on a pull request    | Socket Security, as the checks `Socket Security: Pull Request Alerts` and `Project Report`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | a GitHub App on the repository                                     |
| Repository health score                  | OpenSSF Scorecard, weekly and on pushes to `main`, results uploaded as code scanning alerts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `.github/workflows/scorecard.yml`                                  |
| Dependency updates                       | Dependabot, weekly, as pull requests that a person merges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `.github/dependabot.yml`                                           |
| Peer range advisories                    | A weekly audit of the declared peer ranges against published advisories, which tracks its findings in one issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `.github/workflows/peer-advisory-drift.yml`                        |
| Third-party actions pinned by commit SHA | The repository's own workflows pin the actions they call by SHA; the organisation's reusable workflows are referenced by tag                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `.github/workflows/*.yml`                                          |
| Zero direct dependencies                 | `dependencies` is empty in `package.json`, and each phase close prints it and fails on a non-empty list (the invariant checks of `docs/AUTOPILOT.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                   | `package.json`                                                     |
| Secrets and identifiers out of output    | The end-to-end suite searches for every `sentinel-` value its specs declare: the lines the library writes through the framework's `Logger`, the headers and body of every response of a framework application (not of a provider stand-in), and the message of every error built by code in `src/`. It searches the logger lines and observer payloads of only those captures a spec registers with the sweep; a store or module built with a silent logger, or an observer a spec does not register, is not searched. An error is searched by its message, not by its other properties | `test/e2e/setup`                                                   |
| Packed artifact checks                   | The packed tarball is loaded in ESM and CommonJS with dependency denials, and its type resolution and file list are checked                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `pnpm check:exports`, `pnpm check:runtime`, `pnpm check:published` |
| No suppression comments                  | Inline lint directives are disabled (`noInlineConfig`), so a suppression has no effect, and each phase close greps `src` and `test` for them and fails on a match                                                                                                                                                                                                                                                                                                                                                                                                                       | `eslint.config.mjs`, `docs/AUTOPILOT.md`                           |
| Release without a long-lived token       | A release workflow that packs once and publishes that tarball through npm trusted publishing with provenance, in an environment the owner configures with a required reviewer.                                                                                                                                                                                                                                                                                                                                                                                                          | `.github/workflows/release.yml`                                    |

Not listed because the repository does not run them: a dynamic scan of a deployed service (the library deploys nothing), and the `Semgrep` and `Audit registry signatures` jobs of the organisation's security workflow, which are skipped on this repository's pull requests.

---

## 🧱 Tech Stack

| Area            | Choice                                                  |
| --------------- | ------------------------------------------------------- |
| Language        | TypeScript 5.9, `strict`                                |
| Runtime         | Node.js 26 or newer                                     |
| Framework       | NestJS 11 (peer)                                        |
| Build           | tsup, ESM and CommonJS with declarations for each       |
| Unit and e2e    | Jest, with supertest for the end-to-end suite           |
| Mutation        | Stryker with the Jest runner and the TypeScript checker |
| Package manager | pnpm                                                    |

---

## 🧪 Testing & Quality

The gates every change passes (`pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:cov:all && pnpm build`), and before a pull request is opened for a phase, `pnpm mutation`, `pnpm check:exports`, `pnpm check:runtime`, `pnpm check:api`, `pnpm check:docs`, `pnpm check:published` and `pnpm size`.

- **Coverage:** 100% of statements, branches, functions and lines in the unit suite, in the end-to-end suite and in both together.
- **Mutation testing:** a full, non-incremental run on 2026-11-28 scored 100.00, with no `Stryker disable` directive in the source. The numbers by area are in [`docs/mutation_testing_results.md`](docs/mutation_testing_results.md).
- **Acceptance:** every acceptance criterion points at a named, passing test in [`docs/acceptance.md`](docs/acceptance.md). The Finance run of the source-parity criterion and the Appendix B half of the mapping criterion belong to the Finance adapter and are not claimed.
- **Packaging:** the entry points are loaded from the packed tarball in ESM and CommonJS, a bundle-size budget is held per subpath, and the public declarations are compared with the previous published version.
- **Documentation:** every snippet in this README is compiled against the built package.

---

## 📖 API Reference

| Export (root)                                                                                                                                                           | Kind             | Purpose                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SubscriptionModule`                                                                                                                                                    | module           | `forRoot` and `forRootAsync`                                                                                                                                       |
| `SubscriptionService`                                                                                                                                                   | service          | `getSnapshot`, `hasEntitlement`, `refresh`, `reconcile`, `getCapabilities`, `getManagementReference`, `stopRenewal`, `resume`, `changeProduct`, `extend`, `refund` |
| `EntitlementGuard`, `RequiresEntitlement`                                                                                                                               | guard, decorator | Protect a route by entitlement name                                                                                                                                |
| `AccountResolver`, `ResolvedAccount`                                                                                                                                    | types            | The host's account resolver                                                                                                                                        |
| `SubscriptionWebhookController`, `WebhookProcessor`, `toHttpAnswer`, `WebhookOutcome`, `WebhookAnswer`                                                                  | webhook          | The receiver in its two forms, and the outcome-to-answer mapping                                                                                                   |
| `SubscriptionModuleOptions`, `SubscriptionModuleAsyncOptions`, `SubscriptionOptionsInput`, `ResolvedSubscriptionOptions`, `resolveOptions`, `validateOptions`           | options          | The option types and their resolution                                                                                                                              |
| `SubscriptionStore`, `StoredSnapshot`, `KeyPage`                                                                                                                        | port types       | The store the host implements                                                                                                                                      |
| `SubscriptionSource`, `SourceNotification`, `SourceCapabilities`, `OperationResult`, `WebhookRequest`, `WebhookVerification`                                            | port types       | The source an adapter implements                                                                                                                                   |
| `SubscriptionChangeHook`, `SubscriptionChangeNotification`, `diffSnapshots`                                                                                             | notifications    | The hook's types, and the pure comparison of two snapshots                                                                                                         |
| `SubscriptionObserver` and its event types                                                                                                                              | observer         | Counters and timings                                                                                                                                               |
| `SubscriptionCapabilities`, `StopRenewalOutcome`, `ResumeOutcome`, `ChangeProductOutcome`, `ExtendOutcome`, `RefundOutcome`, `PersonMustAct`, `Unconfirmed`, `ReadBack` | management types | The results of the operations                                                                                                                                      |
| `AgedSnapshot`, `ReconcileOptions`, `ReconcileResult`, `Wait`                                                                                                           | types            | Read and reconciliation shapes                                                                                                                                     |
| `SubscriptionCache`, `SubscriptionLogger`, `SubscriptionFailPolicy`, `Clock`, `AccountReference`, `WebhookContext`                                                      | types            | The small contracts the options and the methods take                                                                                                               |
| `SubscriptionError`, `SUBSCRIPTION_ERROR_CODES`, `SubscriptionErrorCode`                                                                                                | errors           | The one error class and the closed catalogue                                                                                                                       |
| `Secret`, `SECRET_PLACEHOLDER`, `encodeAccountKey`, `decodeAccountKey`, `hashAccountKey`, the `SUBSCRIPTION_*` injection tokens                                         | support          | Held secrets, account keys and the symbol tokens                                                                                                                   |

`./shared` exports the types and closed value sets of the model (`SubscriptionSnapshot`, `SubscriptionRecord`, `NonRenewingPurchaseRecord`, `EntitlementState`, `EntitlementResolution`, `SubscriptionChange`, `SUBSCRIPTION_STATUSES`, `WILL_RENEW_VALUES`, `SUBSCRIPTION_ORIGINS`, `SUBSCRIPTION_ENVIRONMENTS`, `CHANGE_KINDS`), `createEmptySnapshot`, `resolveEntitlements` and `parseInstant`. `./revenuecat` exports `revenueCatSource`, `signRevenueCatWebhook` and the adapter's option types. `./testing` exports what the [Testing section](#-testing-your-host) lists. `./finance` is reserved for the Bymax Finance adapter and exports nothing yet.

### Examples by subpath

**Root.** The module exports its tokens, so a host can inject what it configured: `SUBSCRIPTION_OPTIONS` (the resolved options), `SUBSCRIPTION_SOURCE`, `SUBSCRIPTION_STORE`, `SUBSCRIPTION_CLOCK`, and `SUBSCRIPTION_CACHE` and `SUBSCRIPTION_OBSERVER` (with `forRoot`, provided only when the host set one; with `forRootAsync`, always, holding `null` when it set none).

```ts
import { Inject, Injectable } from '@nestjs/common'
import {
  encodeAccountKey,
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_STORE,
  type Clock,
  type SubscriptionStore
} from '@bymax-one/nest-subscription'

@Injectable()
export class SupportLookup {
  constructor(
    @Inject(SUBSCRIPTION_STORE) private readonly store: SubscriptionStore,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: Clock
  ) {}

  /** How old the stored snapshot is, or `null` when nothing is stored. */
  async storedAgeMs(accountId: string): Promise<number | null> {
    const record = await this.store.getSnapshot(encodeAccountKey({ accountId }))
    if (record === null) return null
    return this.clock.now().getTime() - Date.parse(record.snapshot.fetchedAt)
  }
}
```

Account keys, held secrets, option checks and the comparison of two snapshots are plain functions and classes:

```ts
import {
  decodeAccountKey,
  diffSnapshots,
  encodeAccountKey,
  hashAccountKey,
  resolveOptions,
  Secret,
  SECRET_PLACEHOLDER,
  validateOptions,
  type SubscriptionOptionsInput,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription'

/** One key per tenant and account; the store receives this string. */
const key = encodeAccountKey({ tenantId: 'tenant-1', accountId: 'account-1' })
const reference = decodeAccountKey(key) // the same pair, or `null` for text the encoder never writes
const forLogs = hashAccountKey(key) // 12 characters to correlate lines; the salt is per process

const secret = Secret.from({ current: 'new-value', previous: 'old-value' })
const printed = String(secret) === SECRET_PLACEHOLDER // true: only `reveal` and `candidates` read it
const accepted = secret.matches('old-value') // true while the previous value is set

/** Both throw one `SubscriptionError` naming every offending option. */
function check(options: SubscriptionOptionsInput): number {
  validateOptions(options)
  return resolveOptions(options).maxSnapshotAgeMs // defaults applied
}

/** What changed between two snapshots of one account; `null` stands for "nothing stored before". */
function changedKinds(previous: SubscriptionSnapshot | null, current: SubscriptionSnapshot) {
  return diffSnapshots(previous, current).map((change) => change.kind)
}
```

**`./shared`.** A source adapter, a worker or a client can resolve entitlements and read instants without NestJS:

```ts
import {
  parseInstant,
  resolveEntitlements,
  type NonRenewingPurchaseRecord
} from '@bymax-one/nest-subscription/shared'

const lifetime: NonRenewingPurchaseRecord = {
  purchaseReference: 'purchase-1',
  entitlementNames: ['premium'],
  givesAccess: true,
  origin: 'app_store',
  environment: 'production',
  productReference: 'premium_lifetime',
  purchasedAt: '2026-01-01T00:00:00Z',
  accessUntil: null, // no end
  refundedAt: null
}

// The subscriptions, what each one grants, and the non-renewing purchases.
const { entitlements, overlapping } = resolveEntitlements([], new Map(), [lifetime])

// Milliseconds since the epoch; a string without a zone throws `SUBSCRIPTION_INVALID_INPUT`.
const purchasedAtMs = parseInstant(lifetime.purchasedAt)
```

**`./revenuecat`.** `signRevenueCatWebhook` builds the signature header RevenueCat sends, for a test of a receiver:

```ts
import { signRevenueCatWebhook } from '@bymax-one/nest-subscription/revenuecat'

function signedRequest(signingSecret: string, body: string, now: Date) {
  const rawBody = Buffer.from(body)
  const seconds = Math.floor(now.getTime() / 1000)
  const signature = signRevenueCatWebhook(signingSecret, seconds, rawBody)
  return { rawBody, headers: { 'x-revenuecat-webhook-signature': signature } }
}
```

**`./testing`.** The conformance cases run from any test runner; here with `node:test`, and the in-memory store where the host puts its own:

```ts
import { it } from 'node:test'
import {
  InMemorySubscriptionStore,
  storeConformanceCases
} from '@bymax-one/nest-subscription/testing'

for (const { name, run } of storeConformanceCases()) {
  // The factory returns a fresh, empty store for each case.
  it(name, () => run(() => new InMemorySubscriptionStore({ logger: () => undefined })))
}
```

---

## 🚨 Error Code Catalog

Every error the library raises is a `SubscriptionError` with one of these codes. The codes are exported as `SUBSCRIPTION_ERROR_CODES` from the root and from `./shared`, and a test fails if this table and the catalogue differ.

| Code                                  | Meaning                                              | Raised or answered by                                                                                                            |
| ------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SUBSCRIPTION_WEBHOOK_REFUSED`        | The webhook request was refused.                     | The webhook answer, `401`, for any failed check                                                                                  |
| `SUBSCRIPTION_ACCOUNT_UNKNOWN`        | The account or subscription is not known.            | A management operation on a record the caller's snapshot does not hold                                                           |
| `SUBSCRIPTION_UNAUTHENTICATED`        | The request carries no account.                      | The guard, `401`                                                                                                                 |
| `SUBSCRIPTION_ENTITLEMENT_REQUIRED`   | The required entitlement is not held.                | The guard, `403`                                                                                                                 |
| `SUBSCRIPTION_NO_ACCESS`              | The subscription does not give access.               | The guard, `403`                                                                                                                 |
| `SUBSCRIPTION_SOURCE_UNAVAILABLE`     | The billing source could not be read.                | The guard, `503`; the webhook answer, `503`; `refresh`, the operations and the adapter                                           |
| `SUBSCRIPTION_OPERATION_NOT_POSSIBLE` | The operation is not possible for this subscription. | Reserved in the catalogue. The library does not raise it: an operation a server cannot do is the `person_must_act` result        |
| `SUBSCRIPTION_CONFIG_MISSING`         | A required option is missing.                        | Reserved in the catalogue. The library does not raise it: a missing required option is reported as `SUBSCRIPTION_CONFIG_INVALID` |
| `SUBSCRIPTION_CONFIG_INVALID`         | An option is invalid.                                | Module and adapter validation at boot                                                                                            |
| `SUBSCRIPTION_INVALID_INPUT`          | An argument is invalid.                              | A blank account, a missing tenant in a multi-tenant host, a blank product, an extension that is not whole days, a page limit     |

---

## 🚫 What This Library Does NOT Do

- It does not charge anyone, hold card data, render a purchase screen or talk to the App Store or Google Play on the device. Purchases happen in the app and in the billing platform.
- It does not decide what a subscription is worth in a product. Prices, benefits and limits belong to the host.
- It is not a billing platform, a product catalogue or a pricing engine.
- It ships no database client and no migration. The host implements the store port; [`docs/reference-store.md`](docs/reference-store.md) is a reference for PostgreSQL.
- It mounts no route for the management operations. The host writes those controllers.
- It runs no background schedule and reads no environment variable. The host schedules reconciliation and passes its own configuration.
- **The Bymax Finance adapter is planned and is not available.** It is built when Bymax Finance publishes the API it needs, and the `./finance` subpath exports nothing until then.
- It does not guarantee exactly-once delivery of a change, ordering between a webhook and a read, or that RevenueCat's state is correct.

---

## 🤝 Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md). The specification is [`docs/spec.md`](docs/spec.md), the roadmap is [`docs/plan.md`](docs/plan.md), and everything that reaches the repository is written in English.

---

## 🔒 Security Policy

Report a vulnerability privately through GitHub's [private security advisory](https://github.com/bymaxone/nest-subscription/security/advisories/new), or email **support@bymax.one** with `[security] @bymax-one/nest-subscription` in the subject. Do not open a public issue. The full policy is in [`SECURITY.md`](SECURITY.md).

---

## 📄 License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub>
</p>
