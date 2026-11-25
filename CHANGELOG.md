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
  `getSnapshot` and `hasEntitlement` answer from the store and never wait for the source; an account
  with nothing stored reads as an empty snapshot and `false`. `refresh` reads the source now and
  returns the stored snapshot, and concurrent refreshes of one account share one source call. A
  snapshot comes back frozen and carries its age in milliseconds. A source failure on refresh
  rejects with `SUBSCRIPTION_SOURCE_UNAVAILABLE` and leaves the stored snapshot untouched, and a
  snapshot the source reports as older than the stored one is never written. A multi-tenant
  configuration refuses a call without a tenant.
  An entitlement counts as held only while its active flag is true and its `until` is `null` or
  later than now by the injected clock. A cached or stored snapshot is used only when it names the account and tenant asked for and
  every field has the type the model gives it; otherwise it counts as absent.

- A read of a snapshot older than `maxSnapshotAgeMs` returns the stored snapshot and starts a
  refresh in the background. The refresh never delays or rejects the read: a failure is logged by
  its error code alone and passed to the observer's `onBackgroundRefreshFailure` hook, which may
  return a promise that is not waited for. The option
  type `SubscriptionObserverOption` gains that optional hook and `BackgroundRefreshFailure` is
  exported from the root.

- The optional cache option is used: when the host passes a `cache`, `getSnapshot` and
  `hasEntitlement` read through it in front of the store for `cacheTtlMs` milliseconds (default
  30 000; a positive safe integer, refused otherwise), and every write
  of a snapshot invalidates the account's entry before the write is answered. Entries are keyed
  with the fixed prefix `subscription:snapshot:` and the account key, hold only snapshots the store
  returned, and a cache that throws or returns something that is not a snapshot is treated as a
  miss, so it never fails a read or a write. A cache write is not waited for; one in flight at an invalidation removes its own entry, and reads go to the store meanwhile and after a failed delete until the entry expires.

- `SubscriptionService.reconcile(options)`, with `ReconcileOptions`, `ReconcileResult` and `Wait`
  exported from the root. A run refreshes the accounts whose snapshot is older than a threshold, up
  to a batch bound and under a rate measured on the injected clock, and returns `refreshed`,
  `failed` and a `cursor` to go on after the last account it attempted; the cursor is `null` only
  when the listing is exhausted. A run lists no more pages than its batch and rate need, so store
  work does not grow with the backlog, and it reports no count of what is left. One account's
  failure does not end the run. The library starts no timer: a run waits only through the `wait`
  function it is given and otherwise ends when its rate is spent.
- `decodeAccountKey`, exported from the root: reads a key written by `encodeAccountKey` back into
  its account reference, and returns `null` for any other text.
- `RequiresEntitlement(name)`, exported from the root: marks a route handler or controller as
  needing one entitlement, the handler's name winning over the controller's. A blank name is
  refused with `SUBSCRIPTION_INVALID_INPUT` when the decorator is applied. `AccountResolver` and
  `ResolvedAccount`, exported from the root, are the contract of the resolver the host supplies.
- `EntitlementGuard`, exported from the root, provided and exported by the module: it enforces
  `RequiresEntitlement`. A route without the decorator is untouched. The account comes from the
  host's resolver only; a request with no usable account is refused with HTTP 401
  `SUBSCRIPTION_ACCOUNT_UNKNOWN`, an account without the entitlement with HTTP 403
  `SUBSCRIPTION_ENTITLEMENT_REQUIRED`, and an account whose subscription gives no access with HTTP
  403 `SUBSCRIPTION_NO_ACCESS`. Any unexpected failure refuses with HTTP 503
  `SUBSCRIPTION_SOURCE_UNAVAILABLE`. A refusal body is `{ code, message }` and nothing else. The
  guard works for HTTP contexts; a decorated route in another context is refused.

### Changed

- `AccountResolverOption` and `ResolvedAccountOption` are renamed `AccountResolver` and
  `ResolvedAccount`. Apply to a derived backend: replace the two names in any import; the shapes
  are unchanged.

- The store conformance case for stale-key paging asserts what the store port promises: at most
  `limit` keys per page, each key once, none skipped, and a listing that ends. A store that returns
  smaller pages than the limit now passes; a store that returns more, repeats or skips a key still
  fails.
- The store port states that a `listStaleKeys` cursor stays valid when keys listed before it stop
  qualifying, so a caller may refresh the keys of a page before it asks for the next. The
  conformance suite gains a case for it, and a store that pages by offset now fails that case.
