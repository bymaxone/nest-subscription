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
  the defaults (fail policy `refuse`, 72-hour tolerance, 24-hour maximum age, sandbox access off,
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
  `SUBSCRIPTION_UNAUTHENTICATED`, an account without the entitlement with HTTP 403
  `SUBSCRIPTION_ENTITLEMENT_REQUIRED`, and an account whose subscription gives no access with HTTP
  403 `SUBSCRIPTION_NO_ACCESS`. Any unexpected failure refuses with HTTP 503
  `SUBSCRIPTION_SOURCE_UNAVAILABLE`. A refusal body is `{ code, message }` and nothing else, except
  that an HTTP exception with a status from 400 to 599 thrown or rejected by the host's resolver
  leaves the guard unchanged. The guard reads the clock after the snapshot, and refuses when the
  clock gives an instant that is not a finite date. The guard works for HTTP contexts; a decorated
  route in another context is refused.
- The fail policy of the guard, with `failPolicy` (`refuse` by default, or `last_known_state`) and
  `lastKnownStateToleranceMs`. When the store cannot be read, or the stored snapshot is older than
  `maxSnapshotAgeMs` (the guard never waits for its refresh), `refuse` denies with HTTP 503
  `SUBSCRIPTION_SOURCE_UNAVAILABLE` and `last_known_state` trusts a snapshot strictly younger than
  the tolerance and denies one aged exactly the tolerance or more. A store that answers with no
  record is the empty snapshot and is refused as no subscription under both values. The option's
  documentation states that `last_known_state` extends access during an outage, including for an
  account that was refunded during it. The default tolerance is 72 hours; the maximum snapshot age
  stays 24 hours.
- The error code `SUBSCRIPTION_UNAUTHENTICATED` in `SUBSCRIPTION_ERROR_CODES`, with its fixed
  message: a request with no usable account. `SUBSCRIPTION_ACCOUNT_UNKNOWN` keeps its meaning.
- `createFailingStore(store)` in the `testing` subpath, with `FailingStore` and
  `FailingStoreMethod`: wraps any `SubscriptionStore` and, once `fail()` is called, rejects the
  methods named (every method when none is named) until `recover()`, so a host can test its own
  outage handling. Until then it delegates unchanged.
- `diffSnapshots(previous, current)`, exported from the root: the pure comparison of two snapshots
  into the typed list of changes of `CHANGE_KINDS`, each with a stable key. It reads the two
  snapshots and nothing else, never a webhook payload. The list is ordered by kind as `CHANGE_KINDS` is, then by the order of
  the subscriptions; a change of `fetchedAt` alone gives an empty list. `overlap_detected` is reported per entitlement, when it
  has two or more grantors where it had at most one.
- `EntitlementState.grantingSubscriptionReferences`: every subscription that grants the entitlement
  and gives access, sorted with no duplicate and empty when none does, beside the decisive
  `grantingSubscriptionReference`, which is one of them. A snapshot without it is refused as
  unreadable. Apply to a derived backend: add the field to any `EntitlementState` you build.
- The change key is a hexadecimal digest derived from the account, the subscription, the kind
  and the fact that tells the change from the next (for a renewal, the period end), each field
  hashed on its own before they are joined. It holds no identifier and does not depend on the fetch
  instant.
- The change hook (`onChange`) is called after the store write has succeeded and never before it,
  with the previous snapshot, the new one and the changes. Delivery is at least once: the changes
  are stored with the snapshot in the same write as not delivered and cleared only after the hook
  returned, so a hook that throws or rejects leaves the stored snapshot in place and its changes
  pending, and `SubscriptionService.reconcile` calls it again with the same change keys, marked
  `redelivery: true` and with a `null` previous snapshot. The failure is logged by its error code
  and reported to the observer. The same change can reach the hook more than once; make the
  reaction idempotent on the change key. `SubscriptionService.refresh` returns after the hook has
  returned or failed. With no `onChange` no change is computed or stored.
- `reconcile` delivers pending changes again before it refreshes stale accounts, a page at a
  time and up to `batchSize` accounts. `ReconcileResult` gains `pendingCursor` and `ReconcileOptions` gains
  `pendingCursor`: pass the one to the next run so that an account whose hook keeps failing, which
  stays pending, does not keep later accounts from being reached. It is `null` when the listing of
  pending accounts is exhausted, and independent of `cursor`, which belongs to stale snapshots.
- The observer option takes a `SubscriptionObserver`, every method of it optional, one per event
  family. Every payload is a closed record of outcomes, counts and durations
  on the injected clock, with no account, tenant or payload content. A method that throws or
  rejects never affects the operation it observes, and with no observer nothing is built or timed.
  The option type `SubscriptionObserverOption` is replaced by `SubscriptionObserver`.
- The `logger` option: where the library writes its warnings, a NestJS `Logger` by default. A line is
  a fixed sentence, a short salted hash of the account and an error code, never the account, the
  tenant, a payload or an error's text. `hashAccountKey(key, salt?)`, exported from the root, makes
  that hash; it is for correlation in logs and is not an access control.
- `createCapture` and `assertNoSentinel` in the `testing` subpath: a logger and an observer that
  record everything, and the assertion that no recorded line or payload holds a given sentinel.

- The webhook receiver. `WebhookProcessor`, provided and exported by the module, takes the raw bytes
  and headers of a request and returns a `WebhookOutcome` (`processed`, `duplicate`, `ignored`,
  `refused` or `failed`); `toHttpAnswer` maps an outcome to its HTTP answer: 200 for the first
  three, 401 for a refusal and 503 for a failure. The adapter verifies the request over the bytes
  as received; a request that fails any check, or an adapter that throws, gets the one refusal.
  A verified notification only triggers a read of every account it names; the state in the payload
  is never applied. An event identifier is recorded when processing starts and removed when the
  event fails, so the source's retry is processed; the removal is started before the failed answer
  and never waited for, so a slow store cannot hold the answer past the deadline, and the observer
  hears of a failed event when the removal settles. An event is never processed while the removal
  of its identifier is unsettled: the processor remembers in memory the failed
  events whose removal is in flight or failed; a delivery of one whose removal is in flight is
  answered as a failure at once, with no store call and no read, and one whose last removal failed
  starts the removal again and is answered as a failure, so the source retries until a removal
  succeeded and the next delivery is recorded and processed. The identifier is never recorded
  again. That memory belongs to one process and is bounded: a retry that lands on another instance
  of the host while the removal is in flight or failed, or after the oldest entry was dropped, may find
  the identifier recorded and be answered as already seen until the retention purges it. A read
  that does not finish inside
  `webhookDeadlineMs` (default 30 000, at most 60 000) ends the call as a failure and is left to
  finish and be stored; the host's change hook is not part of the deadline. In a multi-tenant host
  the tenant is passed to `process` from the host's own authenticated route.
- `SubscriptionWebhookController`, mounted by `webhookController: true` with `webhookPath`, which has
  no default; the controller is off by default, refuses a multi-tenant host at boot, and needs the
  application to be created with `rawBody: true`. `forRootAsync` takes the route as a static
  `webhookPath`; a factory that enables the controller or names a route without one, or that
  contradicts the static one, is refused at boot naming the option. The retention `eventRetentionMs` defaults to 7 days and is applied by each
  reconciliation run, which purges older identifiers; the library starts no timer for it.
- `revenueCatSource` and `signRevenueCatWebhook` in the `revenuecat` subpath: RevenueCat as a billing
  source. It reads a customer's subscriptions and one-time purchases from version 2 of the REST API
  with the runtime's `fetch`, and the result is the empty snapshot for a customer RevenueCat does not
  know. Access is RevenueCat's `gives_access` flag and never a status name; a scheduled pause is not
  a pause, a cancellation is not an expiry and a billing issue follows the access flag. Webhooks are
  verified by the static authorization header, by the HMAC signature over the raw bytes with a
  timestamp tolerance (five minutes by default), or by both, in constant time, with two valid values
  of each secret during a rotation; every refusal is the same value. Sandbox purchases give no access
  and grant no entitlement unless `allowSandbox` is set, and enabling it with `isProduction` needs
  `confirmSandboxInProduction`. The API address is the `baseUrl` option, validated at boot. Every
  credential and webhook secret is held in a `Secret` in a private field.
- `NonRenewingPurchaseRecord` and the optional `nonRenewingPurchases` list of `SubscriptionSnapshot`
  in the `shared` subpath, and a third optional argument of `resolveEntitlements`: a one-time or
  lifetime purchase that RevenueCat reports as granting an entitlement gives it, with no end for a
  lifetime grant, and is named among the grantors of the entitlement. A consumable grants nothing.
  `diffSnapshots` reports a purchase through the existing kinds: `started`, `expired`, `refunded`
  and `transferred`.
- `buildRevenueCatWebhookRequest` and `REVENUECAT_REQUEST_FLAWS` in the `testing` subpath: a
  RevenueCat webhook request, signed or carrying the authorization header, and each way it can be
  wrong on purpose.

### Changed

- The observer's webhook outcome type is renamed `WebhookOutcomeKind`, and `WebhookEvent` gains
  `retained`, which is `true` when the store could not remove the identifier of a failed event and
  is reported when that removal settles, after the answer.
  Apply to a derived backend: replace
  the type name in any import and ignore the new field if it is not needed.
- `AccountResolverOption` and `ResolvedAccountOption` are renamed `AccountResolver` and
  `ResolvedAccount`. Apply to a derived backend: replace the two names in any import; the shapes
  are unchanged.
- A clock that returns an instant that is not a finite date no longer lets a snapshot or an
  entitlement read as current: `hasEntitlement` answers `false`, `getSnapshot` starts the refresh it
  starts for a stale snapshot, and the guard refuses with `SUBSCRIPTION_SOURCE_UNAVAILABLE`.

- The store conformance case for stale-key paging asserts what the store port promises: at most
  `limit` keys per page, each key once, none skipped, and a listing that ends. A store that returns
  smaller pages than the limit now passes; a store that returns more, repeats or skips a key still
  fails.
- The store port states that a `listStaleKeys` cursor stays valid when keys listed before it stop
  qualifying, so a caller may refresh the keys of a page before it asks for the next, and that a
  `listKeysWithPendingChanges` cursor stays valid when the changes of keys listed before it are
  cleared. The conformance suite gains a case for each, and a store that pages by offset now fails
  them.
