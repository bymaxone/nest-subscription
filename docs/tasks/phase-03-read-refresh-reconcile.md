# Phase 3 — Read, refresh and reconcile

> **Status**: 🔄 In Progress &nbsp;·&nbsp; **Progress**: 2 / 5 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-25
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P3 — read-refresh-reconcile
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the module boots and wires a source and a store, and no service reads or writes a snapshot.

At the end `SubscriptionService` answers the two questions a host asks (what is this account's state, does it have this entitlement) from the store, without waiting for the source, refreshes one account from the source on demand with concurrent calls collapsed into one, refreshes a stale snapshot in the background, never lets an older snapshot replace a newer one, reads through an optional cache, and reconciles old snapshots in bounded, rate-limited batches the host schedules. The guard, the change notifications and the webhooks are later phases that call what this phase builds.

---

## Rules-of-phase

1. A read never calls the source. Only an explicit refresh, a background staleness refresh and reconciliation do.
2. A background refresh never changes what the current read returns and never rejects it.
3. A source failure during a refresh leaves the stored snapshot untouched and surfaces as the catalogue's "source unavailable" code.
4. Time comes from the injected `Clock`. No test waits on a real timer.
5. The tenant is part of every key and comes from the caller's arguments, never from a payload (SEC08).

---

## Reference docs

- `docs/spec.md` §3.9 (FR22 to FR27), §3.10 (FR28), §7, §8.1 (NFR03, NFR04), §8.2 (SEC08), §9 (R05, R06)
- `docs/plan.md` § "P3 — read-refresh-reconcile"
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                                          | Status  | Priority | Size | Depends on |
| --- | ------------------------------------------------------------- | ------- | -------- | ---- | ---------- |
| 3.1 | Implement the refresher with single flight and ordered writes | ✅ Done | P0       | L    | —          |
| 3.2 | Implement the service reads                                   | ✅ Done | P0       | M    | 3.1        |
| 3.3 | Refresh a stale snapshot in the background                    | 📋 ToDo | P0       | M    | 3.2        |
| 3.4 | Read through the optional cache                               | 📋 ToDo | P1       | M    | 3.2        |
| 3.5 | Implement reconciliation                                      | 📋 ToDo | P0       | M    | 3.1, 3.2   |

---

## Tasks

### Task 3.1 — Implement the refresher with single flight and ordered writes

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: —

#### Description

Write the one component that reads an account from the source and stores the result: concurrent refreshes of one account become one source call, and an older snapshot never replaces a newer one (FR24, FR27, NFR03).

#### Acceptance criteria

- [x] One hundred concurrent refreshes of one account produce exactly one `readAccount` call on the fake source, and all hundred callers get the same snapshot.
- [x] Refreshes of different accounts, and of the same account identifier under different tenants, do not wait for each other.
- [x] A snapshot whose source-updated-at is older than the stored one is not written, under sequential calls and when two reads resolve in the opposite order to their start.
- [x] A failed read rejects every waiting caller with the "source unavailable" code, leaves the stored snapshot untouched, and the next refresh calls the source again.
- [x] The refresher returns the previous and the new snapshot and whether a write happened, for the notification phase to consume.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/refresh/single-flight.ts`, `src/core/refresh/single-flight.spec.ts`
- ✚ `src/core/refresh/snapshot-refresher.ts`, `src/core/refresh/snapshot-refresher.spec.ts`
- ✎ `src/core/subscription.module.ts` — provide `SnapshotRefresher`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P3 (read-refresh-reconcile) — Task 3.1 of 5 (FIRST of this phase)

PRECONDITIONS
- P2 is ✅ Done: `SubscriptionModule` boots with `FakeSubscriptionSource` and `InMemorySubscriptionStore`, and provides the source, store, clock, options and optional cache under the tokens of `src/internal/tokens.ts`.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.9 (FR24, FR27), §8.1 (NFR03), §9 (R06)
- `docs/plan.md` § "P3 — read-refresh-reconcile"
- `src/internal/source.port.ts`, `src/internal/store.port.ts`, `src/testing/fake.source.ts`

TASK
Implement `SnapshotRefresher` in `src/core/refresh/`, with a small single-flight helper keyed by `encodeAccountKey`.

DELIVERABLES

1. `single-flight.ts`: runs one promise per key at a time and shares its result or its rejection with every caller that arrived meanwhile; the entry is removed when the promise settles, including on rejection.

2. `snapshot-refresher.ts`: `refresh(account)` reads the source, stamps fetched-at from the `Clock`, reads the stored snapshot, writes through `putSnapshot` (with an empty list of pending changes until the change list exists in P5) and returns `{ previous, current, written }`. A source error is wrapped in `SubscriptionError` with the source-unavailable code and the original error as cause.

3. Specs driving ordering with promises the test resolves by hand, and the fake source's read counter.

Constraints:
- Ordering is enforced by the store contract and checked again here: do not assume the store alone protects it, and do not write when the source reports an older state.
- The single-flight map must not grow: a spec asserts it is empty after success and after failure.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/refresh` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/refresh/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-03-read-refresh-reconcile.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P3 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 3.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 3.2 — Implement the service reads

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.1

#### Description

Write `SubscriptionService` with its two reads and the on-demand refresh, answering from the store and never waiting for the source unless asked (FR28, FR04).

#### Acceptance criteria

- [x] On a fresh snapshot `getSnapshot(account)` and `hasEntitlement(account, name)` make zero source calls, asserted with the fake source's read counter, and neither ever waits for a source call.
- [x] An account with no stored snapshot yields the empty snapshot and `false`, not an error.
- [x] `hasEntitlement` answers from the entitlement's active flag, which comes from the source's access flag, and is `false` for an entitlement the account lacks.
- [x] `refresh(account)` delegates to `SnapshotRefresher` and returns the stored snapshot.
- [x] Reading account A never returns data of account B, across tenants and when identifiers contain the key delimiter.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/subscription.service.ts`, `src/core/subscription.service.spec.ts`
- ✎ `src/core/subscription.module.ts`, `src/core/index.ts`
- ✚ `test/e2e/read-and-refresh.e2e-spec.ts`
- ✎ `test/e2e/secret-containment.e2e-spec.ts` — add the new providers

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P3 (read-refresh-reconcile) — Task 3.2 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P2 is ✅ Done: `SubscriptionModule` boots with `FakeSubscriptionSource` and `InMemorySubscriptionStore`, and provides the source, store, clock, options and optional cache under the tokens of `src/internal/tokens.ts`.
- Task 3.1 is ✅ Done: `SnapshotRefresher` exists and is provided by the module.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.4 (FR04, FR05), §3.10 (FR28), §8.2 (SEC08)
- `src/core/refresh/snapshot-refresher.ts`

TASK
Implement `SubscriptionService` with `getSnapshot`, `hasEntitlement` and `refresh`.

DELIVERABLES

1. `subscription.service.ts`: an injectable service taking an account reference (`{ accountId, tenantId? }`), with the three methods. In a multi-tenant configuration a missing tenant is refused with a `SubscriptionError`.

2. `test/e2e/read-and-refresh.e2e-spec.ts`: a real application; set a state on the fake source, refresh, read; assert the source call counts.

Constraints:
- Each snapshot returned carries its age, computed from fetched-at and the `Clock` (FR25).
- The service returns frozen snapshots; a caller cannot mutate stored state through the result.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/subscription.service.spec.ts && pnpm test:e2e -t "read and refresh"` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-03-read-refresh-reconcile.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P3 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 3.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 3.3 — Refresh a stale snapshot in the background

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.2

#### Description

When a read finds a snapshot older than the maximum age, start a refresh without waiting for it and return the stored value (FR25, D12).

#### Acceptance criteria

- [ ] A read of a snapshot older than the maximum age returns the stored snapshot and starts exactly one background refresh.
- [ ] A read of a fresh snapshot starts none; the boundary (age equal to the maximum) is pinned by a test.
- [ ] A background refresh that fails does not reject the read and does not produce an unhandled rejection; the failure is reported to the log and, when present, to the observer hook point.
- [ ] Many reads of one stale account while the refresh is in flight start one source call.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/refresh/staleness.ts`, `src/core/refresh/staleness.spec.ts`
- ✎ `src/core/subscription.service.ts`, `src/core/subscription.service.spec.ts`
- ✎ `test/e2e/read-and-refresh.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P3 (read-refresh-reconcile) — Task 3.3 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P2 is ✅ Done: `SubscriptionModule` boots with `FakeSubscriptionSource` and `InMemorySubscriptionStore`, and provides the source, store, clock, options and optional cache under the tokens of `src/internal/tokens.ts`.
- Tasks 3.1 and 3.2 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.9 (FR25), §10.1 (D12)
- `src/core/subscription.service.ts`, `src/core/refresh/snapshot-refresher.ts`

TASK
Add staleness detection and the background refresh to the service's reads.

DELIVERABLES

1. `staleness.ts`: a pure `isStale(snapshot, now, maxAgeMs)` and `ageOf(snapshot, now)`.

2. In the service: after a read, if stale, call the refresher without awaiting, with the rejection handled explicitly.

3. Specs using a controllable `Clock` and promises resolved by hand; one spec asserts no `unhandledRejection` fires.

Constraints:
- The background refresh never delays the read's return.
- Do not log an account identifier: log the failure's error code only (SEC06).
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/refresh/staleness.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-03-read-refresh-reconcile.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P3 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 3.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 3.4 — Read through the optional cache

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: M
- **Depends on**: 3.2

#### Description

When the host provides a cache, read through it in front of the store with a short lifetime, and invalidate it on every change (FR23).

#### Acceptance criteria

- [ ] With a cache configured, a second read of the same account does not reach the store.
- [ ] After any write of that account's snapshot, the next read returns the new value.
- [ ] A cache that throws on `get`, `set` or `delete` degrades to the store and never fails a read or a write.
- [ ] With no cache configured, every test of the phase still passes and no cache code runs on the read path.
- [ ] Cache keys go through `encodeAccountKey` with a fixed prefix, and two tenants never share an entry.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/cache/snapshot-cache.ts`, `src/core/cache/snapshot-cache.spec.ts`
- ✎ `src/core/subscription.service.ts`, `src/core/refresh/snapshot-refresher.ts` and their specs
- ✚ `test/e2e/cache.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P3 (read-refresh-reconcile) — Task 3.4 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P2 is ✅ Done: `SubscriptionModule` boots with `FakeSubscriptionSource` and `InMemorySubscriptionStore`, and provides the source, store, clock, options and optional cache under the tokens of `src/internal/tokens.ts`.
- Tasks 3.1 and 3.2 are ✅ Done.
- The cache option is an object with `get`, `set` and `delete`, typed in this library (task 2.4).

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.9 (FR23), §6.2 (optional integration)
- `src/core/options/subscription-options.types.ts`

TASK
Add a read-through snapshot cache that is used only when the host configured one.

DELIVERABLES

1. `snapshot-cache.ts`: `SnapshotCache` wrapping the host's cache with `read(key, load)`, `invalidate(key)`, a configurable lifetime with a short default, and failure containment.

2. Invalidation called from the refresher after every successful write, before the caller is answered.

3. `test/e2e/cache.e2e-spec.ts`: a map-backed cache and a throwing cache.

Constraints:
- A cached snapshot is still a stored snapshot that came from a source read (SEC01); the cache never receives anything else.
- Do not import `@bymax-one/nest-cache`.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/cache && pnpm test:e2e -t "cache"` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-03-read-refresh-reconcile.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P3 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 3.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 3.5 — Implement reconciliation

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.1, 3.2

#### Description

Expose a method that refreshes the accounts whose snapshot is older than a threshold, in bounded batches under a rate limit, for the host to call from its own scheduler (FR26, NFR04).

#### Acceptance criteria

- [ ] A run refreshes only accounts older than the threshold, and stops at the configured batch bound.
- [ ] The number of source calls in any window never exceeds the configured rate, asserted with a controllable clock.
- [ ] One account's failure does not stop the run; the result reports refreshed, failed and remaining counts and a cursor to continue.
- [ ] A run makes no change for an account whose refresh returns an older or identical state.
- [ ] The library starts no timer and no scheduler of its own.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/reconciliation/rate-limiter.ts`, `src/core/reconciliation/rate-limiter.spec.ts`
- ✚ `src/core/reconciliation/reconciler.ts`, `src/core/reconciliation/reconciler.spec.ts`
- ✎ `src/core/subscription.service.ts` — add `reconcile(options)`
- ✚ `test/e2e/reconciliation.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P3 (read-refresh-reconcile) — Task 3.5 of 5 (LAST of this phase)

PRECONDITIONS
- P2 is ✅ Done: `SubscriptionModule` boots with `FakeSubscriptionSource` and `InMemorySubscriptionStore`, and provides the source, store, clock, options and optional cache under the tokens of `src/internal/tokens.ts`.
- Tasks 3.1 and 3.2 are ✅ Done: `SnapshotRefresher` and `SubscriptionService` exist.
- `SubscriptionStore.listStaleKeys` exists and is covered by the conformance suite (P1).

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.9 (FR26), §8.1 (NFR04), §3.2 (no scheduler), §9 (R06)
- `src/internal/store.port.ts`

TASK
Implement `SubscriptionService.reconcile` on top of the refresher and the store's stale listing.

DELIVERABLES

1. `rate-limiter.ts`: a limiter driven by the injected `Clock` and an injectable wait function, so tests advance time by hand.

2. `reconciler.ts`: pages through `listStaleKeys`, refreshes each account through `SnapshotRefresher`, respects the batch bound and the rate, and returns `{ refreshed, failed, remaining, cursor }`.

3. The stale listing returns keys; the reconciler needs the account reference back. If the key cannot be decoded, extend the store port to return the account reference with each key, update the conformance suite and the in-memory store in this task, and record the change in `docs/tasks/README.md`.

Constraints:
- Bounded per run: a run with more stale accounts than the bound ends and says how many remain.
- No account identifier in a log line or in the result's error entries beyond what the host passed in.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/reconciliation && pnpm test:e2e -t "reconciliation"` — expected: pass
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100 for the whole phase

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-03-read-refresh-reconcile.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P3 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 3.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 3.1 ✅ 2026-11-25 — the refresher with single flight, ordered writes and a source-unavailable failure that leaves the stored snapshot untouched

- 3.2 ✅ 2026-11-25 — the service reads from the store with the age, the on-demand refresh and the tenant in every key

<!-- entries are added as tasks complete -->
