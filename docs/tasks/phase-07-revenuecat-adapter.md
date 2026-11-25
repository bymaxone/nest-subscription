# Phase 7 — RevenueCat adapter

> **Status**: 🔄 In Progress &nbsp;·&nbsp; **Progress**: 0 / 8 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-25
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P7 — revenuecat-adapter
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library works end to end with the fake source, and `src/revenuecat/` is an empty entry point.

At the end RevenueCat is a working source. `revenueCatSource(options)` returns a `SubscriptionSource` that reads a customer's subscriptions and active entitlements from version 2 of the REST API, verifies webhooks by either method RevenueCat offers, filters sandbox purchases by itself, maps statuses, renewal intent and stores into the model, and turns RevenueCat event kinds into the port's notifications. The testing subpath gains builders for signed RevenueCat requests. Non-renewing purchases that grant an entitlement are read like subscriptions (D31). Stop renewal and the management reference belong to P8.

The unit work of this phase (tasks 7.1 to 7.6) needs only P1 and P2 and can run while P3 to P6 are in progress. Task 7.8 needs the service of P3 and the change list of P5. Task 7.7 needs P6 and runs last.

---

## Rules-of-phase

1. Each fact from the specification's Appendix A is re-read on the page listed in §12 before code relies on it. The three items of Appendix A.6 are resolved or kept explicitly unknown.
2. A scheduled pause is not a pause, a cancellation is not an expiry, and a billing issue follows the source's access flag.
3. The adapter filters sandbox by itself and does not rely on a dashboard setting (FR13).
4. No provider SDK: the runtime's `fetch` and `node:crypto` only.
5. A recorded fixture never contains a real identifier, token or signing secret.
6. Unit tests open no socket: `fetch` is injected and stubbed.

---

## Reference docs

- `docs/spec.md` §3.6 (FR10 to FR14), §8.2 (SEC02, SEC07, SEC09), §9 (R02, R03), §12 (references), Appendix A
- `docs/plan.md` § "P7 — revenuecat-adapter"
- The RevenueCat documentation pages listed in `docs/spec.md` §12
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                                      | Status  | Priority | Size | Depends on |
| --- | --------------------------------------------------------- | ------- | -------- | ---- | ---------- |
| 7.1 | Re-read the RevenueCat facts and record the fixtures      | 📋 ToDo | P0       | M    | —          |
| 7.2 | Add the adapter options and the HTTP client               | 📋 ToDo | P0       | M    | 7.1        |
| 7.3 | Implement the mapping tables                              | 📋 ToDo | P0       | M    | 7.1        |
| 7.4 | Read a customer into a snapshot                           | 📋 ToDo | P0       | L    | 7.2, 7.3   |
| 7.5 | Verify RevenueCat webhooks                                | 📋 ToDo | P0       | M    | 7.2        |
| 7.6 | Parse events and handle identity                          | 📋 ToDo | P0       | M    | 7.4, 7.5   |
| 7.8 | Read non-renewing purchases and map them into the model   | 📋 ToDo | P0       | L    | 7.3, 7.4   |
| 7.7 | Add the request builders and prove the adapter end to end | 📋 ToDo | P0       | L    | 7.6, 7.8   |

---

## Tasks

### Task 7.1 — Re-read the RevenueCat facts and record the fixtures

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Re-read every page of specification §12 that the adapter relies on, write down the exact endpoints, fields and values as they are today, resolve the three unknowns of Appendix A.6 where possible, and record sanitized payload fixtures.

#### Acceptance criteria

- [ ] `docs/revenuecat-facts.md` lists, with the URL and the date read: the version 2 endpoints for a customer's subscriptions and active entitlements and their response fields; the authentication header; the rate limits; the webhook authentication methods and the exact signature construction; the event fields the adapter reads; every status, renewal status and store value.
- [ ] Each row of Appendix A.1 to A.5 is marked confirmed, changed or not found. A changed row is corrected in `docs/spec.md` in the same pull request.
- [ ] Each item of Appendix A.6 (version 1 deprecation, a refund marker in version 2, delivery order) is marked resolved with its source, or still unknown.
- [ ] Fixtures exist under `test/fixtures/revenuecat/` for: a customer with an active subscription, one in grace, one in billing retry, one paused, one expired, one refunded, one sandbox, one with two subscriptions, an unknown customer; and webhook bodies for each event kind the adapter distinguishes.
- [ ] A script or a test proves no fixture contains an App User ID, an email, a token or a secret from a real project.

#### Files to create / modify

- ✚ `docs/revenuecat-facts.md`
- ✚ `test/fixtures/revenuecat/*.json`, `test/fixtures/revenuecat/README.md`
- ✚ `test/fixtures/fixtures-are-sanitized.spec.ts` (or the equivalent under the unit suite's roots)
- ✎ `docs/spec.md` — Appendix A, only where a fact changed
- ✎ `docs/README.md`

#### Agent prompt (EN)

```
You are a senior integration engineer engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.1 of 8 (FIRST of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model, `SubscriptionSource`, `SubscriptionError` and the testing doubles exist. P2 is ✅ Done: `Secret` exists in `src/internal/`.
- The owner has provided a RevenueCat sandbox project and its credentials for this session (D18). Fixtures are recorded from it. If the credentials are not available, stop and ask; do not fall back to the documentation's examples.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.6, §10.1 (D18), §12, Appendix A
- Every RevenueCat page listed in `docs/spec.md` §12, fetched now

TASK
Establish the provider facts the adapter is built on, and the fixtures it is tested with.

DELIVERABLES

1. `docs/revenuecat-facts.md`: tables of facts, each with its URL and read date. This file is what the later tasks of the phase read instead of the provider's site.

2. The fixtures, recorded from the sandbox project, each with identifiers replaced by obvious placeholders, and a README stating the request that produced each one. A state the sandbox cannot produce is written from the documentation and marked as such.

3. The sanitization check.

4. A short list, in the pull request body, of anything in Appendix A that changed and the specification edit made for it.

Constraints:
- The sandbox credentials stay in the environment of the session: never in a file of the repository, a fixture, a commit message or a log. Never commit a real API key, webhook secret or customer identifier, and rotate any credential that reached a file by mistake and say so.
- Where the documentation is silent, write "not stated" rather than an inference.
- English everywhere. No attribution to an AI tool in any file, commit or pull request.
- A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written, and the source is cited.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test -t "fixtures are sanitized"` — expected: pass
- The CI job that checks documents and relative links — expected: passes

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 7.2 — Add the adapter options and the HTTP client

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 7.1

#### Description

Write the options of the RevenueCat adapter and a small client over the runtime's `fetch` that speaks to the REST API and maps failures to the library's errors.

#### Acceptance criteria

- [ ] `RevenueCatSourceOptions` carries the project identifier, the API key, the webhook authorization value and signing secret (each optionally as two valid values), the timestamp tolerance, the request timeout, an injectable `fetch`, and `baseUrl`, the adapter's own option for the API's base address: it defaults to the address recorded in `docs/revenuecat-facts.md`, must be an absolute URL, is refused over plain HTTP unless the host is a loopback address, and is how a test points the adapter at a local stand-in.
- [ ] Secrets are held in `Secret`, and the four containment paths expose none of them.
- [ ] A network error, a timeout, a 5xx and a 429 become `SubscriptionError` with the source-unavailable code; a 404 for a customer becomes "unknown account", which the read turns into the empty snapshot.
- [ ] No error message, cause or log line contains the API key, the URL's customer identifier or a response body.
- [ ] Invalid options are refused when the factory is called, naming options and never values.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/revenuecat/revenuecat.options.ts`, `src/revenuecat/revenuecat.options.spec.ts`
- ✚ `src/revenuecat/revenuecat-http.ts`, `src/revenuecat/revenuecat-http.spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.2 of 8 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model, `SubscriptionSource`, `SubscriptionError` and the testing doubles exist. P2 is ✅ Done: `Secret` exists in `src/internal/`.
- Task 7.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.6 (FR10), §6.2, §8.2 (SEC05, SEC06, SEC09)
- `docs/revenuecat-facts.md` (written by task 7.1: the provider facts as re-read, with their URLs)
- `src/internal/secret.ts`, `src/internal/subscription.error.ts`

TASK
Implement the RevenueCat options and HTTP client in `src/revenuecat/`.

DELIVERABLES

1. `revenuecat.options.ts`: the option type, its validation and its resolved form with secrets wrapped, including `baseUrl` with its default and its validation (the default is a fact read from RevenueCat and cited; the option itself is this library's design).

2. `revenuecat-http.ts`: `RevenueCatHttp` with a `get` and a `post` taking a path and returning parsed JSON as `unknown`, an `AbortSignal` timeout, and the error mapping. The customer identifier is percent-encoded into the path.

Constraints:
- Every RevenueCat endpoint, field name, header and status value comes from `docs/revenuecat-facts.md` or from the page it cites, never from memory. If the two disagree with the specification's Appendix A, stop and report.
- The client returns `unknown`; shaping and validating the response is the mapping task's job.
- No retry inside the client: the caller decides, and reconciliation has its own rate limit.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat` — expected: pass at 100%, with `fetch` stubbed
- `pnpm lint` — expected: the no-socket gate passes

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 7.3 — Implement the mapping tables

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 7.1

#### Description

Write the pure functions that map RevenueCat's status, renewal status and store values into the model, table-driven from Appendix A.3 (FR14, AC10 for Appendix A).

#### Acceptance criteria

- [ ] Every status of Appendix A.3 maps as its table says, and an unlisted status maps to `unknown`.
- [ ] Every renewal status maps to its will-renew value, and an unlisted one to `unknown`.
- [ ] Every store maps to its origin, and an unlisted one to `other`.
- [ ] The tables in the code are generated from, or checked against, one data file that mirrors Appendix A.3, so the specification and the code cannot drift silently.
- [ ] `in_grace` against `on_hold` follows the source's access flag for a billing issue.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/revenuecat/mapping/status.ts`, `renewal.ts`, `origin.ts` and their specs
- ✚ `test/fixtures/revenuecat/appendix-a3.json` — the table as data
- ✚ `src/revenuecat/mapping/appendix-a3.spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.3 of 8 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model, `SubscriptionSource`, `SubscriptionError` and the testing doubles exist. P2 is ✅ Done: `Secret` exists in `src/internal/`.
- Task 7.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.4 (FR02, FR03), §3.6 (FR14), Appendix A.3, §5.1 (AC10)
- `docs/revenuecat-facts.md` (written by task 7.1: the provider facts as re-read, with their URLs)

TASK
Implement the three mapping functions and their table-driven tests.

DELIVERABLES

1. Three pure functions taking a string and returning a member of the model's closed sets.

2. `appendix-a3.json`: the three tables of Appendix A.3 as data, and a spec that runs every row plus unlisted values through the functions.

3. A spec that reads `docs/spec.md`, extracts the Appendix A.3 table and asserts it equals the data file.

Constraints:
- Every RevenueCat endpoint, field name, header and status value comes from `docs/revenuecat-facts.md` or from the page it cites, never from memory. If the two disagree with the specification's Appendix A, stop and report.
- Unknown input never throws: a new value from RevenueCat must not break a read (R03).
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/mapping` — expected: pass at 100%
- `pnpm mutation --mutate "src/revenuecat/mapping/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 7.4 — Read a customer into a snapshot

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 7.2, 7.3

#### Description

Implement the read: fetch a customer's subscriptions and active entitlements from version 2 of the API, apply the sandbox filter, and build the snapshot (FR10, FR13, FR14, D06).

#### Acceptance criteria

- [ ] Each fixture of task 7.1 maps to the expected snapshot, field by field, in a table-driven test.
- [ ] A cancellation keeps the subscription `active` with will renew `no`; a refund of the current period sets refunded-at and gives no access; a scheduled pause leaves access until the period ends.
- [ ] A sandbox subscription gives no access and grants no entitlement unless sandbox access is enabled, even when RevenueCat reports the entitlement as active (AC06 at unit level).
- [ ] An unknown customer yields the empty snapshot, not an error.
- [ ] A response missing a field the adapter needs yields `unknown` status with the source's access flag passed through where present, and otherwise no access.
- [ ] The snapshot's source-updated-at comes from the source's own freshness field when one exists, and the facts file says which.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/revenuecat/read/parse-customer.ts`, `map-subscription.ts`, `sandbox-filter.ts`, `read-account.ts` and their specs
- ✎ `src/revenuecat/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.4 of 8 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model, `SubscriptionSource`, `SubscriptionError` and the testing doubles exist. P2 is ✅ Done: `Secret` exists in `src/internal/`.
- Tasks 7.2 and 7.3 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.4, §3.6 (FR10, FR11, FR13, FR14), §8.2 (SEC01, SEC07), Appendix A.3, A.5 and A.6
- `docs/revenuecat-facts.md` (written by task 7.1: the provider facts as re-read, with their URLs)
- `test/fixtures/revenuecat/README.md`

TASK
Implement `readAccount` for RevenueCat as small pure steps around the HTTP client.

DELIVERABLES

1. `parse-customer.ts`: narrows the `unknown` response into the fields the adapter reads, with no cast.

2. `map-subscription.ts`: one RevenueCat subscription into a `SubscriptionRecord`, using the mapping functions.

3. `sandbox-filter.ts`: removes access and entitlements that come from sandbox subscriptions unless enabled.

4. `read-account.ts`: the calls, the composition, and `resolveEntitlements` from the shared model for the final entitlement list.

Constraints:
- Every RevenueCat endpoint, field name, header and status value comes from `docs/revenuecat-facts.md` or from the page it cites, never from memory. If the two disagree with the specification's Appendix A, stop and report.
- How a refund is detected in version 2 is one of the unknowns of Appendix A.6: implement what task 7.1 established, and state in the doc comment what the fixture proves and what it does not.
- Access is the source's flag. Do not compute it from dates or from the status.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/read` — expected: pass at 100%
- `pnpm mutation --mutate "src/revenuecat/read/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 7.5 — Verify RevenueCat webhooks

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 7.2

#### Description

Implement both verification methods RevenueCat offers: the static authorization header and the HMAC signature over the raw bytes with a timestamp tolerance (FR12, SEC02, SEC09).

#### Acceptance criteria

- [ ] A request with the right authorization value is accepted; a wrong, missing or differently cased value is refused.
- [ ] With a signing secret configured, a valid signature is accepted, and a wrong signature, a stale timestamp, a timestamp in the future beyond the tolerance, a malformed header and a body altered after signing are each refused (AC02 for RevenueCat).
- [ ] Comparison uses `crypto.timingSafeEqual` on equal-length buffers, and a length mismatch is refused without throwing.
- [ ] With two valid secrets configured, a request signed with either is accepted (SEC09).
- [ ] Every refusal is the same value: the caller cannot tell which check failed (SEC03).
- [ ] When only the static header is configured, the factory reports once, through the injectable logger, that the weaker method is in use.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/revenuecat/webhook/verify-authorization.ts`, `verify-signature.ts`, `verify-webhook.ts` and their specs

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.5 of 8 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model, `SubscriptionSource`, `SubscriptionError` and the testing doubles exist. P2 is ✅ Done: `Secret` exists in `src/internal/`.
- Task 7.2 is ✅ Done: the options and `Secret`-wrapped credentials exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.6 (FR12), §8.2 (SEC02, SEC03, SEC09), Appendix A.1
- `docs/revenuecat-facts.md` (written by task 7.1: the provider facts as re-read, with their URLs)

TASK
Implement RevenueCat webhook verification over the raw request bytes.

DELIVERABLES

1. `verify-signature.ts`: parses the signature header, recomputes the HMAC-SHA256 over the timestamp and the raw body as the facts file states, checks the tolerance against the injected `Clock`, compares in constant time.

2. `verify-authorization.ts`: constant-time comparison of the header against each valid value.

3. `verify-webhook.ts`: applies the configured method or methods and returns accepted or the single refusal value.

Constraints:
- Every RevenueCat endpoint, field name, header and status value comes from `docs/revenuecat-facts.md` or from the page it cites, never from memory. If the two disagree with the specification's Appendix A, stop and report.
- Operate on the `Uint8Array` received. Never decode and re-encode the body before hashing.
- No early return that makes timing depend on which secret matched.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat/webhook` — expected: pass at 100%
- `pnpm mutation --mutate "src/revenuecat/webhook/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 7.6 — Parse events and handle identity

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 7.4, 7.5

#### Description

Turn a verified RevenueCat event into the port's notification: event identifier, affected accounts, kind, time and environment, including anonymous identifiers, aliases and transfers (FR11, FR20).

#### Acceptance criteria

- [ ] Each event kind of Appendix A.2 yields a notification; `TEST` and kinds that cannot change subscription state yield the "changes nothing" kind; a kind not in the list yields the unknown kind, which triggers a refresh.
- [ ] A `TRANSFER` event names both the identifiers that lost and gained the purchases as affected accounts.
- [ ] An event whose only identifier is anonymous (prefix `$RCAnonymousID:`) is reported through the observer and the log with no identifier in them, and yields a notification with no account to refresh, never a silent drop.
- [ ] Aliases listed on an event are included as affected accounts.
- [ ] A body that is not the expected shape after verification yields the unknown kind with whatever accounts could be read, never a thrown error.
- [ ] The event identifier is the event's `id`, and the environment is carried into the notification.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/revenuecat/webhook/parse-event.ts`, `event-kinds.ts`, `affected-accounts.ts` and their specs
- ✚ `src/revenuecat/revenuecat.source.ts`, `src/revenuecat/revenuecat.source.spec.ts`
- ✎ `src/revenuecat/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.6 of 8 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model, `SubscriptionSource`, `SubscriptionError` and the testing doubles exist. P2 is ✅ Done: `Secret` exists in `src/internal/`.
- Tasks 7.4 and 7.5 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.6 (FR11), §3.8 (FR16, FR20), Appendix A.2 and A.5
- `docs/revenuecat-facts.md` (written by task 7.1: the provider facts as re-read, with their URLs)
- `src/internal/source.port.ts`

TASK
Implement event parsing and assemble `revenueCatSource`, the factory that returns the adapter.

DELIVERABLES

1. `event-kinds.ts`: the table from RevenueCat event type to the port's notification kind.

2. `affected-accounts.ts`: collects the App User ID, the aliases and the transfer identifiers, de-duplicated, with anonymous identifiers separated out.

3. `parse-event.ts`: verification result plus parsed body into `SourceNotification`.

4. `revenuecat.source.ts`: `revenueCatSource(options)` returning an object that implements `SubscriptionSource` with `readAccount` and `verifyWebhook`; `capabilities` and `stopRenewal` answer "not supported" until P8 fills them.

Constraints:
- Every RevenueCat endpoint, field name, header and status value comes from `docs/revenuecat-facts.md` or from the page it cites, never from memory. If the two disagree with the specification's Appendix A, stop and report.
- The parsed payload is used to know which accounts to refresh and nothing else: no state from it reaches a snapshot (FR16, SEC01).
- The App User ID is case-sensitive: never normalize it.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/revenuecat` — expected: pass at 100%
- `pnpm build && pnpm check:api && pnpm check:runtime` — expected: pass, with the adapter isolation cases of P2 still green

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.6 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 7.7 — Add the request builders and prove the adapter end to end

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 7.6, 7.8

#### Description

Add the signed request builders to the testing subpath, and run the acceptance criteria through the real receiver against a local stand-in for the RevenueCat API (AC01, AC05, AC06, FR39).

#### Acceptance criteria

- [ ] `buildRevenueCatWebhookRequest` builds a request the adapter accepts, for both verification methods, and can build each invalid variant on purpose.
- [ ] A recorded purchase notification yields an active entitlement readable through the service (AC01).
- [ ] A refund of the current period removes access on the next refresh and emits `refunded` (AC05).
- [ ] A sandbox purchase grants nothing under the default configuration, with the stand-in reporting the entitlement as active the way RevenueCat does by default (AC06).
- [ ] A wrong signature, a wrong authorization header, a stale timestamp and an altered body are refused through the controller and change nothing (AC02).
- [ ] A recorded fixture of a non-renewing purchase that grants an entitlement yields an active entitlement through the real receiver and the service, and a consumable grants nothing (D31).
- [ ] The suite's only HTTP is the local stand-in, reached through the adapter's `baseUrl` option; the sentinel sweep finds no secret and no identifier in logs or observer payloads.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/testing/revenuecat-requests.ts`, `src/testing/revenuecat-requests.spec.ts`
- ✎ `test/e2e/fixtures/revenuecat-stand-in.ts` (created by task 7.8)
- ✚ `test/e2e/revenuecat.e2e-spec.ts`
- ✎ `src/testing/index.ts`, `test/e2e/secret-containment.e2e-spec.ts`, `test/e2e/no-identifiers.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.7 of 8 (LAST of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model, `SubscriptionSource`, `SubscriptionError` and the testing doubles exist. P2 is ✅ Done: `Secret` exists in `src/internal/`.
- P6 is ✅ Done: `WebhookProcessor` and the optional controller exist and are driven end to end by the fake source.
- Tasks 7.1 to 7.6 and 7.8 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.13 (FR39), §5.1 (AC01, AC02, AC05, AC06)
- `docs/plan.md` § "P7 — revenuecat-adapter", Definition of Done
- `docs/revenuecat-facts.md` (written by task 7.1: the provider facts as re-read, with their URLs)
- `test/e2e/fixtures/webhook-app.ts`, `test/e2e/fixtures/revenuecat-stand-in.ts`

TASK
Add the RevenueCat request builders and the adapter's end-to-end suite, and record the phase's evidence.

DELIVERABLES

1. `revenuecat-requests.ts`: the builder, sharing the signing construction with the adapter through one function so the two cannot diverge, and options to produce each invalid variant.

2. `revenuecat-stand-in.ts`, created by task 7.8: extend it with whatever the acceptance cases need that it cannot serve yet (a refund, a sandbox purchase reported as active, a source that fails), and point the adapter at it through `baseUrl`.

3. `revenuecat.e2e-spec.ts`: the acceptance cases above.

4. In the pull request body: the Definition of Done of P7, one line per item with its test, and the status of each Appendix A.6 unknown.

Constraints:
- The testing subpath importing the adapter's signing function must not make the root load the adapter: re-run the isolation proof.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e -t "revenuecat"` — expected: pass
- `pnpm build && pnpm check:runtime` — expected: isolation cases pass
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100 for the whole phase

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.7 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 7.8 — Read non-renewing purchases and map them into the model

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 7.3, 7.4

#### Description

Read the one-time and lifetime purchases that RevenueCat reports as granting an entitlement, map them into the model, and extend the shared model and the entitlement resolution if they cannot express them (FR02, FR05, FR10, D31).

#### Acceptance criteria

- [ ] `docs/revenuecat-facts.md` is extended with the endpoint, fields and values that report a non-renewing purchase and the entitlement it grants, read from the RevenueCat customer and purchases pages on the day, with their URLs; the unknowns of Appendix A.6 about purchases are resolved or kept explicitly unknown.
- [ ] The shared model expresses a non-renewing purchase as FR02 describes (what the source calls it, the entitlement it grants, origin, environment, whether it gives access, when access ends or null for a lifetime grant, and when it was refunded), and `resolveEntitlements` counts it beside subscriptions: an entitlement it grants is active while it gives access, with `until` null for a lifetime grant, and the entitlement names the purchase that grants it. Existing exports keep working; any change to a public type is listed in the pull request.
- [ ] `readAccount` returns the purchases that grant an entitlement, in the snapshot, with the sandbox filter applied to them as to subscriptions (FR13).
- [ ] A consumable, and a purchase that grants no entitlement, produces no entry and no entitlement.
- [ ] A recorded, sanitized fixture of a non-renewing purchase that grants an entitlement and one of a lifetime grant exist under `test/fixtures/revenuecat/`; through the service, the first yields an active entitlement with the instant RevenueCat reports and the second with `until` null.
- [ ] A refunded non-renewing purchase removes the access it granted on the next read, and `diffSnapshots` reports the grant and its removal through the existing change kinds, extended with tests if it did not compare purchases.
- [ ] `test/e2e/fixtures/revenuecat-stand-in.ts` exists, serves the recorded fixtures at the version 2 paths on a loopback address, and the adapter reads it through its `baseUrl` option in the cases above.
- [ ] A subscription and a purchase that grant the same entitlement give one active entitlement, with the latest `until`, and null if a lifetime grant is among them.
- [ ] Table-driven tests cover the resolution over zero, one and several purchases, alone and mixed with subscriptions.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- `src/shared/` model types, validators and their specs
- the file where `resolveEntitlements` lives, and its spec
- `src/core/notifications/diff-snapshots.ts` and its spec, if it must compare purchases, and `src/testing/fake.source.ts` if the fake source must script them
- ✚ `test/e2e/fixtures/revenuecat-stand-in.ts`: the local HTTP server on a loopback address that serves the recorded fixtures at the version 2 paths and can be scripted per customer
- `src/revenuecat/` read and mapping files, and their specs
- `docs/revenuecat-facts.md`, and `docs/spec.md` Appendix A and A.6 if a fact moved
- `test/fixtures/revenuecat/*.json` and the fixture sanitization check
- the API surface baseline, if a public type changed

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P7 (revenuecat-adapter) — Task 7.8 of 8 (MIDDLE of this phase)

PRECONDITIONS
- P1 and P2 are ✅ Done: the model, `resolveEntitlements` and the fake source exist. P3 is ✅ Done: `SubscriptionService` and the refresher exist. P5 is ✅ Done: `diffSnapshots` exists.
- Tasks 7.1 to 7.4 are ✅ Done: the facts document, the options with `baseUrl`, the mapping tables and the customer read exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.4 (FR01, FR02, FR05), §3.6 (FR10, FR13, FR14), §10.1 (D31), Appendix A
- `docs/revenuecat-facts.md`
- the `src/shared/` model files, `resolveEntitlements` and its spec, `src/core/notifications/diff-snapshots.ts`, the `src/testing/` fake source, the `src/revenuecat/` read and mapping files

TASK
Make a non-renewing purchase that RevenueCat reports as granting an entitlement grant that entitlement through the service.

DELIVERABLES

1. The re-read: before any code, re-read the RevenueCat customer and purchases pages (the version 2 customer and purchase endpoints and the data model, as listed in `docs/spec.md` §12), write down what they say today and cite each URL and the date in `docs/revenuecat-facts.md`. Do not rely on memory or on a previous reading.

2. The model change, only as far as the current types cannot express FR02's non-renewing purchase, with the tests that fail without it, and `resolveEntitlements` extended with its table-driven tests.

3. The adapter change: the read, the mapping and the sandbox filter for purchases, with fixtures, and the local stand-in server the cases read through `baseUrl`. Extend `diffSnapshots` and the fake source if they cannot express purchases.

4. In the pull request body: the facts read with their URLs, each public type that changed, and the status of each unknown of Appendix A.6 that concerns purchases.

Constraints:
- Every endpoint, field and value comes from `docs/revenuecat-facts.md` or the page it cites, never from memory. If the pages and the specification disagree, change the specification first and say so.
- Consumables and virtual currency grant nothing and are not held (D31).
- A recorded fixture never contains a real identifier, token or signature secret.
- Do not change the meaning of an existing field. Names are chosen from the code, not from the specification.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/shared src/core src/revenuecat` — expected: pass at 100%
- `pnpm mutation --mutate "src/shared/**/*.ts,src/revenuecat/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-07-revenuecat-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/8 tasks`)
5. Update the P7 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/8`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 7.8 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->
