# Phase 5 — Change notifications and observer

> **Status**: ✅ Done &nbsp;·&nbsp; **Progress**: 5 / 5 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-25
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P5 — change-notifications-and-observer
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library stores correct snapshots and tells nobody when one changes.

At the end every stored change is compared with the previous snapshot into a typed list of what changed, each entry with a key that is stable for the same change, and the host's hook is called after the store write with the previous snapshot, the new one and that list; a change delivered again comes without the previous snapshot. A hook that throws does not undo the stored state. An optional observer receives counters and timings that carry no account identifier and no payload. P4 (the guard) is independent of this phase and may be in progress.

---

## Rules-of-phase

1. The change list is a pure function of two snapshots. It never reads a webhook payload.
2. The hook runs after the store write has succeeded, never before and never instead of it.
3. Delivery is at least once. The types and the documentation tell the host to be idempotent, and no code or comment claims exactly once.
4. The observer is optional, and its absence costs nothing on the hot path.
5. No account identifier and no payload content reaches a log line or an observer payload; where correlation is needed, a short hash (SEC06).

---

## Reference docs

- `docs/spec.md` §3.4 (FR05), §3.11 (FR32 to FR34), §8.2 (SEC06), §9 (R04), §4 (user story 3)
- `docs/plan.md` § "P5 — change-notifications-and-observer"
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                                      | Status  | Priority | Size | Depends on |
| --- | --------------------------------------------------------- | ------- | -------- | ---- | ---------- |
| 5.1 | Compare two snapshots into the typed change list          | ✅ Done | P0       | L    | —          |
| 5.2 | Give each change a stable key                             | ✅ Done | P0       | S    | 5.1        |
| 5.3 | Call the host hook after the write                        | ✅ Done | P0       | M    | 5.2        |
| 5.4 | Add the observer                                          | ✅ Done | P1       | M    | 5.3        |
| 5.5 | Prove that logs and observer payloads carry no identifier | ✅ Done | P0       | S    | 5.4        |

---

## Tasks

### Task 5.1 — Compare two snapshots into the typed change list

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: —

#### Description

Write the pure function that turns a previous and a new snapshot into the list of change kinds of FR32, including `overlap_detected` and `transferred`.

#### Acceptance criteria

- [x] A table-driven test produces each change kind of FR32 from a pair of snapshots, and produces an empty list for two equal snapshots.
- [x] The rules are pinned: `started` (no subscription before, one now); `renewed` (same subscription, later period, still active); `trial_converted` (`trialing` to `active`); `will_not_renew` and `will_renew_again` (will renew flips to and from `no`); `entered_grace`, `put_on_hold`, `recovered`; `paused`, `resumed`; `product_changed` (product reference differs); `expired`; `refunded` (refunded-at appears); `transferred` (the source customer reference changes or the subscriptions move away); `overlap_detected` (more than one subscription gives access to one entitlement, and did not before).
- [x] One comparison can yield several kinds, in a fixed documented order.
- [x] A change of fetched-at alone yields nothing.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/notifications/diff-snapshots.ts`, `src/core/notifications/diff-snapshots.spec.ts`
- ✚ `src/core/notifications/diff-rules/` — one small file per group of rules, each with its spec
- ✎ `src/core/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P5 (change-notifications-and-observer) — Task 5.1 of 5 (FIRST of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SnapshotRefresher.refresh` returns `{ previous, current, written }` after every source read, and `SubscriptionService` exposes reads, refresh and reconciliation.
- `CHANGE_KINDS` and `SubscriptionChange` exist in `src/shared/` (P1).

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.4 (FR02, FR03, FR05), §3.11 (FR32), Appendix A.2 ("Rules that are easy to get wrong")
- `docs/plan.md` § "P5 — change-notifications-and-observer"
- `src/shared/values.ts`, `src/shared/entitlements.ts`

TASK
Implement `diffSnapshots(previous, current)` in `src/core/notifications/` as a pure, table-tested function.

DELIVERABLES

1. `diff-snapshots.ts`: pairs subscriptions of the two snapshots by their stable subscription reference, runs each rule group, and returns the kinds with the subscription each concerns. `previous` may be absent (first contact).

2. Rule groups small enough to stay under the function length limit: lifecycle, renewal intent, billing trouble, pause, product, refund and transfer, overlap.

3. A spec table with one row per kind plus the combined cases (a refund that also expires; a renewal with a product change).

Constraints:
- Every rule reads model fields only. Where a rule needs access, it reads `givesAccess`, never the status name.
- A test fails if a member of `CHANGE_KINDS` has no row in the table, so a kind added later cannot go untested.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/notifications` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/notifications/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-05-change-notifications-and-observer.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P5 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 5.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 5.2 — Give each change a stable key

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.1

#### Description

Derive, for each change, a key that is the same whenever the same change is computed again, so the host can make its reaction idempotent (FR33).

#### Acceptance criteria

- [x] The same change computed twice, from snapshots fetched at different instants, carries the same key.
- [x] Two consecutive renewals of one subscription carry different keys (the period is part of the key).
- [x] The same kind of change on two subscriptions, on two accounts and on two tenants carries different keys.
- [x] The key contains no raw account identifier.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/notifications/change-key.ts`, `src/core/notifications/change-key.spec.ts`
- ✎ `src/core/notifications/diff-snapshots.ts` — attach the key

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P5 (change-notifications-and-observer) — Task 5.2 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SnapshotRefresher.refresh` returns `{ previous, current, written }` after every source read, and `SubscriptionService` exposes reads, refresh and reconciliation.
- Task 5.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.11 (FR33), §8.2 (SEC06), §4 (user story 3)
- `AGENTS.md` §3, "A key built from more than one field keeps its boundaries"

TASK
Implement `changeKey` and attach its result to every `SubscriptionChange`.

DELIVERABLES

1. `change-key.ts`: builds the key from the account key, the subscription reference, the change kind and the discriminating fact of that kind (the period end for `renewed`, the refunded-at instant for `refunded`, the new product for `product_changed`, and so on), each field hashed to a fixed width with `node:crypto` before joining.

2. A spec with a table stating, per kind, which fact discriminates it and why.

Constraints:
- Hash each field separately to a fixed width, then join: a plain join of free text would let one field's content move the boundary.
- The key must not depend on fetched-at, on object property order or on the order of subscriptions in the list.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/notifications/change-key.spec.ts` — expected: pass
- `pnpm mutation --mutate "src/core/notifications/change-key.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-05-change-notifications-and-observer.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P5 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 5.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 5.3 — Call the host hook after the write

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.2

#### Description

Store the changes with the snapshot as not delivered, call the host hook after the write, clear the mark when it returns, and let reconciliation deliver what is still marked (FR32, FR33, D17, R04).

#### Acceptance criteria

- [x] The refresher computes the change list before the write and passes it to `putSnapshot`, so the snapshot and its undelivered changes are stored in one write.
- [x] After a refresh that wrote a changed snapshot, the hook receives the previous snapshot, the new one and the change list, and the delivered change keys are cleared from the store.
- [x] A crash simulated between the write and the hook leaves the changes pending, and the next reconciliation run delivers them: the hook is called with the same change keys.
- [x] Reconciliation delivers pending changes in bounded pages, and clears only the keys whose hook call returned.
- [x] The hook is never invoked when the write did not happen, and never before the write resolved.
- [x] A hook that throws or rejects leaves the stored snapshot in place and the changes pending; the failure is logged with its error code and reported to the observer hook point.
- [x] A refresh that changes nothing calls no hook.
- [x] A redelivery is marked as one and gives the hook the new snapshot and the changes, with no previous snapshot (D20), pinned by a test.
- [x] The caller of `refresh` can choose not to wait for the hook, which is what the webhook receiver will need.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/notifications/change-dispatcher.ts`, `src/core/notifications/change-dispatcher.spec.ts`
- ✎ `src/core/refresh/snapshot-refresher.ts` and its spec
- ✎ `src/core/reconciliation/reconciler.ts` and its spec — deliver pending changes
- ✎ `src/core/subscription.module.ts`
- ✚ `test/e2e/change-notifications.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P5 (change-notifications-and-observer) — Task 5.3 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SnapshotRefresher.refresh` returns `{ previous, current, written }` after every source read, and `SubscriptionService` exposes reads, refresh and reconciliation.
- Tasks 5.1 and 5.2 are ✅ Done.
- The module options carry the host's hook (P2).

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.9 (FR26), §3.11 (FR32, FR33), §7, §9 (R04), §10.1 (D17, D20)
- `src/core/refresh/snapshot-refresher.ts`, `src/core/reconciliation/reconciler.ts`, `src/internal/store.port.ts`

TASK
Implement `ChangeDispatcher`, store changes as pending in the refresher's write, and deliver pending changes from reconciliation.

DELIVERABLES

1. In the refresher: `diffSnapshots` runs before the write, and its result is passed to `putSnapshot` as the pending changes.

2. `change-dispatcher.ts`: after a successful write, calls the hook with `{ previous, current, changes, redelivery: false }`, awaiting it or not according to the caller, contains any failure, and on return calls `clearPendingChanges` with the delivered keys.

3. In the reconciler: a pass over `listKeysWithPendingChanges` that calls the hook for each account's pending changes with `{ current, changes, redelivery: true }` and no previous snapshot (D20), and clears what was delivered, inside the same batch bound.

4. The refresher returning the dispatch as a promise the caller may await, so a webhook answer does not wait for the host's reaction.

5. The delivery guarantee stated in the doc comment of the hook option: at least once; the same change can arrive twice (after a crash, or when the hook succeeded and the clear failed), always with the same key; a redelivery is marked as one and carries the new snapshot and the changes, without the previous snapshot (D20).

Constraints:
- The pending mark is the only delivery state: no in-memory queue, no timer and no retry loop of the library's own. A failed hook is retried by the next reconciliation run.
- Never clear a change key whose hook call did not return.
- The store keeps only the undelivered changes, never the previous snapshot: a redelivery carries none (D20). The hook's argument type makes the previous snapshot optional and carries a redelivery flag.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/notifications src/core/refresh && pnpm test:e2e -t "change notifications"` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-05-change-notifications-and-observer.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P5 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 5.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 5.4 — Add the observer

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: M
- **Depends on**: 5.3

#### Description

Define the optional observer and emit counters and timings from the points that exist so far: refreshes, source errors, cache hits, guard decisions when P4 is merged, hook failures (FR34).

#### Acceptance criteria

- [x] `SubscriptionObserver` is an interface of optional methods, one per event family, each receiving a small typed payload.
- [x] With no observer configured, no observer code runs and no payload object is allocated on the read path.
- [x] An observer method that throws never affects the operation it observes.
- [x] Refresh outcomes, source errors, cache hits and misses, and hook failures are emitted with a duration where one applies.
- [x] Webhook outcomes have their payload type defined here, to be emitted by P6.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/observer/observer.types.ts`
- ✚ `src/core/observer/observer-bridge.ts`, `src/core/observer/observer-bridge.spec.ts`
- ✎ `src/core/refresh/snapshot-refresher.ts`, `src/core/cache/snapshot-cache.ts`, `src/core/notifications/change-dispatcher.ts`, `src/core/guard/entitlement.guard.ts` (if present) and their specs
- ✎ `src/core/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P5 (change-notifications-and-observer) — Task 5.4 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SnapshotRefresher.refresh` returns `{ previous, current, written }` after every source read, and `SubscriptionService` exposes reads, refresh and reconciliation.
- Tasks 5.1 to 5.3 are ✅ Done.
- P4 may or may not be merged: emit guard decisions only if `src/core/guard/entitlement.guard.ts` exists, and otherwise leave a named test marked as owed in the pull request body.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.11 (FR34), §8.2 (SEC06)
- `docs/plan.md` § "P5 — change-notifications-and-observer"

TASK
Define `SubscriptionObserver` and a bridge that calls it safely from the existing code paths.

DELIVERABLES

1. `observer.types.ts`: the interface and its payload types: outcome enums, counts and durations in milliseconds, the source name, the origin where relevant. No field can hold an account identifier, a tenant identifier or payload content.

2. `observer-bridge.ts`: `ObserverBridge`, a no-op when no observer is configured, containing any exception an observer throws.

3. Emission points wired into the refresher, the cache, the dispatcher and the guard.

Constraints:
- Payload types are closed: a free-form `details` or `metadata` field is not allowed, because that is where an identifier ends up.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/observer src/core` — expected: pass at 100%

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-05-change-notifications-and-observer.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P5 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 5.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 5.5 — Prove that logs and observer payloads carry no identifier

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.4

#### Description

Add the short-hash helper for correlation and the assertions that no account identifier, tenant identifier or payload content appears in any log line or observer payload (SEC06), and close the phase.

#### Acceptance criteria

- [x] A helper produces a short, salted, one-way hash of an account key for correlation in logs.
- [x] An end-to-end test runs refresh, read, reconcile and a throwing hook with sentinel account and tenant identifiers, captures every log line and every observer payload, and finds no sentinel.
- [x] The assertion helper is exported from the testing subpath, so P6, P7 and P9 reuse it.
- [x] Every Definition of Done item of P5 in `docs/plan.md` has a named test.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/internal/account-hash.ts`, `src/internal/account-hash.spec.ts`
- ✚ `src/testing/capture.ts`, `src/testing/capture.spec.ts` — a capturing logger and observer with a sentinel assertion
- ✚ `test/e2e/no-identifiers.e2e-spec.ts`
- ✎ `src/internal/index.ts`, `src/testing/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P5 (change-notifications-and-observer) — Task 5.5 of 5 (LAST of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SnapshotRefresher.refresh` returns `{ previous, current, written }` after every source read, and `SubscriptionService` exposes reads, refresh and reconciliation.
- Tasks 5.1 to 5.4 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §8.2 (SEC05, SEC06), §5.1 (AC09)
- `docs/plan.md` § "P5 — change-notifications-and-observer", Definition of Done

TASK
Add the correlation hash and the sentinel sweep over logs and observer payloads.

DELIVERABLES

1. `account-hash.ts`: `hashAccountKey(key, salt)` returning a short hex string, with the salt generated per process unless the host supplies one. The doc comment states that it is for correlation and is not an access control.

2. `capture.ts`: `createCapture()` returning a logger and an observer that record everything, and `assertNoSentinel(capture, sentinels)`.

3. `test/e2e/no-identifiers.e2e-spec.ts` covering every code path built so far.

4. In the pull request body: the Definition of Done of P5, one line per item with its test.

Constraints:
- The library logs through an injectable logger; if earlier phases wrote to a NestJS `Logger` directly, route those calls through one internal logging function in this task.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e -t "no identifiers"` — expected: pass
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100 for the whole phase

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-05-change-notifications-and-observer.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P5 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 5.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->

- 5.1 ✅ 2026-11-25 — the pure comparison of two snapshots into the typed change candidates, one rule group per concern
- 5.2 ✅ 2026-11-25 — the stable change key, hashed field by field from snapshot data, attached to every change by diffSnapshots
- 5.3 ✅ 2026-11-25 — changes stored with the snapshot as pending, the host hook called after the write, redelivery from reconciliation without the previous snapshot
- 5.4 ✅ 2026-11-25 — the optional observer with closed payload types and a bridge that costs nothing without one, wired into refreshes, source errors, the cache, the guard and delivery
- 5.5 ✅ 2026-11-25 — the salted account hash, the capturing logger and observer with the sentinel sweep, and the end-to-end proof that no identifier reaches a log or an observer
- P5 ✅ 2026-11-25 — merged as #11 (60d7136)
