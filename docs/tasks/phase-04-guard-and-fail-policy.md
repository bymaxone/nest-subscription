# Phase 4 — Guard and fail policy

> **Status**: 📋 ToDo &nbsp;·&nbsp; **Progress**: 0 / 4 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-24
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P4 — guard-and-fail-policy
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start a host can read an account's snapshot through `SubscriptionService`, and has nothing to protect a route with.

At the end one decorator names the entitlement a route needs and a guard enforces it. The guard gets the account from a resolver the host supplies, refuses a request with no account as unauthenticated, separates "no subscription" from "subscription exists and gives no access", and follows one explicit policy when the snapshot is missing or the store is down: refuse by default, or trust a last known state within a tolerance. A guard decision never waits for a call to a billing platform.

---

## Rules-of-phase

1. The guard reads the entitlement's active flag, which comes from the source's "gives access" flag. It never reads a status name to decide.
2. The account and the tenant come from the host's resolver only: never from a request body, a query string or a header the guard reads itself.
3. Refusal is the default in every unhandled case: an unexpected error inside the guard denies.
4. A refusal carries a stable error code and no detail about any account.
5. No guard decision waits for a source call (NFR01, D19): the only source read a guarded request can cause is the background refresh of a stale snapshot, which the decision never awaits.

---

## Reference docs

- `docs/spec.md` §3.10 (FR28 to FR31), §6.4, §8.1 (NFR01), §8.2 (SEC04, SEC08), §5.1 (AC07)
- `docs/plan.md` § "P4 — guard-and-fail-policy"
- `bymaxone/nest-auth`: its guards and decorators, the sibling precedent the specification names
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 4.1 | Add the decorator and the account resolver contract | 📋 ToDo | P0 | S | — |
| 4.2 | Implement the guard decision and its refusal codes | 📋 ToDo | P0 | M | 4.1 |
| 4.3 | Implement the fail policy | 📋 ToDo | P0 | M | 4.2 |
| 4.4 | Prove the guard end to end | 📋 ToDo | P0 | M | 4.3 |

---

## Tasks

### Task 4.1 — Add the decorator and the account resolver contract

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: —

#### Description

Write the route decorator that names an entitlement and the contract of the resolver that gives the guard its account (FR29).

#### Acceptance criteria

- [ ] `@RequiresEntitlement('premium')` stores the entitlement name as metadata readable on a handler and on a controller, with the handler winning.
- [ ] An empty or blank entitlement name is refused when the decorator is applied.
- [ ] `AccountResolver` takes the NestJS `ExecutionContext` and returns a `ResolvedAccount` (`{ accountId, tenantId? }`) or `null`, synchronously or as a promise.
- [ ] The metadata key is a `Symbol`.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/guard/requires-entitlement.decorator.ts`, `src/core/guard/requires-entitlement.decorator.spec.ts`
- ✚ `src/core/guard/account-resolver.types.ts`
- ✎ `src/core/index.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P4 (guard-and-fail-policy) — Task 4.1 of 4 (FIRST of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SubscriptionService` reads snapshots and entitlements from the store, refreshes on demand, and the module boots with the fake source and the in-memory store.
- The module options already carry an `accountResolver` option (P2).

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.10 (FR29)
- `docs/plan.md` § "P4 — guard-and-fail-policy"
- `src/core/options/subscription-options.types.ts`

TASK
Create `RequiresEntitlement` and the `AccountResolver` contract in `src/core/guard/`.

DELIVERABLES

1. `requires-entitlement.decorator.ts`: the decorator and a `readRequiredEntitlement(reflector, context)` helper that applies the handler-over-class precedence.

2. `account-resolver.types.ts`: `AccountResolver` and `ResolvedAccount`, replacing any placeholder type the options used.

Constraints:
- One entitlement per decorator: combining entitlements is a product rule the host writes (specification §3.2).
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/guard` — expected: pass at 100%

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-04-guard-and-fail-policy.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P4 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 4.1 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 4.2 — Implement the guard decision and its refusal codes

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 4.1

#### Description

Write the guard for the normal case: the store is readable and the snapshot exists or is empty (FR29, FR30).

#### Acceptance criteria

- [ ] A route with no `RequiresEntitlement` metadata is allowed without resolving an account.
- [ ] No resolvable account is refused as unauthenticated (HTTP 401), not as unsubscribed.
- [ ] An account with the entitlement active is allowed.
- [ ] An account with no subscription is refused with the "entitlement required" code, and an account whose subscription exists and gives no access (for example on hold) is refused with the "gives no access" code, both as HTTP 403.
- [ ] The refusal body contains only the catalogue's code and message.
- [ ] The decision is a pure function of the snapshot and the entitlement name, tested by table.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/guard/decide-access.ts`, `src/core/guard/decide-access.spec.ts`
- ✚ `src/core/guard/entitlement.guard.ts`, `src/core/guard/entitlement.guard.spec.ts`
- ✎ `src/core/subscription.module.ts`, `src/core/index.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P4 (guard-and-fail-policy) — Task 4.2 of 4 (MIDDLE of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SubscriptionService` reads snapshots and entitlements from the store, refreshes on demand, and the module boots with the fake source and the in-memory store.
- Task 4.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.10 (FR29, FR30), §3.4 (FR02, FR03), §6.4
- `src/shared/error-codes.ts`, `src/core/subscription.service.ts`

TASK
Implement `EntitlementGuard` and the pure `decideAccess` function it uses.

DELIVERABLES

1. `decide-access.ts`: `decideAccess(snapshot, entitlementName)` returning `allow`, `no_subscription` or `no_access`. "No access" means the snapshot holds a subscription that grants this entitlement and none gives access.

2. `entitlement.guard.ts`: a `CanActivate` that reads the metadata, calls the resolver, reads the snapshot through `SubscriptionService` and throws the matching NestJS HTTP exception built from the catalogue. When `@bymax-one/nest-core` is not installed the exception body is `{ code, message }`.

Constraints:
- Do not call `refresh` from the guard. A stale snapshot is refreshed in the background by the service's read, which is already built. That background read is the only source call a guarded request can cause, and the guard never awaits it.
- The guard works for HTTP contexts; for another context type it refuses and says so in its doc comment.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/guard` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/guard/decide-access.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-04-guard-and-fail-policy.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P4 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 4.2 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 4.3 — Implement the fail policy

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 4.2

#### Description

Decide what the guard does when the snapshot is missing or the store cannot be read: refuse by default, or trust a last known state within a tolerance (FR31, SEC04, D12).

#### Acceptance criteria

- [ ] Under the default policy, an unreadable store and a missing snapshot both refuse.
- [ ] Under the last-known-state policy, a snapshot younger than the tolerance is trusted when it cannot be refreshed, and an older one refuses; a snapshot aged exactly the tolerance is pinned by a test.
- [ ] Under the last-known-state policy with the store itself unreadable, the guard refuses unless the snapshot is available from the configured cache and is within the tolerance.
- [ ] An unexpected error anywhere in the guard refuses, with the "source unavailable" code and HTTP 503.
- [ ] The policy is one option with exactly two values, and no other code path grants access under failure.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/guard/fail-policy.ts`, `src/core/guard/fail-policy.spec.ts`
- ✎ `src/core/guard/entitlement.guard.ts`, `src/core/guard/entitlement.guard.spec.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P4 (guard-and-fail-policy) — Task 4.3 of 4 (MIDDLE of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SubscriptionService` reads snapshots and entitlements from the store, refreshes on demand, and the module boots with the fake source and the in-memory store.
- Tasks 4.1 and 4.2 are ✅ Done.
- The options carry `failPolicy` and its tolerance, defaulting to refuse and 24 hours (P2).

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.10 (FR31), §8.2 (SEC04), §10.1 (D12), §4 (user story 4)
- `src/core/guard/entitlement.guard.ts`, `src/core/cache/snapshot-cache.ts`

TASK
Add the two-valued fail policy to the guard.

DELIVERABLES

1. `fail-policy.ts`: a pure `applyFailPolicy({ policy, toleranceMs, snapshot, now, failure })` returning allow-with-snapshot or refuse.

2. The guard catching store failures around its read and routing them through the policy.

3. A doc comment on the option that states the limit of the last-known-state policy: it extends access during an outage, including for an account that was refunded during it.

Constraints:
- "Missing snapshot" under the default policy means the store answered and had no record: FR04 says that is the empty snapshot, which refuses as no subscription. "Unreadable" means the store threw. Keep the two apart in code and in tests.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/guard` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/guard/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-04-guard-and-fail-policy.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P4 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 4.3 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 4.4 — Prove the guard end to end

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 4.3

#### Description

Write the end-to-end suite that protects real routes and closes the phase: the three outcomes, the unauthenticated case, both policy values with the source and the store down, and no decision that waits for the source (AC07, NFR01).

#### Acceptance criteria

- [ ] A real NestJS application with a decorated route returns 200, the "entitlement required" refusal and the "gives no access" refusal for three accounts.
- [ ] A request with no resolvable account returns 401.
- [ ] With the store failing and with the source failing, the guard behaves exactly as each policy value says (AC07).
- [ ] With a fresh snapshot the fake source's read counter stays at zero across guard decisions; with a stale one each decision is returned while the fake source's read is still held unresolved by the test, and at most one read per account is started (NFR01).
- [ ] No response body in the suite contains an account identifier or a tenant identifier.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `test/e2e/guard.e2e-spec.ts`
- ✚ `test/e2e/fixtures/guarded-app.ts`
- ✚ `src/testing/failing.store.ts`, `src/testing/failing.store.spec.ts` — `createFailingStore`, a store wrapper a test can switch to failing
- ✎ `src/testing/index.ts`, `test/e2e/secret-containment.e2e-spec.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P4 (guard-and-fail-policy) — Task 4.4 of 4 (LAST of this phase)

PRECONDITIONS
- P3 is ✅ Done: `SubscriptionService` reads snapshots and entitlements from the store, refreshes on demand, and the module boots with the fake source and the in-memory store.
- Tasks 4.1 to 4.3 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.1 (AC07), §8.1 (NFR01), §4 (user stories 1 and 4)
- `docs/plan.md` § "P4 — guard-and-fail-policy", Definition of Done

TASK
Write the guard's end-to-end suite and the failing-store helper it needs, and record the phase's evidence.

DELIVERABLES

1. `test/e2e/fixtures/guarded-app.ts`: a small application with a resolver that reads the account from a test header set by a stand-in authentication guard.

2. `src/testing/failing.store.ts`: wraps any `SubscriptionStore` and fails the methods a test names; exported from the testing subpath because a host needs it to test its own outage handling.

3. `test/e2e/guard.e2e-spec.ts`: the cases above, driven with a controllable `Clock`.

4. In the pull request body: the Definition of Done of P4, one line per item with its test.

Constraints:
- The test header is read by the fixture's resolver, never by the guard.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e -t "guard"` — expected: pass
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100 for the whole phase

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-04-guard-and-fail-policy.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P4 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 4.4 ✅ YYYY-MM-DD — <one-line summary>`
````

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->
