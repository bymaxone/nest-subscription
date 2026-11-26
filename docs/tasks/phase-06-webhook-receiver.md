# Phase 6 — Webhook receiver

> **Status**: ✅ Done &nbsp;·&nbsp; **Progress**: 5 / 5 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-25
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P6 — webhook-receiver
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library refreshes an account only when the host asks. Nothing receives a notification from a source.

At the end a notification is accepted safely: the adapter verifies it over the raw bytes, the receiver de-duplicates it by event identifier, reads the account's current state from the source, stores that, and answers within the source's contract. The payload's own state is never applied. The receiver exists in two forms sharing one implementation: a processor for a host that owns its routing, and a controller behind a switch that is off by default. Signature schemes and event names belong to the adapters; this phase is driven by the fake source.

How a failed event is de-duplicated is decided (D16): its identifier is removed, so the retry is processed.

---

## Rules-of-phase

1. No code path writes a snapshot from payload content. A verified notification only triggers a read of the source (FR16, SEC01).
2. Verification runs over the raw bytes before any parsing, and belongs to the adapter (SEC02).
3. Every failed check produces one identical answer (SEC03).
4. The controller and the processor share one implementation; the controller only adapts HTTP.
5. A new event kind never produces an error answer: unknown means refresh (FR20).
6. The host hook runs outside the response deadline (FR33).
7. Nothing of the raw payload is stored or logged (SEC06).

---

## Reference docs

- `docs/spec.md` §3.8 (FR16 to FR21), §8.1 (NFR02), §8.2 (SEC01, SEC02, SEC03, SEC06), §9 (R06), Appendix A.1
- `docs/plan.md` § "P6 — webhook-receiver"
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                       | Status  | Priority | Size | Depends on |
| --- | ------------------------------------------ | ------- | -------- | ---- | ---------- |
| 6.1 | Define the outcomes and their HTTP answers | ✅ Done | P0       | S    | —          |
| 6.2 | Implement the processor                    | ✅ Done | P0       | L    | 6.1        |
| 6.3 | Enforce the response deadline              | ✅ Done | P0       | M    | 6.2        |
| 6.4 | Add the controller behind a switch         | ✅ Done | P0       | M    | 6.2        |
| 6.5 | Prove the receiver end to end              | ✅ Done | P0       | M    | 6.3, 6.4   |

---

## Tasks

### Task 6.1 — Define the outcomes and their HTTP answers

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: —

#### Description

Write the five outcomes of FR18 and the function that maps each to the HTTP answer the source's contract expects.

#### Acceptance criteria

- [x] `WebhookOutcome` is a closed union: processed, already seen, ignored, refused, failed.
- [x] Processed, already seen and ignored map to a success status; refused maps to an authentication failure; failed maps to a temporary failure.
- [x] The refused answer has one fixed body, identical for every cause, and carries no hint of which check failed.
- [x] No outcome value and no answer body can hold payload content or an account identifier.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/webhook/webhook-outcome.ts`, `src/core/webhook/webhook-outcome.spec.ts`
- ✎ `src/core/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P6 (webhook-receiver) — Task 6.1 of 5 (FIRST of this phase)

PRECONDITIONS
- P3 and P5 are ✅ Done: `SnapshotRefresher` reads the source and writes ordered snapshots with single flight, `ChangeDispatcher` calls the host hook after a write, and the observer and the sentinel capture helpers exist.
- De-duplication follows decision D16 in `docs/spec.md` §10.1: an event identifier is recorded when processing starts and removed when the event ends in the failed outcome, so the source's retry is processed.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.8 (FR18), §8.2 (SEC03), Appendix A.1 ("Success", "Retries")
- `src/shared/error-codes.ts`

TASK
Define `WebhookOutcome` and `toHttpAnswer(outcome)` in `src/core/webhook/`.

DELIVERABLES

1. `webhook-outcome.ts`: the union, with `processed` carrying only counts (accounts refreshed), and `toHttpAnswer` returning `{ status, body }` with status 200, 200, 200, 401 and 503.

2. A table-driven spec, including a test that the refused body is byte-identical across every refusal the fake source can produce.

Constraints:
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/webhook` — expected: pass at 100%

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-06-webhook-receiver.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P6 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 6.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 6.2 — Implement the processor

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 6.1

#### Description

Write the processor: verify through the adapter, de-duplicate by event identifier, refresh every account the notification concerns, and return an outcome (FR16, FR17, FR19, FR20).

#### Acceptance criteria

- [x] A verified notification results in a stored snapshot read from the source; a test puts a contradicting state in the payload and proves it is ignored.
- [x] A request that fails verification returns the refused outcome, and the store, the source read counter and the hook are untouched.
- [x] The same event delivered five times, sequentially and concurrently, causes one source read and one host notification (AC03).
- [x] An unknown event kind is accepted and triggers a refresh; a notification that names no account returns the ignored outcome without a read.
- [x] A notification naming several accounts refreshes each of them.
- [x] A source read that fails returns the failed outcome and the event identifier is removed through `forgetEvent`, so a retry of that event is processed (D16).
- [x] When `forgetEvent` itself fails, the outcome is still failed and the error is reported to the observer. The identifier then stays recorded; the processor remembers the event in memory, so a retry that reaches the same process starts the removal again and is answered as a failure, and one that reaches another instance, or after the memory dropped the event, is answered as already seen. An event is never processed while its removal is unsettled.
- [x] A sandbox notification is processed like any other; whether sandbox state grants access is decided where the snapshot is read from the source, not here.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/webhook/webhook.processor.ts`, `src/core/webhook/webhook.processor.spec.ts`
- ✎ `src/core/subscription.module.ts`, `src/core/index.ts`
- ✎ `src/core/observer/observer-bridge.ts` — emit webhook outcomes

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P6 (webhook-receiver) — Task 6.2 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P3 and P5 are ✅ Done: `SnapshotRefresher` reads the source and writes ordered snapshots with single flight, `ChangeDispatcher` calls the host hook after a write, and the observer and the sentinel capture helpers exist.
- De-duplication follows decision D16 in `docs/spec.md` §10.1: an event identifier is recorded when processing starts and removed when the event ends in the failed outcome, so the source's retry is processed.
- Task 6.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.8 (FR16 to FR20), §3.5 (FR07, FR09), §8.2 (SEC01, SEC02, SEC06), §10.1 (D16)
- `src/internal/source.port.ts`, `src/internal/store.port.ts`, `src/core/refresh/snapshot-refresher.ts`, `src/testing/fake.source.ts`

TASK
Implement `WebhookProcessor.process(request)` in `src/core/webhook/`.

DELIVERABLES

1. `webhook.processor.ts`: calls `source.verifyWebhook` with the raw bytes and headers untouched; on a notification, calls `store.markEventProcessed`; when new, refreshes each affected account through `SnapshotRefresher` without awaiting the host hook; returns the outcome and emits it to the observer.

2. The retention option applied through `deleteEventsOlderThan`, called opportunistically and bounded, never on the hot path of every request.

3. Specs with the fake source: order of calls asserted, concurrency driven by promises resolved by hand.

Constraints:
- The processor never parses the body. It hands the bytes to the adapter and receives a typed notification.
- The processor never logs the body, a header value or an account identifier.
- Do not catch a verification exception as "failed": an adapter that throws during verification is a refusal, so a malformed request cannot be used to make the source retry forever.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/webhook` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/webhook/webhook.processor.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-06-webhook-receiver.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P6 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 6.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 6.3 — Enforce the response deadline

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 6.2

#### Description

Answer with a temporary failure when the source read does not finish inside the deadline, so the source retries instead of holding the connection (FR21, NFR02).

#### Acceptance criteria

- [x] A read slower than the deadline produces the failed outcome before the deadline, measured with a controllable clock.
- [x] The slow read is not abandoned mid-write: if it completes later, its snapshot is stored through the normal ordered write.
- [x] On timeout the event identifier is removed (D16), so a later retry of that event is processed; single flight makes a retry that arrives while the slow read is still running share that read.
- [x] The deadline is an option with a default safely under the shortest source limit the specification records (60 seconds for RevenueCat), and a value above that limit is refused at boot.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/webhook/deadline.ts`, `src/core/webhook/deadline.spec.ts`
- ✎ `src/core/webhook/webhook.processor.ts` and its spec
- ✎ `src/core/options/subscription-options.types.ts`, `defaults.ts`, `validate-options.ts` and their specs

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P6 (webhook-receiver) — Task 6.3 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P3 and P5 are ✅ Done: `SnapshotRefresher` reads the source and writes ordered snapshots with single flight, `ChangeDispatcher` calls the host hook after a write, and the observer and the sentinel capture helpers exist.
- De-duplication follows decision D16 in `docs/spec.md` §10.1: an event identifier is recorded when processing starts and removed when the event ends in the failed outcome, so the source's retry is processed.
- Task 6.2 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.8 (FR21), §8.1 (NFR02), Appendix A.1 ("Time limit")
- `src/core/webhook/webhook.processor.ts`

TASK
Add a deadline to webhook processing.

DELIVERABLES

1. `deadline.ts`: `withDeadline(promise, ms, clock, wait)` resolving to the promise's result or to a timeout marker, with the wait injectable for tests and the timer cleared when the promise wins.

2. The processor racing the refreshes against the deadline and returning the failed outcome on timeout.

3. The option, its default and its validation rule.

Constraints:
- No timer is left pending after the answer: a spec asserts it.
- The host hook is not inside the deadline; it was already detached in task 6.2.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/webhook src/core/options` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/webhook/deadline.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-06-webhook-receiver.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P6 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 6.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 6.4 — Add the controller behind a switch

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 6.2

#### Description

Offer the receiver as a controller the host mounts with one option, off by default, which answers a temporary failure when the unparsed request body was not kept (FR17, D10).

#### Acceptance criteria

- [x] With the switch off, no route is registered. With it on, a POST route exists at the configured path.
- [x] With the switch on and no raw body kept, a request is answered with a temporary failure and one warning is logged.
- [x] The controller passes the exact bytes received to the processor, and returns `toHttpAnswer` of its outcome.
- [x] The controller applies no guard of the library, and its doc comment says the route must stay outside the host's authentication guard and inside its rate limiting.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/webhook/webhook.controller.ts`, `src/core/webhook/webhook.controller.spec.ts`
- ✚ `src/core/webhook/raw-body.ts`, `src/core/webhook/raw-body.spec.ts`
- ✎ `src/core/subscription.module.ts`, `src/core/options/validate-options.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P6 (webhook-receiver) — Task 6.4 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P3 and P5 are ✅ Done: `SnapshotRefresher` reads the source and writes ordered snapshots with single flight, `ChangeDispatcher` calls the host hook after a write, and the observer and the sentinel capture helpers exist.
- De-duplication follows decision D16 in `docs/spec.md` §10.1: an event identifier is recorded when processing starts and removed when the event ends in the failed outcome, so the source's retry is processed.
- Task 6.2 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.8 (FR17), §10.1 (D10)
- The NestJS documentation page on raw body (`rawBody: true` in `NestFactory.create`), re-read at its source before relying on it

TASK
Implement `SubscriptionWebhookController` and the raw-body check.

DELIVERABLES

1. `raw-body.ts`: reads the raw bytes from the request the way the current NestJS version exposes them, and reports clearly when they are absent.

2. `webhook.controller.ts`: registered by the module only when the switch is on, with the path taken from the options.

3. The start-up check. If "raw body is available" cannot be known before the first request, the check runs on the first request, the answer is a temporary failure, and the pull request body says so; do not claim a boot-time refusal the framework cannot give.

Constraints:
- Works with the Express adapter of NestJS, which is the family default; state in the doc comment what a Fastify host does instead (use the processor).
- Never re-serialize a parsed body to "recover" the bytes: a re-serialized body does not match its signature.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/webhook` — expected: pass at 100%
- `pnpm test:e2e -t "webhook controller"` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-06-webhook-receiver.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P6 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 6.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 6.5 — Prove the receiver end to end

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 6.3, 6.4

#### Description

Write the end-to-end suite that drives the receiver through HTTP with the fake source and closes the phase (AC02 for the receiver, AC03, AC04).

#### Acceptance criteria

- [x] A forged request, a request with a body altered after signing, and a request the fake source refuses for any reason all get the identical refused answer and change nothing (AC02 for the receiver).
- [x] The same event delivered five times causes one source read and one host notification (AC03).
- [x] Events delivered in reverse order leave the snapshot equal to the source's current state (AC04).
- [x] A slow source is answered as a temporary failure before the deadline, and the retry is processed.
- [x] The sentinel sweep finds no body content, header value or account identifier in logs or observer payloads.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `test/e2e/webhook-receiver.e2e-spec.ts`, `test/e2e/webhook-controller.e2e-spec.ts`
- ✚ `test/e2e/fixtures/webhook-app.ts`
- ✎ `test/e2e/no-identifiers.e2e-spec.ts`, `test/e2e/secret-containment.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P6 (webhook-receiver) — Task 6.5 of 5 (LAST of this phase)

PRECONDITIONS
- P3 and P5 are ✅ Done: `SnapshotRefresher` reads the source and writes ordered snapshots with single flight, `ChangeDispatcher` calls the host hook after a write, and the observer and the sentinel capture helpers exist.
- De-duplication follows decision D16 in `docs/spec.md` §10.1: an event identifier is recorded when processing starts and removed when the event ends in the failed outcome, so the source's retry is processed.
- Tasks 6.1 to 6.4 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.1 (AC02, AC03, AC04), §4 (user stories 2 and 7)
- `docs/plan.md` § "P6 — webhook-receiver", Definition of Done

TASK
Write the receiver's end-to-end suite and record the phase's evidence.

DELIVERABLES

1. `test/e2e/fixtures/webhook-app.ts`: an application with the controller mounted and raw body enabled, plus a second route that calls the processor directly.

2. The two suites, covering both forms of the receiver with the same cases.

3. In the pull request body: the Definition of Done of P6, one line per item with its test.

Constraints:
- Requests are sent as raw bytes, not as objects the HTTP client serializes, so the "altered after signing" case is real.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e -t "webhook"` — expected: pass
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100 for the whole phase

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-06-webhook-receiver.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P6 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 6.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->

- 6.1 ✅ 2026-11-25 — the five outcomes as a closed union and the one HTTP answer of each, with one frozen refusal for every cause
- 6.2 ✅ 2026-11-25 — the processor: verification over the raw bytes through the adapter, de-duplication by event identifier with D16, a read of every named account, and the retention purge in reconciliation
- 6.3 ✅ 2026-11-25 — the response deadline: the work raced against an injectable wait, the only timer cleared when the race is decided, a timed-out event freed for its retry, and a 60 000 ms ceiling at boot
- 6.4 ✅ 2026-11-25 — the controller behind a switch that is off by default, the raw-body reading, a route chosen by the host with no default, and a first-request answer for an application without the raw body
- 6.5 ✅ 2026-11-25 — the receiver end to end in both forms: one identical refusal for every failed check, one read per event, reverse order, a slow source and its retry, failure paths, the purge and the sentinel sweep
- P6 ✅ 2026-11-25 — merged as #12 (e004c38)
