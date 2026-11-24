# Phase 8 — Management operations

> **Status**: 📋 ToDo &nbsp;·&nbsp; **Progress**: 0 / 4 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-24
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P8 — management-operations
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library reads subscription state and changes nothing at the source.

At the end a host can ask what is possible for a given subscription, ask the source to stop a renewal where a server can do it, and get the place where the person manages the subscription. Where a server cannot act (App Store, Stripe tracked by RevenueCat) the result is not an error: it says the person must do it and gives the management reference. Every operation acts only on a subscription of the authenticated account, and reports what the source says happened, read back, never what was asked.

---

## Rules-of-phase

1. The result type has no "assumed done" value: success is defined by the snapshot read back from the source (FR38).
2. The subscription is looked up inside the caller's own snapshot, never by an identifier taken on trust (SEC10).
3. Version 1 of the RevenueCat API is used for the one Google Play stop-renewal operation and nothing else (D06).
4. "Not possible from a server" is a value, not an exception.
5. The library exposes methods. A controller for these operations is the host's.

---

## Reference docs

- `docs/spec.md` §3.12 (FR35 to FR38), §8.2 (SEC10), §10.1 (D06, D13), Appendix A.4, §4 (user story 6)
- `docs/plan.md` § "P8 — management-operations"
- `docs/revenuecat-facts.md`
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 8.1 | Model capabilities and the service API | 📋 ToDo | P0 | M | — |
| 8.2 | Implement stop renewal with an honest result | 📋 ToDo | P0 | M | 8.1 |
| 8.3 | Implement the RevenueCat operations | 📋 ToDo | P0 | M | 8.2 |
| 8.4 | Close the phase | 📋 ToDo | P0 | S | 8.3 |

---

## Tasks

### Task 8.1 — Model capabilities and the service API

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Define what a host can ask about and do to a subscription, and add the capability query to the service (FR35, FR37).

#### Acceptance criteria

- [ ] `SubscriptionService.getCapabilities(account, subscriptionRef)` returns, for that subscription, whether stop renewal is possible from a server and the management reference when the source provides one.
- [ ] The answer comes from the adapter's `capabilities` and depends on the origin.
- [ ] `getManagementReference(account, subscriptionRef)` returns the reference or `null`.
- [ ] A subscription reference that is not in the account's own snapshot is refused with the "unknown account" family of codes and reaches no source.
- [ ] With the fake source, a test scripts capabilities per origin and reads them back through the service.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/management/management.types.ts`
- ✚ `src/core/management/find-own-subscription.ts`, `find-own-subscription.spec.ts`
- ✎ `src/core/subscription.service.ts`, `src/core/subscription.service.spec.ts`
- ✎ `src/internal/source.port.ts` — only if the capability types need a field
- ✎ `src/testing/fake.source.ts`, `src/core/index.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.1 of 4 (FIRST of this phase)

PRECONDITIONS
- P3 and P7 are ✅ Done: `SubscriptionService` reads and refreshes, and `revenueCatSource` implements `readAccount` and `verifyWebhook`, with `capabilities` and `stopRenewal` answering "not supported".

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.12 (FR35, FR37), §8.2 (SEC08, SEC10)
- `docs/plan.md` § "P8 — management-operations"
- `src/internal/source.port.ts`, `src/core/subscription.service.ts`

TASK
Add the capability query and the management reference to `SubscriptionService`.

DELIVERABLES

1. `find-own-subscription.ts`: given an account and a subscription reference, reads the account's stored snapshot and returns the matching `SubscriptionRecord` or a refusal. This is the single ownership check every operation uses.

2. `management.types.ts`: `SubscriptionCapabilities` and the public result types.

3. The two service methods.

Constraints:
- The ownership check reads the stored snapshot of the authenticated account and tenant. It never accepts a source-side identifier from the caller.
- Capabilities are asked of the adapter each time; do not cache them in the snapshot.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/management src/core/subscription.service.spec.ts` — expected: pass at 100%

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.1 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 8.2 — Implement stop renewal with an honest result

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.1

#### Description

Add stop renewal to the service: check ownership, ask the source, refresh, and return the snapshot read back (FR36, FR38, SEC10, D13).

#### Acceptance criteria

- [ ] Where the adapter says a server can do it, the service calls the source once, refreshes the account, and returns the refreshed snapshot with the outcome the source reported.
- [ ] Where it cannot, the service calls nothing at the source and returns the "must be done by the person" result with the management reference.
- [ ] When the source accepts the request and the read-back still shows a renewing subscription, the result says so; it does not report success.
- [ ] A subscription of another account or of another tenant is refused and no source call is made.
- [ ] A source failure surfaces as the source-unavailable code, and the stored snapshot is unchanged.
- [ ] The refresh after the operation goes through `SnapshotRefresher`, so the host hook receives `will_not_renew` through the normal path.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/management/stop-renewal.ts`, `src/core/management/stop-renewal.spec.ts`
- ✎ `src/core/subscription.service.ts` and its spec
- ✚ `test/e2e/management.e2e-spec.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.2 of 4 (MIDDLE of this phase)

PRECONDITIONS
- P3 and P7 are ✅ Done: `SubscriptionService` reads and refreshes, and `revenueCatSource` implements `readAccount` and `verifyWebhook`, with `capabilities` and `stopRenewal` answering "not supported".
- Task 8.1 is ✅ Done: `findOwnSubscription` and the capability query exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.12 (FR36, FR38), §8.2 (SEC10), §4 (user story 6)
- `src/core/management/find-own-subscription.ts`, `src/core/refresh/snapshot-refresher.ts`

TASK
Implement `SubscriptionService.stopRenewal(account, subscriptionRef)`.

DELIVERABLES

1. `stop-renewal.ts`: the flow, returning a closed union: `stopped` (with the snapshot read back), `not_stopped` (the source accepted and the read-back disagrees, with the snapshot), `person_must_act` (with the management reference).

2. `test/e2e/management.e2e-spec.ts` with the fake source scripted for each branch, including the cross-account and cross-tenant refusals.

Constraints:
- Never derive the result from the request having returned 2xx.
- One source call per invocation; no retry.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/management && pnpm test:e2e -t "management"` — expected: pass
- `pnpm mutation --mutate "src/core/management/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.2 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 8.3 — Implement the RevenueCat operations

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.2

#### Description

Fill the RevenueCat adapter's capabilities and stop renewal: Google Play through version 1 of the API, RevenueCat's own web billing through version 2, App Store and Stripe answered as not possible (Appendix A.4, D06).

#### Acceptance criteria

- [ ] The capability answer for each origin and store matches the RevenueCat column of the FR36 table, in a table-driven test: App Store not possible with the management reference; Google Play possible; RevenueCat web billing possible; Stripe tracked by RevenueCat not possible, with a result that tells the host to cancel in Stripe.
- [ ] Stop renewal on a Google Play subscription makes exactly one version 1 call; on a web billing subscription exactly one version 2 call; on the others no call.
- [ ] The management reference is returned when the read provides one.
- [ ] A 4xx from the operation becomes a typed failure that does not include the response body or the customer identifier.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/revenuecat/management/capabilities.ts`, `stop-renewal.ts` and their specs
- ✎ `src/revenuecat/revenuecat.source.ts` and its spec
- ✎ `docs/revenuecat-facts.md` — the two operation endpoints, re-read
- ✎ `test/e2e/fixtures/revenuecat-stand-in.ts`, `test/e2e/revenuecat.e2e-spec.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.3 of 4 (MIDDLE of this phase)

PRECONDITIONS
- P3 and P7 are ✅ Done: `SubscriptionService` reads and refreshes, and `revenueCatSource` implements `readAccount` and `verifyWebhook`, with `capabilities` and `stopRenewal` answering "not supported".
- Task 8.2 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.12 (FR36 table), §10.1 (D06), Appendix A.4, §12 (the "Managing subscriptions" and API pages)
- `docs/revenuecat-facts.md`
- `src/revenuecat/revenuecat-http.ts`

TASK
Implement `capabilities` and `stopRenewal` in the RevenueCat adapter.

DELIVERABLES

1. The two operation endpoints and their request shapes added to `docs/revenuecat-facts.md`, re-read at the source today, with URLs.

2. `capabilities.ts`: a pure function from a `SubscriptionRecord` (origin and the store detail the read kept) to capabilities.

3. `stop-renewal.ts`: the two calls through `RevenueCatHttp`.

4. End-to-end cases against the stand-in for Google Play and web billing.

Constraints:
- Every endpoint, field and status comes from `docs/revenuecat-facts.md` or the page it cites, never from memory.
- Telling Stripe from RevenueCat web billing needs the store value the read saw: if the model's origin `web` is not enough, keep the store detail on the adapter side, not as a new public model field, and say how in the pull request.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/management && pnpm test:e2e -t "revenuecat"` — expected: pass
- `pnpm mutation --mutate "src/revenuecat/management/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.3 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 8.4 — Close the phase

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 8.3

#### Description

Check the phase against its Definition of Done, extend the cross-cutting sweeps to the new code paths, and record the evidence.

#### Acceptance criteria

- [ ] The secret-containment and no-identifier end-to-end sweeps cover the management paths.
- [ ] The API surface baseline contains the new service methods and result types and nothing unintended.
- [ ] Every Definition of Done item of P8 in `docs/plan.md` has a named test.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✎ `test/e2e/secret-containment.e2e-spec.ts`, `test/e2e/no-identifiers.e2e-spec.ts`
- ✎ the API surface baseline

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.4 of 4 (LAST of this phase)

PRECONDITIONS
- P3 and P7 are ✅ Done: `SubscriptionService` reads and refreshes, and `revenueCatSource` implements `readAccount` and `verifyWebhook`, with `capabilities` and `stopRenewal` answering "not supported".
- Tasks 8.1 to 8.3 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/plan.md` § "P8 — management-operations", Definition of Done
- `docs/spec.md` §8.2 (SEC05, SEC06, SEC10)

TASK
Extend the sweeps, update the API baseline and write the phase's evidence.

DELIVERABLES

1. The two sweeps exercising capabilities, stop renewal in each branch and a failing operation.

2. In the pull request body: the Definition of Done of P8, one line per item with its test.

Constraints:
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e` — expected: pass
- `pnpm build && pnpm check:api` — expected: pass
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100 for the whole phase

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/4 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/4`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.4 ✅ YYYY-MM-DD — <one-line summary>`
````

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->
