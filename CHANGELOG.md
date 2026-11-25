# Changelog

All notable changes to `@bymax-one/nest-subscription` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The package scaffold: the build, the quality gates and the CI for the root, `shared`,
  `revenuecat`, `finance` and `testing` subpaths and the internal bundle.
- `SUBSCRIPTION_ENVIRONMENTS` and `SubscriptionEnvironment` in the `shared` subpath.
- The normalized model in the `shared` subpath: `SubscriptionSnapshot`, `SubscriptionRecord`,
  `EntitlementState`, `SourceCustomerReference` and `SubscriptionChange`, with the closed value
  sets `SUBSCRIPTION_STATUSES`, `WILL_RENEW_VALUES`, `SUBSCRIPTION_ORIGINS` and `CHANGE_KINDS` and
  their union types.
- The closed error-code catalogue `SUBSCRIPTION_ERROR_CODES` and `SubscriptionErrorCode` in the
  `shared` subpath, and `SubscriptionError` with the catalogue exported from the root. The class is
  defined in the `shared` subpath and re-exported by the root, so a host catches one class
  whichever entry point it imported it from and whichever part of the library raised it.
- `createEmptySnapshot` and `resolveEntitlements` in the `shared` subpath: the snapshot of an
  unknown account and the rule that resolves entitlements across subscriptions.
- `parseInstant` in the `shared` subpath: reads an ISO 8601 instant with a zone, in milliseconds,
  and refuses any other string and any date or time that does not exist.
- `encodeAccountKey`, the one function that joins a tenant and an account identifier into a key,
  exported from the root.
- The source port `SubscriptionSource`, the store port `SubscriptionStore`, `Clock`, the injection
  tokens `SUBSCRIPTION_OPTIONS`, `SUBSCRIPTION_SOURCE`, `SUBSCRIPTION_STORE`, `SUBSCRIPTION_CLOCK`,
  `SUBSCRIPTION_CACHE` and `SUBSCRIPTION_OBSERVER`, and every type that crosses a port, exported from
  the root.
- `InMemorySubscriptionStore` and `storeConformanceCases` in the `testing` subpath: an in-memory
  store for tests and development, not for production, and the conformance cases a host runs
  against its own store.
- `FakeSubscriptionSource` in the `testing` subpath: a scriptable billing source that sets an
  account's state, queues signed notifications, delays or fails the next read and counts reads.
- The option types `SubscriptionModuleOptions`, `SubscriptionModuleAsyncOptions`,
  `SubscriptionOptionsInput` and `ResolvedSubscriptionOptions`, and `resolveOptions`, which applies
  the defaults (fail policy `refuse`, 24-hour tolerance and maximum age, sandbox access off,
  webhook controller off) and returns a frozen object, exported from the root.
- `validateOptions`, which refuses an invalid configuration with one `SubscriptionError` that names
  every offending option and carries none of the supplied values. `SubscriptionError` gains an
  optional `optionPaths` list, appended to its message, for configuration errors.
- `Secret` and `SecretInput`, exported from the root: the holder of every credential and webhook
  secret, which keeps its values out of serialization, spread, enumeration and `util.inspect`, holds
  two valid values during a rotation and compares in constant time. The module options hold none.
- `SubscriptionModule.forRoot` and `forRootAsync`, exported from the root. The options are
  validated once at boot; the module provides `SUBSCRIPTION_OPTIONS`, `SUBSCRIPTION_SOURCE`,
  `SUBSCRIPTION_STORE` and `SUBSCRIPTION_CLOCK`, and, with `forRoot`, `SUBSCRIPTION_CACHE` and `SUBSCRIPTION_OBSERVER`
  when configured. No optional peer is loaded at run time.
- `ManualClock` in the `testing` subpath: a `Clock` a test moves by hand, so no test of staleness,
  ordering or a rate limit waits on a timer.

- `SubscriptionService` and `AgedSnapshot`, exported from the root and provided by the module.
  `getSnapshot` and `hasEntitlement` answer from the store and never call the source; an account
  with nothing stored reads as an empty snapshot and `false`. `refresh` reads the source now and
  returns the stored snapshot, and concurrent refreshes of one account share one source call. A
  snapshot comes back frozen and carries its age in milliseconds. A source failure on refresh
  rejects with `SUBSCRIPTION_SOURCE_UNAVAILABLE` and leaves the stored snapshot untouched, and a
  snapshot the source reports as older than the stored one is never written. A multi-tenant
  configuration refuses a call without a tenant.

### Changed

- The store conformance case for stale-key paging asserts what the store port promises: at most
  `limit` keys per page, each key once, none skipped, and a listing that ends. A store that returns
  smaller pages than the limit now passes; a store that returns more, repeats or skips a key still
  fails.
