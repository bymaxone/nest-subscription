# Phase 1 — Model, ports and test doubles

> **Status**: 🔄 In Progress &nbsp;·&nbsp; **Progress**: 0 / 7 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-24
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P1 — model-ports-and-test-doubles
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the package is an empty, fully gated scaffold: the entry points under `src/shared/`, `src/internal/`, `src/core/`, `src/revenuecat/`, `src/finance/` and `src/testing/` export nothing.

At the end the library has its vocabulary and its two seams. The `shared` subpath carries the normalized model, the closed value sets, the change kinds and the error-code catalogue, with no runtime dependency. The internal bundle carries the source port, the store port, the injection tokens, the error class and the account key encoder. The `testing` subpath carries an in-memory store, a conformance suite a host runs against its own store, and a scriptable fake source. There is still no NestJS module and no network call.

---

## Rules-of-phase

1. The guard-relevant truth is the "gives access" flag from the source. No helper derives access from a status name (FR02, R02).
2. The `shared` subpath has no runtime import. A value it needs at run time is a literal in it.
3. The conformance suite asserts behaviour through the store port only, so it runs unchanged against any host store.
4. Error codes are a closed catalogue with the one prefix `SUBSCRIPTION_`. Adding or renaming one later is a public change.
5. Every type that crosses a port is exported from the root, so a host can implement an adapter or a store with no private entry (FR08).

---

## Reference docs

- `docs/spec.md` §3.4 (model), §3.5 (source port), §3.9 FR22 (store port), §3.11 FR32 (change kinds), §3.13 (testing support), §6.4 (errors), §7 (data the host stores)
- `docs/plan.md` § "P1 — model-ports-and-test-doubles"
- `AGENTS.md` §3, "A key built from more than one field keeps its boundaries"
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                                                | Status  | Priority | Size | Depends on |
| --- | ------------------------------------------------------------------- | ------- | -------- | ---- | ---------- |
| 1.1 | Define the snapshot model and its closed value sets                 | 📋 ToDo | P0       | M    | —          |
| 1.2 | Define the error-code catalogue and the error class                 | 📋 ToDo | P0       | S    | 1.1        |
| 1.3 | Implement the empty snapshot and the entitlement resolution         | 📋 ToDo | P0       | M    | 1.1        |
| 1.4 | Implement the tenant and account key encoder                        | 📋 ToDo | P0       | S    | 1.2        |
| 1.5 | Define the source port, the store port and the injection tokens     | 📋 ToDo | P0       | M    | 1.2        |
| 1.6 | Implement the in-memory store and the conformance suite             | 📋 ToDo | P0       | L    | 1.4, 1.5   |
| 1.7 | Implement the fake source and prove the shared subpath stands alone | 📋 ToDo | P0       | M    | 1.5        |

---

## Tasks

### Task 1.1 — Define the snapshot model and its closed value sets

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Write the types of the snapshot, the subscription record and the entitlement, and the closed sets of status, will-renew, origin, environment and change-kind values (FR01, FR02, FR03, FR32).

#### Acceptance criteria

- [ ] `SubscriptionSnapshot`, `SubscriptionRecord`, `EntitlementState` and `SourceCustomerReference` carry every field of the FR01 and FR02 tables, with instants as ISO 8601 strings and "not applicable" as `null`.
- [ ] Each value set is a frozen `as const` tuple with its union type derived from it, and a test pins the exact members of each set against the specification.
- [ ] A table-driven test states, for every status of FR03, whether it means access, and asserts that no exported function takes a status and returns access.
- [ ] The `shared` entry point exports these names and imports nothing at run time.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/shared/snapshot.types.ts`
- ✚ `src/shared/values.ts`, `src/shared/values.spec.ts`
- ✚ `src/shared/change.types.ts`
- ✎ `src/shared/index.ts`, `src/shared/index.spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P1 (model-ports-and-test-doubles) — Task 1.1 of 7 (FIRST of this phase)

PRECONDITIONS
- P0 is ✅ Done: the package builds, the six entry points exist and every gate passes on them.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` "Document contract and reading guide" (vocabulary), §3.4 (FR01 to FR06), §3.11 (FR32)
- `docs/plan.md` § "P1 — model-ports-and-test-doubles"

TASK
Create the normalized model types and the closed value sets in `src/shared/`, exactly as the specification's tables define them.

DELIVERABLES

1. `src/shared/values.ts`: `SUBSCRIPTION_STATUSES` (`trialing`, `active`, `in_grace`, `on_hold`, `paused`, `expired`, `unknown`), `WILL_RENEW_VALUES` (`yes`, `no`, `changes_product`, `pauses`, `unknown`), `SUBSCRIPTION_ORIGINS` (`app_store`, `play_store`, `web`, `promotional`, `other`), `SUBSCRIPTION_ENVIRONMENTS` (`production`, `sandbox`) and `CHANGE_KINDS` (the list of FR32), each frozen, each with its derived union type.

2. `src/shared/snapshot.types.ts`: `SubscriptionSnapshot` (account identifier, optional tenant identifier, entitlements, subscriptions, source name, source customer reference, fetched at, source updated at), `SubscriptionRecord` (the FR02 fields, including `givesAccess: boolean` and `accessUntil: string | null`), `EntitlementState` (name, active, until, granting subscription reference) and `SourceCustomerReference`. All properties `readonly`.

3. `src/shared/change.types.ts`: `SubscriptionChange`, a change kind plus a stable key string.

4. Specs that pin each set's members and prove the tuples are frozen. Type-level expectations go in a spec that fails to compile when a field is renamed.

Constraints:
- Field names are camelCase English renderings of the specification's table rows; do not add a field the tables do not have.
- Do not write a function from status to access: the model carries `givesAccess`, and that flag is the only source of access.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/shared` — expected: pass at 100% coverage of the directory
- `pnpm build && pnpm check:api` — expected: the API baseline changes only by the names above; update the baseline in this task

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-01-model-ports-and-test-doubles.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P1 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 1.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 1.2 — Define the error-code catalogue and the error class

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1

#### Description

Write the closed catalogue of error codes in `shared` and the one error class that carries a code, in the internal bundle (specification §6.4).

#### Acceptance criteria

- [ ] The catalogue has one code for each case of §6.4: refused webhook, unknown account, entitlement required, subscription gives no access, source unavailable, operation not possible for this origin, and the configuration errors.
- [ ] Every code starts with `SUBSCRIPTION_`, and a test fails when two entries share a value.
- [ ] `SubscriptionError` carries a code, a message from the catalogue and an optional cause, and its serialized form contains nothing but the code and the message.
- [ ] An `instanceof SubscriptionError` check holds across the root and an adapter subpath, proven from the built package.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/shared/error-codes.ts`, `src/shared/error-codes.spec.ts`
- ✚ `src/internal/subscription.error.ts`, `src/internal/subscription.error.spec.ts`
- ✎ `src/shared/index.ts`, `src/internal/index.ts`, `src/core/index.ts`
- ✎ `test/e2e/entrypoints.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P1 (model-ports-and-test-doubles) — Task 1.2 of 7 (MIDDLE of this phase)

PRECONDITIONS
- P0 is ✅ Done: the package builds, the six entry points exist and every gate passes on them.
- Task 1.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §6.4, §8.2 (SEC03, SEC05, SEC06)
- `docs/plan.md` § "Target layout" (why `src/internal/` exists)

TASK
Create `SUBSCRIPTION_ERROR_CODES` in the shared subpath and `SubscriptionError` in the internal bundle, re-exported from the root.

DELIVERABLES

1. `src/shared/error-codes.ts`: a frozen object mapping names to code strings, the `SubscriptionErrorCode` union, and a frozen map from code to its fixed English message. Messages never interpolate an identifier, a secret or a provider payload.

2. `src/internal/subscription.error.ts`: `SubscriptionError extends Error` with `code`, a `cause` passed through the standard options bag, and a `toJSON` that returns only `{ code, message }`.

3. Root re-exports of the class and the codes. An end-to-end assertion that the class imported from the root and from `revenuecat` is the same constructor in the built package, in ESM and CommonJS.

Constraints:
- The refused-webhook code has one message for every kind of verification failure (SEC03).
- Import the internal bundle by the package specifier `@bymax-one/nest-subscription/internal`, never by relative path.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/shared src/internal` — expected: pass
- `pnpm build && pnpm test:e2e -t "entry points"` — expected: the identity assertion passes in both formats

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-01-model-ports-and-test-doubles.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P1 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 1.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 1.3 — Implement the empty snapshot and the entitlement resolution

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.1

#### Description

Write the two pure functions of the model: the snapshot of an account the source does not know (FR04) and the resolution of entitlements across several subscriptions (FR05).

#### Acceptance criteria

- [ ] `createEmptySnapshot` returns a snapshot with no entitlements and no subscriptions, and never throws for an unknown account.
- [ ] `resolveEntitlements` marks an entitlement active when any subscription that grants it gives access, and sets its "until" to the latest `accessUntil` among them, with `null` (lifetime) winning over any date.
- [ ] A table-driven test covers: one subscription; two granting the same entitlement with one inactive; two both active with different ends; a lifetime grant beside a dated one; a subscription with `unknown` status whose access flag is true; no subscriptions.
- [ ] The function reports the overlap (more than one subscription giving access to the same entitlement) in its result, for the notification phase to use.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/shared/empty-snapshot.ts`, `src/shared/empty-snapshot.spec.ts`
- ✚ `src/shared/entitlements.ts`, `src/shared/entitlements.spec.ts`
- ✎ `src/shared/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P1 (model-ports-and-test-doubles) — Task 1.3 of 7 (MIDDLE of this phase)

PRECONDITIONS
- P0 is ✅ Done: the package builds, the six entry points exist and every gate passes on them.
- Task 1.1 is ✅ Done: the model types and value sets exist in `src/shared/`.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.4 (FR02 to FR05), §9 (R02)

TASK
Implement `createEmptySnapshot` and `resolveEntitlements` as pure functions in `src/shared/`.

DELIVERABLES

1. `createEmptySnapshot(input)`: takes the account identifier, the optional tenant identifier, the source name and the fetched-at instant, and returns the FR04 value.

2. `resolveEntitlements(subscriptions, grants)`: takes the subscription records and, for each, the entitlement names it grants, and returns the entitlement list plus the names that overlap. It reads `givesAccess` and `accessUntil` only.

3. Table-driven specs whose rows are named by the rule they protect.

Constraints:
- No date library: compare ISO 8601 instants through `Date.parse`, and treat an unparseable instant as a caller error with a typed failure, covered by a test.
- The functions are pure: same input, same output, no clock, no mutation of the arguments.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/shared` — expected: pass at 100%
- `pnpm mutation --mutate "src/shared/entitlements.ts,src/shared/empty-snapshot.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-01-model-ports-and-test-doubles.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P1 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 1.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 1.4 — Implement the tenant and account key encoder

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.2

#### Description

Write the one function that turns a tenant identifier and an account identifier into a key, so that no pair can collide with another (SEC08).

#### Acceptance criteria

- [ ] Two different (tenant, account) pairs never produce the same key, including pairs whose text contains the delimiter, an empty tenant, and unicode.
- [ ] The key of an account with no tenant differs from the key of any account with a tenant.
- [ ] An empty or blank account identifier is refused with a `SubscriptionError`.
- [ ] A property-style test over generated pairs asserts injectivity, and a fixed table pins the known collision shapes (`("a:b","c")` against `("a","b:c")`).
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/internal/account-key.ts`, `src/internal/account-key.spec.ts`
- ✎ `src/internal/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P1 (model-ports-and-test-doubles) — Task 1.4 of 7 (MIDDLE of this phase)

PRECONDITIONS
- P0 is ✅ Done: the package builds, the six entry points exist and every gate passes on them.
- Task 1.2 is ✅ Done: `SubscriptionError` exists in `src/internal/`.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `AGENTS.md` §3, "A key built from more than one field keeps its boundaries"
- `docs/spec.md` §7, §8.2 (SEC08)

TASK
Implement `encodeAccountKey` in `src/internal/` so that the boundary between tenant and account is recoverable by construction.

DELIVERABLES

1. `encodeAccountKey({ tenantId, accountId })`: encodes each field so it cannot contain the delimiter (for example length-prefixing or percent-encoding each field), with a distinct marker for "no tenant". The header comment states the construction and why it is injective.

2. A spec with the fixed collision table and a generated-pairs loop that needs no new dependency.

Constraints:
- Do not hash: the key must stay readable by a host that stores it, and a digest does not repair an ambiguous join.
- This is the only place in the library that joins tenant and account.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/internal/account-key.spec.ts` — expected: pass
- `pnpm mutation --mutate "src/internal/account-key.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-01-model-ports-and-test-doubles.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P1 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 1.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 1.5 — Define the source port, the store port and the injection tokens

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.2

#### Description

Write the two interfaces every later phase builds on, and the symbol tokens they are injected under (FR07, FR08, FR09, FR22).

#### Acceptance criteria

- [ ] `SubscriptionSource` has the four abilities of FR07: read one account, verify a webhook from raw bytes and headers, declare capabilities per origin, and perform the declared management operations.
- [ ] `SubscriptionStore` can read and write a snapshot by key, record a processed event identifier atomically (telling the caller whether it was new), forget one event identifier, forget event identifiers older than a retention, and list keys whose snapshot is older than a threshold in bounded pages.
- [ ] A snapshot write stores, in the same atomic write, the changes the host has not been told yet; the port can clear them by change key and list the keys that still have some, in bounded pages (FR33, D17).
- [ ] The write method takes the source-updated-at instant and its contract says an older snapshot must not replace a newer one (FR27).
- [ ] Every token is a `Symbol` with a description, and every port type is exported from the root.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/internal/source.port.ts`
- ✚ `src/internal/store.port.ts`
- ✚ `src/internal/tokens.ts`, `src/internal/tokens.spec.ts`
- ✚ `src/internal/clock.ts`
- ✎ `src/internal/index.ts`, `src/core/index.ts`, `src/core/index.spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P1 (model-ports-and-test-doubles) — Task 1.5 of 7 (MIDDLE of this phase)

PRECONDITIONS
- P0 is ✅ Done: the package builds, the six entry points exist and every gate passes on them.
- Tasks 1.1 and 1.2 are ✅ Done: the model and `SubscriptionError` exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.5, §3.8 (FR16 to FR19), §3.9, §3.11 (FR33), §3.12 (FR35 to FR38), §7, §10.1 (D16, D17)
- `docs/tasks/README.md` §6.2

TASK
Define `SubscriptionSource`, `SubscriptionStore`, `Clock` and the injection tokens in `src/internal/`, and re-export them from the root.

DELIVERABLES

1. `source.port.ts`: `SubscriptionSource` with `name`, `readAccount(account)` returning a `SubscriptionSnapshot`, `verifyWebhook(request)` returning a `WebhookVerification` (either a refusal with no reason exposed, or a `SourceNotification` with event identifier, affected accounts, kind, event time and environment), `capabilities(subscription)` returning `SourceCapabilities`, and `stopRenewal(account, subscription)` returning a `StopRenewalResult`. `WebhookRequest` is `{ rawBody: Uint8Array; headers: Readonly<Record<string, string | undefined>> }`.

2. `store.port.ts`: `SubscriptionStore` with `getSnapshot(key)` returning a `StoredSnapshot` (the snapshot plus its `pendingChanges`), `putSnapshot(key, snapshot, pendingChanges)` returning whether it was written and appending the new changes to the ones already pending, `clearPendingChanges(key, changeKeys)`, `listKeysWithPendingChanges(limit, cursor)`, `markEventProcessed(source, eventId, receivedAt)` returning whether the identifier was new, `forgetEvent(source, eventId)`, `deleteEventsOlderThan(instant)` and `listStaleKeys(olderThan, limit, cursor)`. Each method's doc comment states the guarantee the conformance suite will test.

3. `tokens.ts`: `SUBSCRIPTION_OPTIONS`, `SUBSCRIPTION_SOURCE`, `SUBSCRIPTION_STORE`, `SUBSCRIPTION_CLOCK`, `SUBSCRIPTION_CACHE`, `SUBSCRIPTION_OBSERVER`. `clock.ts`: `Clock` with `now(): Date`.

4. The doc comment of `SubscriptionSource` states FR09: an adapter never returns a state inferred from a webhook payload alone when it can read the source.

Constraints:
- Ports are types only: no base class, no decorator, so a host implements them with no import beyond types.
- `forgetEvent` exists because a webhook event that ends in the failed outcome has its identifier removed, so the retry is processed (D16). The receiver that calls it is built in P6.
- The pending changes travel in the same write as the snapshot: a store that writes them separately can lose a change in a crash, and the conformance suite must catch that (D17).
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm typecheck && pnpm test src/internal src/core` — expected: pass
- `pnpm build && pnpm check:api` — expected: baseline updated with the port types and tokens only

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-01-model-ports-and-test-doubles.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P1 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 1.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 1.6 — Implement the in-memory store and the conformance suite

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.4, 1.5

#### Description

Write the in-memory store for tests and development, and the conformance cases a host runs against its own store (FR22, D11, R05).

#### Acceptance criteria

- [ ] `InMemorySubscriptionStore` passes every conformance case.
- [ ] A deliberately broken store fails on a named case for each defect: no uniqueness on event identifiers, an older snapshot replacing a newer one, keys of two tenants colliding, a stale listing that ignores its limit, pending changes dropped or overwritten by a later write, pending changes not cleared by key.
- [ ] `storeConformanceCases` returns framework-neutral cases (a name and an async function taking a store factory) that throw through `node:assert` on failure, so they run under Jest, Vitest or `node --test`.
- [ ] The in-memory store warns once at construction that it is not for production, through an injectable logger function, and never to the console in tests.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/testing/in-memory.store.ts`, `src/testing/in-memory.store.spec.ts`
- ✚ `src/testing/store-conformance.ts`, `src/testing/store-conformance.spec.ts`
- ✚ `src/testing/broken-stores.fixture.ts` (test-only, not exported)
- ✎ `src/testing/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P1 (model-ports-and-test-doubles) — Task 1.6 of 7 (MIDDLE of this phase)

PRECONDITIONS
- P0 is ✅ Done: the package builds, the six entry points exist and every gate passes on them.
- Tasks 1.4 and 1.5 are ✅ Done: `encodeAccountKey`, `SubscriptionStore` and `Clock` exist in `src/internal/`.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.9 (FR22, FR27), §3.11 (FR33), §7, §9 (R05), §10.1 (D11, D16, D17)
- The doc comments of `src/internal/store.port.ts`

TASK
Implement `InMemorySubscriptionStore` and `storeConformanceCases` in `src/testing/`, with the suite proving itself against broken stores.

DELIVERABLES

1. `in-memory.store.ts`: a `Map`-backed implementation of every port method, with concurrent `markEventProcessed` calls for one identifier yielding exactly one "new".

2. `store-conformance.ts`: cases for round-trip of a snapshot, isolation between keys and tenants, ordered writes under sequential and interleaved calls, event uniqueness under concurrency, `forgetEvent` (a forgotten identifier is new again), retention deletion, paged stale listing with a limit and a cursor, and pending changes: stored with the write, accumulated across writes, cleared by change key only, listed in bounded pages.

3. A spec that runs the cases against the in-memory store (all pass) and against each broken store (the expected case fails and the others pass).

Constraints:
- The suite talks to the store through the port only: no access to internals, no `instanceof`.
- Cases use `node:assert/strict` and an injected clock; no test framework global appears in `store-conformance.ts`.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/testing` — expected: pass at 100%
- `pnpm mutation --mutate "src/testing/in-memory.store.ts,src/testing/store-conformance.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-01-model-ports-and-test-doubles.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P1 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 1.6 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 1.7 — Implement the fake source and prove the shared subpath stands alone

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.5

#### Description

Write the scriptable fake source (FR39) and the packaging tests that close the phase: the shared subpath loads without NestJS, and a host adapter needs no private entry (FR06, FR08).

#### Acceptance criteria

- [ ] `FakeSubscriptionSource` implements `SubscriptionSource` and lets a test set an account's state, queue a notification, fail the next read, delay the next read, and count reads per account.
- [ ] Its `verifyWebhook` accepts requests built by its own `buildRequest` helper and refuses any other body.
- [ ] Loading `@bymax-one/nest-subscription/shared` from the packed tarball in a directory with no `@nestjs/*` installed succeeds in ESM and CommonJS.
- [ ] A test file that implements a source using only root exports compiles and runs.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/testing/fake.source.ts`, `src/testing/fake.source.spec.ts`
- ✎ `src/testing/index.ts`
- ✎ `scripts/check-consumer-runtime.mjs` — add the "shared without NestJS" case
- ✚ `test/e2e/custom-source.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P1 (model-ports-and-test-doubles) — Task 1.7 of 7 (LAST of this phase)

PRECONDITIONS
- P0 is ✅ Done: the package builds, the six entry points exist and every gate passes on them.
- Task 1.5 is ✅ Done: the ports and tokens exist and are exported from the root.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.5 (FR08), §3.4 (FR06), §3.13 (FR39)
- `scripts/check-consumer-runtime.mjs` as P0 left it

TASK
Implement `FakeSubscriptionSource` and add the two packaging proofs that the phase's Definition of Done asks for.

DELIVERABLES

1. `fake.source.ts`: the scriptable source, with capabilities and a stop-renewal result a test can script per origin, and a read counter the later phases use to assert "zero source calls".

2. The runtime check extended so that `shared` is loaded from the tarball in a scratch directory that has no NestJS package.

3. `test/e2e/custom-source.e2e-spec.ts`: a source written against root exports only, exercised through the port.

Constraints:
- The fake source uses no private entry of the library: it is the proof that a host can write one.
- Delays are driven by promises the test resolves, never by timers.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/testing && pnpm test:e2e` — expected: pass
- `pnpm build && pnpm check:runtime` — expected: the new "shared without NestJS" case passes in both formats
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100 for the whole phase

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-01-model-ports-and-test-doubles.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P1 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 1.7 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->
