# Task files — shared contract

> **Source roadmap**: [`docs/plan.md`](../plan.md) · **Source spec**: [`docs/spec.md`](../spec.md)

Each `phase-NN-<slug>.md` in this folder breaks one phase of the roadmap into tasks. Every task carries an agent prompt that is meant to be run in a fresh conversation. This file holds what those prompts share, so that a name chosen in one phase is the name the next phase finds.

**A name or path below is fixed.** A task that needs a different one changes it here, in the same pull request, and says why. Nothing here overrides the specification: where the two disagree, the specification wins and this file is corrected.

---

## 1. Phase index

> Mirrors the phase dashboard of [`docs/plan.md`](../plan.md). Both are updated together.

**Phases done**: 4 / 11 · **Tasks done**: 28 / 66

| ID  | Task file                                                                                        | Status    | Progress | Last updated |
| --- | ------------------------------------------------------------------------------------------------ | --------- | -------- | ------------ |
| P0  | [`phase-00-scaffold-and-governance.md`](phase-00-scaffold-and-governance.md)                     | ✅ Done   | 7/7      | 2026-11-24   |
| P1  | [`phase-01-model-ports-and-test-doubles.md`](phase-01-model-ports-and-test-doubles.md)           | ✅ Done   | 7/7      | 2026-11-24   |
| P2  | [`phase-02-module-and-options.md`](phase-02-module-and-options.md)                               | ✅ Done   | 5/5      | 2026-11-25   |
| P3  | [`phase-03-read-refresh-reconcile.md`](phase-03-read-refresh-reconcile.md)                       | ✅ Done   | 5/5      | 2026-11-25   |
| P4  | [`phase-04-guard-and-fail-policy.md`](phase-04-guard-and-fail-policy.md)                         | 👀 Review | 4/4      | 2026-11-25   |
| P5  | [`phase-05-change-notifications-and-observer.md`](phase-05-change-notifications-and-observer.md) | 📋 ToDo   | 0/5      | —            |
| P6  | [`phase-06-webhook-receiver.md`](phase-06-webhook-receiver.md)                                   | 📋 ToDo   | 0/5      | —            |
| P7  | [`phase-07-revenuecat-adapter.md`](phase-07-revenuecat-adapter.md)                               | 📋 ToDo   | 0/8      | —            |
| P8  | [`phase-08-management-operations.md`](phase-08-management-operations.md)                         | 📋 ToDo   | 0/9      | —            |
| P9  | [`phase-09-release-readiness.md`](phase-09-release-readiness.md)                                 | 📋 ToDo   | 0/6      | —            |
| P11 | [`phase-11-finance-adapter.md`](phase-11-finance-adapter.md)                                     | 📋 ToDo   | 0/5      | —            |

---

## 2. How to run a task

1. Work one task at a time, in the order of its file's task index. A task whose "Depends on" is not ✅ Done does not start.
2. Paste the task's agent prompt into a fresh conversation opened at the repository root.
3. The prompt lists its required reading. Requirement identifiers (`FR16`, `SEC04`, `AC03`, `D11`) are defined in `docs/spec.md`.
4. One phase is one pull request to `main`, unless its file says otherwise. Commits follow Conventional Commits.
5. After the task is done, run its Completion Protocol. It updates the task file, the roadmap's dashboard and the phase index above.

## 3. Definition of Done for every task

- Every requirement the task cites has a test that fails without the implementation.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all` and `pnpm build` pass. Coverage is 100% for statements, branches, functions and lines in the unit suite, in the end-to-end suite and in both together.
- `pnpm mutation` scores 100 on the files the task touched before the phase's pull request is opened.
- No gate threshold, ignore list or baseline was loosened.
- No suppression comment was added.

## 4. Commands

These are the scripts of the scaffold P0 brings from `bymaxone/nest-telemetry`. P0 may rename one only by editing this table.

| Command                                   | Proves                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm typecheck`                          | Source, build and end-to-end TypeScript projects compile                            |
| `pnpm lint`                               | ESLint, the no-socket gate for unit tests and the spec header check                 |
| `pnpm test`                               | Unit suite, files `src/**/*.spec.ts`                                                |
| `pnpm test:e2e`                           | End-to-end suite, files `test/e2e/*.e2e-spec.ts`, against a real NestJS application |
| `pnpm test:cov:all`                       | Both suites together meet the coverage gate                                         |
| `pnpm build`                              | Every subpath builds in ESM and CommonJS with declarations                          |
| `pnpm mutation`                           | Stryker, thresholds 100                                                             |
| `pnpm check:exports`                      | Strict type resolution against the packed tarball                                   |
| `pnpm check:runtime`                      | Every subpath loads from the packed tarball in ESM and CommonJS                     |
| `pnpm check:api`                          | The public API surface matches its recorded baseline                                |
| `pnpm check:docs`, `pnpm check:published` | README snippets compile and its links resolve                                       |
| `pnpm size`                               | The bundle size budget holds                                                        |

## 5. Subpaths and directories

| Directory         | Subpath                                                                                          | May import from                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `src/shared/`     | `@bymax-one/nest-subscription/shared`                                                            | nothing                                                                |
| `src/internal/`   | not public; reached as `@bymax-one/nest-subscription/internal` by the library's own entry points | `shared`                                                               |
| `src/core/`       | `@bymax-one/nest-subscription`                                                                   | `shared`, `internal`                                                   |
| `src/revenuecat/` | `@bymax-one/nest-subscription/revenuecat`                                                        | `shared`, `internal`                                                   |
| `src/finance/`    | `@bymax-one/nest-subscription/finance`                                                           | `shared`, `internal`                                                   |
| `src/testing/`    | `@bymax-one/nest-subscription/testing`                                                           | `shared`, `internal`, and the adapters only for their request builders |

- An entry point reaches `internal` by package specifier, never by relative path, and the build marks it external. A relative import would copy the classes and tokens into each bundle.
- Every directory other than `src/shared/` reaches `shared` by package specifier too (`@bymax-one/nest-subscription/shared`), never by relative path, and the build marks it external. `shared` defines `SubscriptionError`, and a relative import would copy that class into each bundle, so `instanceof` would fail between a class thrown by one entry point and the class another entry point exports. `pnpm lint` fails a relative import of `shared` from the other directories.
- `src/core/` never imports an adapter. The host imports the adapter's factory from its subpath and passes the result in the module options. That is how an adapter that is not configured loads none of its code (NFR05).
- Unit tests sit beside their source as `*.spec.ts`. End-to-end tests are `test/e2e/<topic>.e2e-spec.ts`. Recorded provider payloads are under `test/fixtures/<source>/`.

## 6. Names

### 6.1 Model (`src/shared/`)

| Name                                                                                                                                                                                                                                     | Kind                                                                                                               | File                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `SubscriptionSnapshot`, `SubscriptionRecord`, `EntitlementState`, `SourceCustomerReference`                                                                                                                                              | types                                                                                                              | `snapshot.types.ts`     |
| `SUBSCRIPTION_STATUSES`, `WILL_RENEW_VALUES`, `SUBSCRIPTION_ORIGINS`, `SUBSCRIPTION_ENVIRONMENTS`, `CHANGE_KINDS` and their union types `SubscriptionStatus`, `WillRenew`, `SubscriptionOrigin`, `SubscriptionEnvironment`, `ChangeKind` | closed value sets                                                                                                  | `values.ts`             |
| `SUBSCRIPTION_ERROR_CODES`, `SubscriptionErrorCode`                                                                                                                                                                                      | closed catalogue, every code prefixed `SUBSCRIPTION_`                                                              | `error-codes.ts`        |
| `SubscriptionError`                                                                                                                                                                                                                      | the one error class, carrying a `SubscriptionErrorCode`; re-exported from `internal` and the root                  | `subscription.error.ts` |
| `parseInstant`                                                                                                                                                                                                                           | pure function: an ISO 8601 instant with a zone to milliseconds, or `SubscriptionError` with the invalid-input code | `instant.ts`            |
| `createEmptySnapshot`                                                                                                                                                                                                                    | function                                                                                                           | `empty-snapshot.ts`     |
| `resolveEntitlements`                                                                                                                                                                                                                    | pure function (FR05)                                                                                               | `entitlements.ts`       |
| `SubscriptionChange`                                                                                                                                                                                                                     | type: a change kind plus its stable key                                                                            | `change.types.ts`       |

### 6.2 Seams (`src/internal/`, re-exported from the root)

| Name                                                                                                                                     | Kind                                                                                                                  | File              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `SubscriptionSource`, `SourceCapabilities`, `WebhookRequest`, `WebhookVerification`, `SourceNotification`, `StopRenewalResult`           | the source port (FR07)                                                                                                | `source.port.ts`  |
| `SubscriptionStore`, `StoredSnapshot`                                                                                                    | the store port (FR22)                                                                                                 | `store.port.ts`   |
| `SUBSCRIPTION_OPTIONS`, `SUBSCRIPTION_SOURCE`, `SUBSCRIPTION_STORE`, `SUBSCRIPTION_CLOCK`, `SUBSCRIPTION_CACHE`, `SUBSCRIPTION_OBSERVER` | injection tokens, all symbols                                                                                         | `tokens.ts`       |
| `encodeAccountKey`                                                                                                                       | builds the tenant and account key (SEC08)                                                                             | `account-key.ts`  |
| `decodeAccountKey`                                                                                                                       | reads a key back into its account, or `null` (the reconciler needs the account of a listed key; no store-port change) | `account-key.ts`  |
| `Clock`                                                                                                                                  | type with one method returning the current instant                                                                    | `clock.ts`        |
| `Secret`                                                                                                                                 | holds a secret out of every enumerable property, with two valid values during rotation (SEC05, SEC09)                 | `secret.ts`       |
| `hashAccountKey`                                                                                                                         | short one-way hash of an account key, for correlation in logs (SEC06)                                                 | `account-hash.ts` |

### 6.3 Library (`src/core/`)

| Name                                                                                         | Kind                                                                                                                                                                 | File                                                                                |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `SubscriptionModule` with `forRoot` and `forRootAsync`                                       | NestJS module                                                                                                                                                        | `subscription.module.ts`                                                            |
| `SubscriptionModuleOptions`, `SubscriptionModuleAsyncOptions`, `ResolvedSubscriptionOptions` | option types                                                                                                                                                         | `options/subscription-options.types.ts`                                             |
| `resolveOptions`, `validateOptions`                                                          | functions                                                                                                                                                            | `options/resolve-options.ts`, `options/validate-options.ts`                         |
| `SubscriptionService`                                                                        | read, refresh, reconcile, manage                                                                                                                                     | `subscription.service.ts`                                                           |
| `SnapshotRefresher`                                                                          | single-flight refresh and ordered write                                                                                                                              | `refresh/snapshot-refresher.ts`                                                     |
| `RequiresEntitlement`                                                                        | route decorator                                                                                                                                                      | `guard/requires-entitlement.decorator.ts`                                           |
| `EntitlementGuard`                                                                           | guard                                                                                                                                                                | `guard/entitlement.guard.ts`                                                        |
| `AccountResolver`, `ResolvedAccount`                                                         | the host's resolver contract                                                                                                                                         | `guard/account-resolver.types.ts`                                                   |
| `diffSnapshots`, `changeKey`                                                                 | pure functions (FR32, FR33)                                                                                                                                          | `notifications/diff-snapshots.ts`, `notifications/change-key.ts`                    |
| `ChangeDispatcher`                                                                           | calls the host hook after a write                                                                                                                                    | `notifications/change-dispatcher.ts`                                                |
| `SubscriptionObserver`                                                                       | the optional observer contract (FR34)                                                                                                                                | `observer/observer.types.ts`                                                        |
| `SnapshotCache`                                                                              | read-through wrapper over the host's optional cache (FR23)                                                                                                           | `cache/snapshot-cache.ts`                                                           |
| `Reconciler`, `RateLimiter`, `ReconcileOptions`, `ReconcileResult`                           | reconciliation run, its sliding-window limiter and their types (FR26, NFR04)                                                                                         | `reconciliation/reconciler.ts`, `reconciliation/rate-limiter.ts`                    |
| `SingleFlight`, `ageOf`, `isStale`, `toSnapshotView`, `hasTenant`                            | helpers of the refresh and read path                                                                                                                                 | `refresh/single-flight.ts`, `refresh/staleness.ts`, `snapshot-view.ts`, `tenant.ts` |
| `decideAccess`, `applyFailPolicy`                                                            | pure guard decision and fail policy (FR30, FR31)                                                                                                                     | `guard/decide-access.ts`, `guard/fail-policy.ts`                                    |
| `findOwnRecord`                                                                              | the one ownership check of every management operation: finds a subscription or non-renewing purchase by reference inside the caller's own snapshot only (SEC10, D31) | `management/find-own-record.ts`                                                     |
| `WebhookProcessor`, `WebhookOutcome`                                                         | raw bytes and headers in, outcome out (FR17, FR18)                                                                                                                   | `webhook/webhook.processor.ts`, `webhook/webhook-outcome.ts`                        |
| `SubscriptionWebhookController`                                                              | optional controller, off by default                                                                                                                                  | `webhook/webhook.controller.ts`                                                     |

### 6.4 Adapters and testing

| Name                                                          | Kind                                                                     | File                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `revenueCatSource`, `RevenueCatSourceOptions`                 | factory returning a `SubscriptionSource`                                 | `src/revenuecat/revenuecat.source.ts`                                   |
| `financeSource`, `FinanceSourceOptions`                       | factory returning a `SubscriptionSource`                                 | `src/finance/finance.source.ts`                                         |
| `InMemorySubscriptionStore`                                   | store for tests and development, not for production                      | `src/testing/in-memory.store.ts`                                        |
| `storeConformanceCases`                                       | the conformance suite as framework-neutral cases (D11)                   | `src/testing/store-conformance.ts`                                      |
| `FakeSubscriptionSource`                                      | scriptable source (FR39)                                                 | `src/testing/fake.source.ts`                                            |
| `ManualClock`                                                 | a clock a test moves by hand, so no test waits on a timer (NFR03, NFR04) | `src/testing/manual.clock.ts`                                           |
| `buildRevenueCatWebhookRequest`, `buildFinanceWebhookRequest` | signed request builders (FR39)                                           | `src/testing/revenuecat-requests.ts`, `src/testing/finance-requests.ts` |
| `createFailingStore`                                          | wraps a store and fails the methods a test names                         | `src/testing/failing.store.ts`                                          |
| `createCapture`, `assertNoSentinel`                           | capturing logger and observer, and the sweep for secrets and identifiers | `src/testing/capture.ts`                                                |

## 7. Documents written by tasks

| Document                                                 | Written by                         | Read by                                         |
| -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| `docs/revenuecat-facts.md`                               | tasks 7.1, 7.8, 8.3 and 8.6 to 8.9 | the rest of P7, P8 and the provider watch of P9 |
| `docs/raw-body.md`, `docs/reference-store.md`            | task 9.2                           | hosts                                           |
| `docs/acceptance.md`, `docs/mutation_testing_results.md` | task 9.4                           | the owner, before a release                     |
| `docs/finance-facts.md`                                  | task 11.1                          | the rest of P11                                 |

## 8. Rules that recur in every phase

- **Access comes from the source's flag.** No code derives access from a status name (FR02, R02).
- **A webhook payload never writes state.** It only triggers a read of the source (FR16, SEC01).
- **A secret never sits in an enumerable property.** A class that owns one uses a `#private` field; the module options hold no secret and each adapter factory holds its credentials in a `Secret` (D26). Tests cover `JSON.stringify`, spread, `util.inspect` and `util.inspect` with `showHidden` (SEC05).
- **A key built from more than one field keeps its boundaries** (`AGENTS.md` §3). Tenant and account go through `encodeAccountKey`, nowhere else.
- **Time comes from the injected `Clock`.** No test waits on a real timer.
- **Unit tests open no socket.** HTTP to a provider is replaced by a local stand-in in the end-to-end suite and by a stubbed `fetch` in unit tests.
- **A provider fact is re-read at its source** (specification §12) before code relies on it, and the pull request cites the page.
