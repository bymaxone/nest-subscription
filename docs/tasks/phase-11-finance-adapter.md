# Phase 11 — Bymax Finance adapter

> **Status**: ⛔ Blocked &nbsp;·&nbsp; **Progress**: 0 / 5 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-24
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P11 — finance-adapter
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

**This phase is blocked** until the Bymax Finance public API exists (D03, R01). Its tasks are written against the planned contract in the specification's Appendix B so the work is visible, and the first task re-reads the released API and corrects everything below it before any code.

At the start `src/finance/` is an empty entry point and the library works with RevenueCat and with the fake source.

At the end `financeSource(options)` returns a `SubscriptionSource` for a host that sells and tracks subscriptions through Bymax Finance with no RevenueCat: it reads a customer's subscription and entitlements with a tenant API key, verifies Finance's signed webhooks, maps Finance's states into the model, keeps the pair of host account identifier and Finance customer identifier, and maps plan identifiers to entitlement names from the host's options. The example repository's suite passes against it unchanged, which completes AC08.

---

## Rules-of-phase

1. Nothing is built against the planned contract. The phase starts by re-reading the released API, and each difference from Appendix B is recorded in the specification first.
2. The adapter uses no private entry of the library. If it needs something the port lacks, the port changes for every adapter, in its own reviewed step.
3. No dependency on RevenueCat code, and no code shared with it except through `src/internal/` and `src/shared/`.
4. Unblocking this phase does not reopen the first release: the adapter ships as a later version on the owner's instruction.
5. Subscriptions bought through the app stores are out of scope while Finance does not report them (R01).

---

## Reference docs

- `docs/spec.md` §3.7 (FR15), §9 (R01), §10.1 (D03, D07, D15), Appendix B
- `docs/plan.md` § "P11 — finance-adapter"
- The Bymax Finance API documentation, once released
- `src/revenuecat/`, as the shape of a finished adapter
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 11.1 | Re-read the released Finance API against Appendix B | ⛔ Blocked | P0 | M | — |
| 11.2 | Add the adapter options, the client and the identity pair | ⛔ Blocked | P0 | M | 11.1 |
| 11.3 | Map Finance states and plans into the model | ⛔ Blocked | P0 | M | 11.2 |
| 11.4 | Verify and parse Finance webhooks | ⛔ Blocked | P0 | M | 11.2, 11.3 |
| 11.5 | Add the management operations and complete AC08 | ⛔ Blocked | P0 | L | 11.3, 11.4 |

---

## Tasks

### Task 11.1 — Re-read the released Finance API against Appendix B

- **Status**: ⛔ Blocked
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Read the released Bymax Finance API, check every need of Appendix B against it, record the facts, and correct the specification and the rest of this file before any code.

#### Acceptance criteria

- [ ] `docs/finance-facts.md` lists, with the URL and the date read: the read of a customer's subscription and of its entitlements; the lookup by the host's external reference; the authentication; the rate limits; the webhook signature scheme and its rotation; the event list and its retention; the stop-renewal operation; the management reference; the marker that separates test from live data.
- [ ] Each row of both Appendix B tables is marked available as specified, available differently, or missing.
- [ ] Each difference is written into `docs/spec.md` (Appendix B, §3.7, and §10.2 as a question where a decision is needed) before a line of adapter code exists.
- [ ] Tasks 11.2 to 11.5 of this file are edited to match what was found, and a need that Finance does not meet is reported to the owner with its consequence.
- [ ] Sanitized fixtures exist under `test/fixtures/finance/` for every state of the mapping table and for the webhook events.

#### Files to create / modify

- ✚ `docs/finance-facts.md`
- ✚ `test/fixtures/finance/*.json`, `test/fixtures/finance/README.md`
- ✎ `docs/spec.md` — §3.7, Appendix B, §10
- ✎ `docs/tasks/phase-11-finance-adapter.md`, `docs/plan.md`

#### Agent prompt (EN)

````
You are a senior integration engineer engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P11 (finance-adapter) — Task 11.1 of 5 (FIRST of this phase)

PRECONDITIONS
- The Bymax Finance public API is released and documented. Until it is, this task does not start (D03).
- P7 is ✅ Done: the webhook receiver exists and `revenueCatSource` in `src/revenuecat/` is the working example of an adapter.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.7, §9 (R01), §10.1 (D03, D07, D15), Appendix B
- The released Bymax Finance API documentation, in full

TASK
Establish what the released Finance API offers, and bring the specification and this task file in line with it.

DELIVERABLES

1. `docs/finance-facts.md`, the file the later tasks read.

2. The specification edits, with the version and last-update lines bumped and Appendix B's label changed from "planned contract" to "verified" for the rows that hold.

3. The fixtures and their sanitization check (extend `test/fixtures/fixtures-are-sanitized.spec.ts`).

4. The phase unblocked in `docs/plan.md` only when the API covers the needs the first Finance release requires; otherwise it stays blocked with the missing needs named.

Constraints:
- Never answer an open question on the owner's behalf: a decision goes to §10.2 with a proposal.
- Never commit a real API key, webhook secret, tenant identifier or customer identifier.
- English everywhere. No attribution to an AI tool in any file, commit or pull request.
- A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written, and the source is cited.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test -t "fixtures are sanitized"` — expected: pass
- The CI job that checks documents and relative links — expected: passes

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-11-finance-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P11 row in the phase dashboard of `docs/plan.md` (status, progress `N/5`, last updated)
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 11.1 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 11.2 — Add the adapter options, the client and the identity pair

- **Status**: ⛔ Blocked
- **Priority**: P0
- **Size**: M
- **Depends on**: 11.1

#### Description

Write the Finance adapter's options and HTTP client, and resolve a host account to a Finance customer, keeping the pair in the snapshot's source customer reference (FR15, D15).

#### Acceptance criteria

- [ ] `FinanceSourceOptions` carries the base URL, the tenant API key, the webhook secrets (two valid at once where Finance allows rotation), the plan-to-entitlement map, the request timeout and an injectable `fetch`.
- [ ] Secrets are held in `Secret`, and the four containment paths expose none of them.
- [ ] The first read of an account finds the Finance customer by the host's external reference and records the pair in the snapshot; later reads use the Finance identifier.
- [ ] An account Finance does not know yields the empty snapshot.
- [ ] Failures map to the library's error codes exactly as the RevenueCat client maps them, and no message contains the key, an identifier or a response body.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/finance/finance.options.ts`, `finance-http.ts`, `resolve-customer.ts` and their specs

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P11 (finance-adapter) — Task 11.2 of 5 (MIDDLE of this phase)

PRECONDITIONS
- The Bymax Finance public API is released and documented. Until it is, this task does not start (D03).
- P7 is ✅ Done: the webhook receiver exists and `revenueCatSource` in `src/revenuecat/` is the working example of an adapter.
- Task 11.1 is ✅ Done and the phase is unblocked in `docs/plan.md`.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.7 (FR15, identity), §10.1 (D15), §8.2 (SEC05, SEC06, SEC08, SEC09)
- `docs/finance-facts.md` (written by task 11.1: the released Finance API as read, with its URLs)
- `src/revenuecat/revenuecat.options.ts`, `src/revenuecat/revenuecat-http.ts`

TASK
Implement the Finance options, client and customer resolution in `src/finance/`.

DELIVERABLES

1. The option type with validation that names options and never values.

2. `finance-http.ts`: the client, returning `unknown`.

3. `resolve-customer.ts`: external reference to Finance customer identifier, using the lookup if Finance offers one, and otherwise the mechanism task 11.1 recorded.

Constraints:
- Every Finance endpoint, field name, header and state comes from `docs/finance-facts.md` or the page it cites, never from the specification's Appendix B, which is a planned contract.
- In a multi-tenant host the tenant is part of the lookup and comes from the caller, never from a response.
- If the HTTP client duplicates the RevenueCat one, extract the common part into `src/internal/` in this task rather than copying it; both adapters then import it by package specifier.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/finance` — expected: pass at 100%, with `fetch` stubbed
- `pnpm build && pnpm check:runtime` — expected: the adapter isolation cases pass in both directions

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-11-finance-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P11 row in the phase dashboard of `docs/plan.md` (status, progress `N/5`, last updated)
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 11.2 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 11.3 — Map Finance states and plans into the model

- **Status**: ⛔ Blocked
- **Priority**: P0
- **Size**: M
- **Depends on**: 11.2

#### Description

Implement the read: map Finance's subscription states into the model, table-driven from Appendix B, and map plan identifiers to entitlement names from the host's options (FR15, D07, AC10 for Appendix B).

#### Acceptance criteria

- [ ] Every state of the Appendix B table maps as it says: "pending first payment" yields no subscription record; "cancelled, before the period ends" yields `active` with will renew `no`; an unlisted state yields `unknown` with the source's access indication passed through where one exists.
- [ ] The table in the code is checked against the table in `docs/spec.md`, as the RevenueCat mapping is.
- [ ] A plan identifier present in the host's map grants the mapped entitlement names; a plan absent from the map grants none and is reported once through the injectable logger, without the identifier of any customer.
- [ ] Test data never grants access unless sandbox access is enabled (SEC07).
- [ ] Each fixture maps to the expected snapshot, field by field.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/finance/mapping/state.ts`, `entitlements.ts` and their specs
- ✚ `src/finance/read/parse-subscription.ts`, `read-account.ts` and their specs
- ✚ `test/fixtures/finance/appendix-b.json`, `src/finance/mapping/appendix-b.spec.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P11 (finance-adapter) — Task 11.3 of 5 (MIDDLE of this phase)

PRECONDITIONS
- The Bymax Finance public API is released and documented. Until it is, this task does not start (D03).
- P7 is ✅ Done: the webhook receiver exists and `revenueCatSource` in `src/revenuecat/` is the working example of an adapter.
- Task 11.2 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.4, §3.7 (entitlement names), §10.1 (D07), Appendix B, §5.1 (AC10)
- `docs/finance-facts.md` (written by task 11.1: the released Finance API as read, with its URLs)
- `src/revenuecat/mapping/`, `src/revenuecat/read/`

TASK
Implement `readAccount` for Finance with its mapping tables.

DELIVERABLES

1. The pure mapping functions and their table-driven specs.

2. The read, composed of small steps, ending in `resolveEntitlements` from the shared model.

3. The specification-against-data check for Appendix B.

Constraints:
- Every Finance endpoint, field name, header and state comes from `docs/finance-facts.md` or the page it cites, never from the specification's Appendix B, which is a planned contract.
- Access is what Finance reports. Do not compute it from dates or from the state name where Finance provides an explicit indication; if it provides none, record that in the facts file and raise it as a question.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/finance` — expected: pass at 100%
- `pnpm mutation --mutate "src/finance/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-11-finance-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P11 row in the phase dashboard of `docs/plan.md` (status, progress `N/5`, last updated)
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 11.3 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 11.4 — Verify and parse Finance webhooks

- **Status**: ⛔ Blocked
- **Priority**: P0
- **Size**: M
- **Depends on**: 11.2, 11.3

#### Description

Verify Finance's signed webhooks over the raw bytes, with timestamp tolerance, constant-time comparison and rotation, and parse an event into the port's notification (FR15, SEC02, SEC09).

#### Acceptance criteria

- [ ] A valid signature is accepted; a wrong signature, a stale timestamp, a malformed header and a body altered after signing are each refused with the same value.
- [ ] With two valid secrets, a request signed with either is accepted.
- [ ] Each Finance event kind yields a notification with its unique event identifier, the affected accounts as host account identifiers, the time and the test-or-live marker; an unknown kind triggers a refresh.
- [ ] An event for a Finance customer with no known host account is reported without an identifier in the log and yields no account to refresh, never a silent drop.
- [ ] `buildFinanceWebhookRequest` in the testing subpath builds accepted requests and each invalid variant, sharing the signing construction with the adapter.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/finance/webhook/verify-webhook.ts`, `parse-event.ts`, `event-kinds.ts` and their specs
- ✚ `src/finance/finance.source.ts`, `src/finance/finance.source.spec.ts`
- ✚ `src/testing/finance-requests.ts`, `src/testing/finance-requests.spec.ts`
- ✎ `src/finance/index.ts`, `src/testing/index.ts`

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P11 (finance-adapter) — Task 11.4 of 5 (MIDDLE of this phase)

PRECONDITIONS
- The Bymax Finance public API is released and documented. Until it is, this task does not start (D03).
- P7 is ✅ Done: the webhook receiver exists and `revenueCatSource` in `src/revenuecat/` is the working example of an adapter.
- Tasks 11.2 and 11.3 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.7, §3.8 (FR16, FR20), §8.2 (SEC01, SEC02, SEC03, SEC09), Appendix B
- `docs/finance-facts.md` (written by task 11.1: the released Finance API as read, with its URLs)
- `src/revenuecat/webhook/`, `src/testing/revenuecat-requests.ts`

TASK
Implement Finance webhook verification and parsing, assemble `financeSource`, and add the request builder.

DELIVERABLES

1. Verification over the `Uint8Array` received, with `crypto.timingSafeEqual`.

2. Event parsing that uses the payload only to know which accounts to refresh.

3. `finance.source.ts`: `financeSource(options)` implementing the whole port; `capabilities` and `stopRenewal` are completed in task 11.5.

4. The request builder.

Constraints:
- Every Finance endpoint, field name, header and state comes from `docs/finance-facts.md` or the page it cites, never from the specification's Appendix B, which is a planned contract.
- Mapping a Finance customer back to a host account needs the pair stored at first contact (D15): if the store port cannot answer that lookup, raise it as a port change in its own step, do not reach into a store's internals.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/finance src/testing` — expected: pass at 100%
- `pnpm mutation --mutate "src/finance/webhook/**/*.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-11-finance-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P11 row in the phase dashboard of `docs/plan.md` (status, progress `N/5`, last updated)
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 11.4 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 11.5 — Add the management operations and complete AC08

- **Status**: ⛔ Blocked
- **Priority**: P0
- **Size**: L
- **Depends on**: 11.3, 11.4

#### Description

Implement stop renewal at period end and the management reference for Finance, prove the adapter end to end, and run the example repository's suite against it (FR36, FR37, AC08).

#### Acceptance criteria

- [ ] Stop renewal on a Finance web subscription makes one call, and the result is the snapshot read back, with will renew `no` and access until the period ends.
- [ ] The capability answer matches the Bymax Finance column of the FR36 table.
- [ ] End to end against a local stand-in for the Finance API: a purchase yields access, a past-due state inside grace keeps it, an unpaid state after grace removes it, and forged webhooks change nothing.
- [ ] With the Finance adapter configured, no RevenueCat code is loaded, and the reverse, proven on the packed tarball (NFR05).
- [ ] The example repository's suite passes against the Finance adapter with no change in routes or hook code (AC08), and `docs/acceptance.md` records it.
- [ ] The README documents the adapter, and the changelog has its entry under "Unreleased".
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/finance/management/capabilities.ts`, `stop-renewal.ts` and their specs
- ✚ `test/e2e/fixtures/finance-stand-in.ts`, `test/e2e/finance.e2e-spec.ts`
- ✎ `scripts/check-consumer-runtime.mjs`, `README.md`, `CHANGELOG.md`, `docs/acceptance.md`
- ✚ in `nest-subscription-example`: `test/drivers/finance.driver.ts`, the CI matrix entry

#### Agent prompt (EN)

````
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P11 (finance-adapter) — Task 11.5 of 5 (LAST of this phase)

PRECONDITIONS
- The Bymax Finance public API is released and documented. Until it is, this task does not start (D03).
- P7 is ✅ Done: the webhook receiver exists and `revenueCatSource` in `src/revenuecat/` is the working example of an adapter.
- Tasks 11.1 to 11.4 are ✅ Done.
- P8 and P10 are ✅ Done: the management service and the example repository exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.12 (FR36 table, FR37, FR38), §5.1 (AC08, AC10), §8.1 (NFR05)
- `docs/plan.md` § "P11 — finance-adapter", Definition of Done
- `docs/finance-facts.md` (written by task 11.1: the released Finance API as read, with its URLs)
- `src/revenuecat/management/`, `test/e2e/revenuecat.e2e-spec.ts`

TASK
Finish the Finance adapter, prove it end to end, and complete AC08 in the example repository.

DELIVERABLES

1. The management operations and their table-driven tests.

2. The stand-in and the end-to-end suite, with the secret-containment and no-identifier sweeps extended to the Finance adapter.

3. The Finance driver in the example repository and its matrix entry, with the suite's test files untouched.

4. In the pull request body: the Definition of Done of P11, one line per item with its test.

Constraints:
- Every Finance endpoint, field name, header and state comes from `docs/finance-facts.md` or the page it cites, never from the specification's Appendix B, which is a planned contract.
- Releasing the adapter is the owner's decision: no version bump, no publish, no tag.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e -t "finance"` — expected: pass
- `pnpm build && pnpm check:runtime` — expected: isolation holds in both directions
- `SUBSCRIPTION_SOURCE=finance pnpm test:e2e` in the example repository — expected: pass with the same test count as the other sources
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-11-finance-adapter.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P11 row in the phase dashboard of `docs/plan.md` (status, progress `N/5`, last updated)
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 11.5 ✅ YYYY-MM-DD — <one-line summary>`
````

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->
