# Phase 8 — Management operations

> **Status**: 🔄 In Progress &nbsp;·&nbsp; **Progress**: 2 / 9 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-26
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P8 — management-operations
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library reads subscription state and changes nothing at the source.

At the end a host can ask what is possible for a given subscription, ask the source to stop a renewal, resume, change product, extend or refund where a server can do it, and get the place where the person manages the subscription. Where a server cannot act, as RevenueCat documents it per origin, the result is not an error: it says the person must do it and gives the management reference. Every operation acts only on a subscription of the authenticated account, and reports what the source says happened, read back, never what was asked.

---

## Rules-of-phase

1. The result type has no "assumed done" value: success is defined by the snapshot read back from the source (FR38).
2. The subscription is looked up inside the caller's own snapshot, never by an identifier taken on trust (SEC10).
3. Which origin allows which operation is taken from RevenueCat's documentation, re-read and cited before each operation is coded and recorded in Appendix A.4 and `docs/revenuecat-facts.md`; none is assumed. Version 1 of the API is used only for an operation that exists only there (D06, D32).
4. "Not possible from a server" is a value, not an exception.
5. The library exposes methods. A controller for these operations is the host's.

---

## Reference docs

- `docs/spec.md` §3.12 (FR35 to FR38), §8.2 (SEC10), §10.1 (D06, D13, D32), Appendix A.4, §4 (user story 6)
- `docs/plan.md` § "P8 — management-operations"
- `docs/revenuecat-facts.md`
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                                              | Status  | Priority | Size | Depends on              |
| --- | ----------------------------------------------------------------- | ------- | -------- | ---- | ----------------------- |
| 8.1 | Model capabilities and the service API                            | ✅ Done | P0       | M    | —                       |
| 8.2 | Implement stop renewal with an honest result                      | ✅ Done | P0       | M    | 8.1                     |
| 8.3 | Implement the RevenueCat operations                               | 📋 ToDo | P0       | M    | 8.2                     |
| 8.5 | Generalize capabilities and the operation flow to every operation | 📋 ToDo | P0       | M    | 8.3                     |
| 8.6 | Implement resume                                                  | 📋 ToDo | P0       | M    | 8.5                     |
| 8.7 | Implement change product                                          | 📋 ToDo | P0       | M    | 8.5                     |
| 8.8 | Implement extend                                                  | 📋 ToDo | P0       | M    | 8.5                     |
| 8.9 | Implement refund                                                  | 📋 ToDo | P0       | M    | 8.5                     |
| 8.4 | Close the phase                                                   | 📋 ToDo | P0       | S    | 8.3, 8.6, 8.7, 8.8, 8.9 |

---

## Tasks

### Task 8.1 — Model capabilities and the service API

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Define what a host can ask about and do to a subscription, and add the capability query to the service (FR35, FR37).

#### Acceptance criteria

- [x] `SubscriptionService.getCapabilities(account, recordRef)` returns, for that subscription or non-renewing purchase, whether stop renewal is possible from a server and the management reference when the source provides one.
- [x] The answer comes from the adapter's `capabilities` and depends on the origin.
- [x] `getManagementReference(account, recordRef)` returns the reference or `null`.
- [x] A reference that is neither a subscription nor a non-renewing purchase in the account's own snapshot is refused with the "unknown account" family of codes and reaches no source.
- [x] With the fake source, a test scripts capabilities per origin and reads them back through the service.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/management/management.types.ts`
- ✚ `src/core/management/find-own-record.ts`, `find-own-record.spec.ts`
- ✎ `src/core/subscription.service.ts`, `src/core/subscription.service.spec.ts`
- ✎ `src/internal/source.port.ts` — only if the capability types need a field
- ✎ `src/testing/fake.source.ts`, `src/core/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.1 of 9 (FIRST of this phase)

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

1. `find-own-record.ts`: given an account and a record reference, reads the account's stored snapshot and finds, among its subscriptions and its non-renewing purchases (D31) and nowhere else, the record with that reference, returning it tagged with its kind, or a refusal. This is the single ownership check every operation uses.

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
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 8.2 — Implement stop renewal with an honest result

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.1

#### Description

Add stop renewal to the service: check ownership, ask the source, refresh, and return the snapshot read back (FR36, FR38, SEC10, D13).

#### Acceptance criteria

- [x] Where the adapter says a server can do it, the service calls the source once, refreshes the account, and returns the refreshed snapshot with the outcome the source reported.
- [x] Where it cannot, the service calls nothing at the source and returns the "must be done by the person" result with the management reference.
- [x] When the source accepts the request and the read-back still shows a renewing subscription, the result says so; it does not report success.
- [x] A subscription of another account or of another tenant is refused and no source call is made.
- [x] A source failure surfaces as the source-unavailable code, and the stored snapshot is unchanged.
- [x] The refresh after the operation goes through `SnapshotRefresher`, so the host hook receives `will_not_renew` through the normal path.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/management/stop-renewal.ts`, `src/core/management/stop-renewal.spec.ts`
- ✎ `src/core/subscription.service.ts` and its spec
- ✚ `test/e2e/management.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.2 of 9 (MIDDLE of this phase)

PRECONDITIONS
- P3 and P7 are ✅ Done: `SubscriptionService` reads and refreshes, and `revenueCatSource` implements `readAccount` and `verifyWebhook`, with `capabilities` and `stopRenewal` answering "not supported".
- Task 8.1 is ✅ Done: `findOwnRecord` and the capability query exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.12 (FR36, FR38), §8.2 (SEC10), §4 (user story 6)
- `src/core/management/find-own-record.ts`, `src/core/refresh/snapshot-refresher.ts`

TASK
Implement `SubscriptionService.stopRenewal(account, recordRef)`; the reference is resolved by `findOwnRecord`, and a purchase that is not renewable is answered by the capability query as not possible.

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
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.2 ✅ YYYY-MM-DD — <one-line summary>`
```

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

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.3 of 9 (MIDDLE of this phase)

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
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 8.4 — Close the phase

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 8.3, 8.6, 8.7, 8.8, 8.9

#### Description

Check the phase against its Definition of Done, extend the cross-cutting sweeps to the new code paths, and record the evidence.

#### Acceptance criteria

- [ ] The secret-containment and no-identifier end-to-end sweeps, the SEC10 cross-account and cross-tenant refusals and the honest-result checks cover every operation of D32 and every branch of each, not stop renewal alone.
- [ ] The API surface baseline contains the new service methods and result types and nothing unintended.
- [ ] A table-driven test covers every operation (stop renewal, resume, change product, extend, refund) on every origin against Appendix A.4, and one test per operation shows the result is the snapshot read back.
- [ ] Every Definition of Done item of P8 in `docs/plan.md` has a named test.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✎ `test/e2e/secret-containment.e2e-spec.ts`, `test/e2e/no-identifiers.e2e-spec.ts`
- ✎ the API surface baseline

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.4 of 9 (LAST of this phase)

PRECONDITIONS
- P3 and P7 are ✅ Done: `SubscriptionService` reads and refreshes, and `revenueCatSource` implements `readAccount` and `verifyWebhook`, with `capabilities` and `stopRenewal` answering "not supported".
- Tasks 8.1 to 8.3 and 8.5 to 8.9 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/plan.md` § "P8 — management-operations", Definition of Done
- `docs/spec.md` §8.2 (SEC05, SEC06, SEC10)

TASK
Extend the sweeps, update the API baseline and write the phase's evidence.

DELIVERABLES

1. The sweeps exercising capabilities and every operation of D32 (stop renewal, resume, change product, extend, refund), each in its possible, not-possible and failing branches, for subscriptions and for non-renewing purchases.

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
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 8.5 — Generalize capabilities and the operation flow to every operation

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.3

#### Description

Extend the capability answer and the ownership-checked, read-back flow of stop renewal so that resume, change product, extend and refund share them (FR35, FR36, FR38, SEC10, D32).

#### Acceptance criteria

- [ ] `getCapabilities` answers, for one subscription, whether each of stop renewal, resume, change product, extend and refund is possible from a server, and the management reference when the source provides one; the answer comes from the adapter and depends on the origin.
- [ ] One shared flow performs any operation: ownership check inside the caller's own snapshot, one source call, a refresh through `SnapshotRefresher`, and a closed result union with no "assumed done" value; stop renewal runs on it and its existing tests pass unchanged.
- [ ] The source port declares each operation with the arguments it needs, and an adapter answers "not supported" for one it does not implement; the fake source can be scripted per operation and per origin.
- [ ] The ownership lookup and the capability query cover every record an operation can act on, subscriptions and non-renewing purchases, found only inside the caller's own snapshot and never by an identifier taken on trust; the capability answer for a purchase is per operation and per origin, as RevenueCat documents it.
- [ ] An operation on a record of another account or tenant is refused and reaches no source, for every operation and both kinds of record, in a table-driven test.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- `src/core/management/perform-operation.ts` and its spec
- `src/core/management/management.types.ts`, `src/core/management/stop-renewal.ts` and their specs
- `src/internal/source.port.ts`, `src/testing/fake.source.ts`, `src/core/index.ts`
- `test/e2e/management.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.5 of 9 (MIDDLE of this phase)

PRECONDITIONS
- Tasks 8.1 to 8.3 are ✅ Done: capabilities, the ownership check, stop renewal and the RevenueCat stop renewal exist.

REQUIRED READING (only these — do not load more):
- `docs/spec.md` §3.12 (FR35 to FR38), §8.2 (SEC10), §10.1 (D32)
- `docs/plan.md` § "P8 — management-operations"
- `src/core/management/`, `src/internal/source.port.ts`, `src/testing/fake.source.ts`

TASK
Generalize the management flow and the capability answer to every operation of FR36, without adding an operation's RevenueCat call yet.

DELIVERABLES

1. The shared flow and the extended capability type.

2. The port methods, the fake source scripting, and stop renewal moved onto the shared flow with no change in behaviour.

3. A table-driven test that every operation refuses a foreign subscription and reaches no source.

Constraints:
- Do not add RevenueCat calls in this task: each operation's task re-reads RevenueCat's documentation first.
- The port change is for every adapter: an adapter that implements none of the new operations still compiles and answers "not supported".
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
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 8.6 — Implement resume

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.5

#### Description

Implement resume through the service and the RevenueCat adapter, for the origins where RevenueCat documents it as possible from a server, and answer the others as not possible with the management reference (FR36, FR38, SEC10, D32).

#### Acceptance criteria

- [ ] Before any code, the RevenueCat page that documents resume, and the pages for the origins it concerns, were re-read, and `docs/revenuecat-facts.md` records the endpoint, the API version, the request and response shape, the origins it applies to, and the URL and date read.
- [ ] `docs/spec.md` Appendix A.4 gains the resume column, per origin, as the page says; an origin the page does not cover is recorded as unknown and answered as not possible with the management reference.
- [ ] The capability answer for resume, per origin and store, matches Appendix A.4 in a table-driven test.
- [ ] The service method for resume takes the record reference and returns the closed result of the shared flow; where it is possible it makes exactly one source call, refreshes, and returns the snapshot read back with the outcome; where it is not, it calls nothing and returns the "must be done by the person" result with the management reference.
- [ ] An accepted request that the read-back contradicts is reported as not done, with the snapshot; a source failure surfaces as the source-unavailable code and leaves the stored snapshot unchanged.
- [ ] A 4xx from the operation becomes a typed failure that does not include the response body or any customer identifier.
- [ ] The result of a resume is the snapshot read back from the source; the state expected after it is the one RevenueCat documents, recorded in `docs/revenuecat-facts.md` with its page, and the change list reports the change through the normal path.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- `src/revenuecat/management/resume.ts` and its spec
- `src/revenuecat/management/capabilities.ts` and its spec
- `src/core/management/` (the service method), `src/core/subscription.service.ts` and their specs
- `docs/revenuecat-facts.md`, `docs/spec.md` Appendix A.4
- `test/e2e/fixtures/revenuecat-stand-in.ts`, `test/e2e/revenuecat.e2e-spec.ts`, `test/e2e/management.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.6 of 9 (MIDDLE of this phase)

PRECONDITIONS
- Task 8.5 is ✅ Done: the shared operation flow, the extended capability type and the port methods exist.

REQUIRED READING (only these — do not load more):
- `docs/spec.md` §3.12 (FR35 to FR38), §8.2 (SEC10), §10.1 (D06, D32), Appendix A.4, §12
- `docs/revenuecat-facts.md`
- `src/core/management/perform-operation.ts`, `src/revenuecat/management/`, `src/revenuecat/revenuecat-http.ts`

TASK
Implement resume end to end: the RevenueCat calls, the capability answers and the service method.

DELIVERABLES

1. The re-read: before any code, re-read the RevenueCat page for resume and cite its URL and the date in `docs/revenuecat-facts.md`. Which origin allows it comes from that page only; none is assumed.

2. The RevenueCat implementation and the service method on the shared flow.

3. End-to-end cases against the stand-in for each origin the page says is possible, and for one it says is not.

4. In the pull request body: the page read with its URL, and the per-origin answers with the sentence of the page each rests on.

Constraints:
- Version 1 of the RevenueCat API is used only if the page says the operation exists only there; say so in the pull request.
- Never derive the result from the request having returned 2xx; one source call per invocation and no retry.
- If the page contradicts the specification, change the specification first and say so.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/management src/core/management && pnpm test:e2e -t "management|revenuecat"` — expected: pass
- `pnpm mutation --mutate "src/revenuecat/management/**/*.ts,src/core/management/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.6 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 8.7 — Implement change product

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.5

#### Description

Implement change product through the service and the RevenueCat adapter, for the origins where RevenueCat documents it as possible from a server, and answer the others as not possible with the management reference (FR36, FR38, SEC10, D32).

#### Acceptance criteria

- [ ] Before any code, the RevenueCat page that documents change product, and the pages for the origins it concerns, were re-read, and `docs/revenuecat-facts.md` records the endpoint, the API version, the request and response shape, the origins it applies to, and the URL and date read.
- [ ] `docs/spec.md` Appendix A.4 gains the change product column, per origin, as the page says; an origin the page does not cover is recorded as unknown and answered as not possible with the management reference.
- [ ] The capability answer for change product, per origin and store, matches Appendix A.4 in a table-driven test.
- [ ] The service method for change product takes the record reference and the target product reference, validated as a non-empty string before any call; where it is possible it makes exactly one source call, refreshes, and returns the snapshot read back with the outcome; where it is not, it calls nothing and returns the "must be done by the person" result with the management reference.
- [ ] An accepted request that the read-back contradicts is reported as not done, with the snapshot; a source failure surfaces as the source-unavailable code and leaves the stored snapshot unchanged.
- [ ] A 4xx from the operation becomes a typed failure that does not include the response body or any customer identifier.
- [ ] A target product the page says RevenueCat will not accept for that origin is refused before any call, with the invalid-input code, and a change that the read-back does not show, as RevenueCat documents the result, is reported as not done.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- `src/revenuecat/management/change-product.ts` and its spec
- `src/revenuecat/management/capabilities.ts` and its spec
- `src/core/management/` (the service method), `src/core/subscription.service.ts` and their specs
- `docs/revenuecat-facts.md`, `docs/spec.md` Appendix A.4
- `test/e2e/fixtures/revenuecat-stand-in.ts`, `test/e2e/revenuecat.e2e-spec.ts`, `test/e2e/management.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.7 of 9 (MIDDLE of this phase)

PRECONDITIONS
- Task 8.5 is ✅ Done: the shared operation flow, the extended capability type and the port methods exist.

REQUIRED READING (only these — do not load more):
- `docs/spec.md` §3.12 (FR35 to FR38), §8.2 (SEC10), §10.1 (D06, D32), Appendix A.4, §12
- `docs/revenuecat-facts.md`
- `src/core/management/perform-operation.ts`, `src/revenuecat/management/`, `src/revenuecat/revenuecat-http.ts`

TASK
Implement change product end to end: the RevenueCat calls, the capability answers and the service method.

DELIVERABLES

1. The re-read: before any code, re-read the RevenueCat page for change product and cite its URL and the date in `docs/revenuecat-facts.md`. Which origin allows it comes from that page only; none is assumed.

2. The RevenueCat implementation and the service method on the shared flow.

3. End-to-end cases against the stand-in for each origin the page says is possible, and for one it says is not.

4. In the pull request body: the page read with its URL, and the per-origin answers with the sentence of the page each rests on.

Constraints:
- Version 1 of the RevenueCat API is used only if the page says the operation exists only there; say so in the pull request.
- Never derive the result from the request having returned 2xx; one source call per invocation and no retry.
- If the page contradicts the specification, change the specification first and say so.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/management src/core/management && pnpm test:e2e -t "management|revenuecat"` — expected: pass
- `pnpm mutation --mutate "src/revenuecat/management/**/*.ts,src/core/management/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.7 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 8.8 — Implement extend

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.5

#### Description

Implement extend through the service and the RevenueCat adapter, for the origins where RevenueCat documents it as possible from a server, and answer the others as not possible with the management reference (FR36, FR38, SEC10, D32).

#### Acceptance criteria

- [ ] Before any code, the RevenueCat page that documents extend, and the pages for the origins it concerns, were re-read, and `docs/revenuecat-facts.md` records the endpoint, the API version, the request and response shape, the origins it applies to, and the URL and date read.
- [ ] `docs/spec.md` Appendix A.4 gains the extend column, per origin, as the page says; an origin the page does not cover is recorded as unknown and answered as not possible with the management reference.
- [ ] The capability answer for extend, per origin and store, matches Appendix A.4 in a table-driven test.
- [ ] The service method for extend takes the record reference and the extension the page requires, validated before any call; where it is possible it makes exactly one source call, refreshes, and returns the snapshot read back with the outcome; where it is not, it calls nothing and returns the "must be done by the person" result with the management reference.
- [ ] An accepted request that the read-back contradicts is reported as not done, with the snapshot; a source failure surfaces as the source-unavailable code and leaves the stored snapshot unchanged.
- [ ] A 4xx from the operation becomes a typed failure that does not include the response body or any customer identifier.
- [ ] An extension outside the bounds the page states is refused before any call, with the invalid-input code, and the result is the snapshot read back, whose access end is compared with the effect RevenueCat documents, recorded in `docs/revenuecat-facts.md` with its page.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- `src/revenuecat/management/extend.ts` and its spec
- `src/revenuecat/management/capabilities.ts` and its spec
- `src/core/management/` (the service method), `src/core/subscription.service.ts` and their specs
- `docs/revenuecat-facts.md`, `docs/spec.md` Appendix A.4
- `test/e2e/fixtures/revenuecat-stand-in.ts`, `test/e2e/revenuecat.e2e-spec.ts`, `test/e2e/management.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.8 of 9 (MIDDLE of this phase)

PRECONDITIONS
- Task 8.5 is ✅ Done: the shared operation flow, the extended capability type and the port methods exist.

REQUIRED READING (only these — do not load more):
- `docs/spec.md` §3.12 (FR35 to FR38), §8.2 (SEC10), §10.1 (D06, D32), Appendix A.4, §12
- `docs/revenuecat-facts.md`
- `src/core/management/perform-operation.ts`, `src/revenuecat/management/`, `src/revenuecat/revenuecat-http.ts`

TASK
Implement extend end to end: the RevenueCat calls, the capability answers and the service method.

DELIVERABLES

1. The re-read: before any code, re-read the RevenueCat page for extend and cite its URL and the date in `docs/revenuecat-facts.md`. Which origin allows it comes from that page only; none is assumed.

2. The RevenueCat implementation and the service method on the shared flow.

3. End-to-end cases against the stand-in for each origin the page says is possible, and for one it says is not.

4. In the pull request body: the page read with its URL, and the per-origin answers with the sentence of the page each rests on.

Constraints:
- Version 1 of the RevenueCat API is used only if the page says the operation exists only there; say so in the pull request.
- Never derive the result from the request having returned 2xx; one source call per invocation and no retry.
- If the page contradicts the specification, change the specification first and say so.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/management src/core/management && pnpm test:e2e -t "management|revenuecat"` — expected: pass
- `pnpm mutation --mutate "src/revenuecat/management/**/*.ts,src/core/management/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.8 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 8.9 — Implement refund

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.5

#### Description

Implement refund through the service and the RevenueCat adapter, for the origins where RevenueCat documents it as possible from a server, and answer the others as not possible with the management reference (FR36, FR38, SEC10, D32).

#### Acceptance criteria

- [ ] Before any code, the RevenueCat page that documents refund, and the pages for the origins it concerns, were re-read, and `docs/revenuecat-facts.md` records the endpoint, the API version, the request and response shape, the origins it applies to, and the URL and date read.
- [ ] `docs/spec.md` Appendix A.4 gains the refund column, per origin, as the page says; an origin the page does not cover is recorded as unknown and answered as not possible with the management reference.
- [ ] The capability answer for refund, per origin and store, matches Appendix A.4 in a table-driven test.
- [ ] The service method for refund takes the record reference (a subscription or a non-renewing purchase), and what else the page requires; where it is possible it makes exactly one source call, refreshes, and returns the snapshot read back with the outcome; where it is not, it calls nothing and returns the "must be done by the person" result with the management reference.
- [ ] An accepted request that the read-back contradicts is reported as not done, with the snapshot; a source failure surfaces as the source-unavailable code and leaves the stored snapshot unchanged.
- [ ] A 4xx from the operation becomes a typed failure that does not include the response body or any customer identifier.
- [ ] The result of a refund is the snapshot read back from the source; the state expected after it is the one RevenueCat documents, recorded in `docs/revenuecat-facts.md` with its page, and the change list reports it through the normal path (AC05).
- [ ] The refund acts on a subscription or a non-renewing purchase found by `findOwnRecord` inside the authenticated account's own snapshot, and on no other record.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- `src/revenuecat/management/refund.ts` and its spec
- `src/revenuecat/management/capabilities.ts` and its spec
- `src/core/management/` (the service method), `src/core/subscription.service.ts` and their specs
- `docs/revenuecat-facts.md`, `docs/spec.md` Appendix A.4
- `test/e2e/fixtures/revenuecat-stand-in.ts`, `test/e2e/revenuecat.e2e-spec.ts`, `test/e2e/management.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P8 (management-operations) — Task 8.9 of 9 (MIDDLE of this phase)

PRECONDITIONS
- Task 8.5 is ✅ Done: the shared operation flow, the extended capability type and the port methods exist.

REQUIRED READING (only these — do not load more):
- `docs/spec.md` §3.12 (FR35 to FR38), §8.2 (SEC10), §10.1 (D06, D32), Appendix A.4, §12
- `docs/revenuecat-facts.md`
- `src/core/management/perform-operation.ts`, `src/revenuecat/management/`, `src/revenuecat/revenuecat-http.ts`

TASK
Implement refund end to end: the RevenueCat calls, the capability answers and the service method.

DELIVERABLES

1. The re-read: before any code, re-read the RevenueCat page for refund and cite its URL and the date in `docs/revenuecat-facts.md`. Which origin allows it comes from that page only; none is assumed.

2. The RevenueCat implementation and the service method on the shared flow.

3. End-to-end cases against the stand-in for each origin the page says is possible, and for one it says is not.

4. In the pull request body: the page read with its URL, and the per-origin answers with the sentence of the page each rests on.

Constraints:
- Version 1 of the RevenueCat API is used only if the page says the operation exists only there; say so in the pull request.
- Never derive the result from the request having returned 2xx; one source call per invocation and no retry.
- If the page contradicts the specification, change the specification first and say so.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/management src/core/management && pnpm test:e2e -t "management|revenuecat"` — expected: pass
- `pnpm mutation --mutate "src/revenuecat/management/**/*.ts,src/core/management/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-08-management-operations.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/9 tasks`)
5. Update the P8 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/9`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 8.9 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 8.1 ✅ 2026-11-26 — capability query, management reference and the single ownership check (findOwnRecord)
- 8.2 ✅ 2026-11-26 — stop renewal on the shared flow with the snapshot read back as the result
