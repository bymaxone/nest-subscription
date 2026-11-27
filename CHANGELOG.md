# Changelog

All notable changes to `@bymax-one/nest-subscription` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**Versioning, while the library is pre-adoption.** [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
is the target, not yet the practice. Until the API settles, breaking changes ship in **minor and
patch** releases rather than driving the major, deliberately: the library has no production
dependant yet, the surface can still be corrected as adopters and audits report, and a major per
breaking change would say nothing useful about its stability. Strict SemVer starts when the API is
declared stable, and that transition will be announced here.

**What this means for you:** do not infer compatibility from the version number in the `1.x` line
— `^1.0.0` and `~1.0.0` both resolve to releases that may break you. Read the entry before
upgrading. Every breaking change carries an **Apply to a derived backend** note saying exactly
what moves, and that note is the compatibility contract until strict SemVer begins.

## [Unreleased]

## [1.0.1] - 2026-11-27

### Changed

- **The module and the source must agree on `allowSandbox`.** Only the source decides whether sandbox purchases are admitted, so a host that set `allowSandbox` on the module alone, or with a different value than on `revenueCatSource`, believed sandbox access was on or off and it was not. When `allowSandbox` is set on the module options and the source declares what it admits, the two must be equal, or the boot fails with `SUBSCRIPTION_CONFIG_INVALID` naming `allowSandbox`, through `forRoot` and `forRootAsync`. A module that leaves `allowSandbox` unset is never refused, and a source that declares nothing is never compared.
- `SubscriptionSource` gains an optional read-only member, `admitsSandbox`, and `revenueCatSource` sets it from its `allowSandbox`.

**Apply to a derived backend:** nothing, unless the module options set `allowSandbox` to a value that differs from the one on `revenueCatSource`: the boot now stops, so set the same value on both, or leave it unset on the module. A custom source needs no change; it may declare `admitsSandbox` to be compared with the module's `allowSandbox`.

## [1.0.0] - 2026-11-27

The first release. `@bymax-one/nest-subscription` keeps one normalized subscription snapshot per
account for a NestJS 11 backend, fed by one billing source through an adapter, and exposes it
through a service, a route guard and typed change notifications. This release ships the RevenueCat
adapter. The Bymax Finance adapter is planned and is not available: `./finance` exists and exports
nothing.

### Requirements

- Node.js 26 or newer, and NestJS 11 (`@nestjs/common ^11.0.16`, `@nestjs/core ^11.1.18`) with
  `reflect-metadata ^0.2.0` and `rxjs ^7.8.0`. The model in `./shared` needs none of them.
- Zero direct dependencies. `@bymax-one/nest-cache` and `@bymax-one/nest-core` are optional peers
  that the library does not import.
- A store the host implements over its own database, and a resolver that tells the guard which
  account a request belongs to. [`docs/reference-store.md`](docs/reference-store.md) is a reference
  store for PostgreSQL; the in-memory store is for tests and development only.
- For the webhook route, an application created with `rawBody: true`
  ([`docs/raw-body.md`](docs/raw-body.md)).

### What the library does

- **The snapshot.** One `SubscriptionSnapshot` per account, the same shape for every source, in
  `./shared`: entitlements, subscriptions with status, `givesAccess`, `accessUntil`, origin and
  environment, and non-renewing purchases. Access follows the source's own access flag, never a
  status name or a webhook payload.
- **Reading.** `SubscriptionService.getSnapshot` and `hasEntitlement` answer from the store and
  never wait for the source. `refresh` reads the source for one account, with concurrent refreshes
  of one account sharing one call, and a snapshot older than `maxSnapshotAgeMs` is refreshed in the
  background on its next read. `reconcile` refreshes stale accounts in bounded, rate-limited
  batches from the host's own scheduler, redelivers pending changes and purges old event
  identifiers.
- **Guarding.** `@RequiresEntitlement('name')` and `EntitlementGuard`, with stable refusal codes
  that tell "no account" (401), "no subscription" and "a subscription that gives no access" (403)
  and "cannot show the snapshot current" (503), and two fail policies, `refuse` (default) and
  `last_known_state`.
- **Webhooks.** A controller mounted with one switch (off by default) or a processor a host calls
  from its own route, de-duplication by event identifier, a response deadline, and five outcomes
  mapped to the HTTP answers RevenueCat expects. A verified notification triggers a read of the
  source; its payload is never applied.
- **Change notifications.** A host hook with typed changes (`started`, `renewed`, `refunded` and
  others), each with a stable key, delivered at least once, plus an optional observer that
  receives counters and timings and never an identifier.
- **Management operations.** Capabilities per subscription, then stop renewal, resume, change
  product, extend and refund where a server can do it. A result is the snapshot read back from the
  source, and `person_must_act` with the management reference where only the person can.
- **RevenueCat adapter** (`./revenuecat`). Reads over version 2 of the REST API with the runtime's
  own `fetch`, verifies webhooks by HMAC signature over the raw bytes and by the static
  authorization header, filters sandbox purchases, and maps statuses, stores and renewal intent by
  tables tested against the specification.
- **Testing** (`./testing`). An in-memory store, a scriptable fake source, a manual clock, signed
  request builders, a capturing logger with `assertNoSentinel`, and the store conformance cases a
  host runs against its own store.

### Known limits

- **Delivery of a change is at least once.** Make the reaction idempotent on `changes[].key`. A
  change hook must not await `reconcile()`: its own pending changes are delivered again.
- **`last_known_state` extends access during an outage**, including for an account refunded or
  cancelled during it, until the snapshot is refreshed or ages past the tolerance (72 hours by
  default).
- **A `forgetEvent` that never settles keeps retries of that event at 503 on that instance** until
  a restart or until the event is evicted from the processor's bounded memory.
- **RevenueCat, version 2.** `billingInterval` is empty, and `cancelledAt`, `billingIssueSince` and
  `sourceUpdatedAt` are `null`. Rotating the webhook secret takes effect immediately on
  RevenueCat's side, which offers no overlap of two valid secrets.
- **Management operations make two reads.** The fresh read before the write stores the snapshot and
  may notify the change hook before the write happens. `unconfirmed` and a
  `SUBSCRIPTION_SOURCE_UNAVAILABLE` from a write mean the effect is unknown: do not repeat the
  operation before a later read shows the record. The extend read-back checks only that the period
  end is later.
- **Two Google Play operations need a version 1 key.** Stop renewal and refund of a one-time
  purchase need `apiKeyV1`; without it they answer "not possible from a server". A version 2 key is
  refused by version 1.
- **The host's `refresh` joins a read already in flight**, so its snapshot may have been read
  before the call.
- **Sandbox access is the adapter's option.** The module validates `allowSandbox`,
  `confirmSandboxInProduction` and `isProduction` at boot, but only the adapter's `allowSandbox`
  admits sandbox purchases. This is recorded as an open question in `docs/spec.md` (Q01).
- **`assertNoSentinel` searches plain data only**: strings, numbers, bigints, booleans, property
  names, and the members of `Map` and `Set`. It does not search `Date`, `Buffer` or `Error`
  objects, getters or symbol keys.
- **The webhook controller is written and tested for Express.** A Fastify host, a multi-tenant host
  or a host that owns its routing calls `WebhookProcessor` from its own route.
- **The Bymax Finance adapter is planned and not available.**

### Apply to a derived backend

There is nothing to migrate in this release. To adopt the library in a backend that handled its
billing source's webhooks itself:

1. Install the package and the NestJS peers, and implement the store port over your database (start
   from `docs/reference-store.md`); run `storeConformanceCases()` from `./testing` against it.
2. Write the account resolver for your authentication, and register `SubscriptionModule.forRoot`
   with `revenueCatSource`, your store, the resolver, a change hook and the webhook controller (or
   call `WebhookProcessor` from your own route).
3. Create the application with `rawBody: true`, point the RevenueCat webhook integration at the
   route, and set its signing secret.
4. Replace the checks that read the source's webhook payload for access with
   `@RequiresEntitlement` and `EntitlementGuard`, or with `SubscriptionService.hasEntitlement`.
   Keep your own rules for what an entitlement is worth.
5. Make the change hook idempotent on `changes[].key`, call `refresh` after a purchase the app
   reports, and schedule `reconcile`.

[Unreleased]: https://github.com/bymaxone/nest-subscription/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/bymaxone/nest-subscription/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-subscription/releases/tag/v1.0.0
