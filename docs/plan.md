# Roadmap — @bymax-one/nest-subscription

> **Source spec**: [`docs/spec.md`](./spec.md)
> **Last updated**: 2026-11-25
> **Derived documents**: `docs/tasks/phase-NN-<slug>.md`, one file per phase, written from this roadmap by `/bymax-workflow:phase-tasks`

This document says in which order the specification is built and when each part counts as done. It holds no task-level instructions and no code. Identifiers such as `FR16`, `SEC04`, `AC03` and `D11` are the specification's.

---

## Status legend

| Emoji | Meaning     |
| ----- | ----------- |
| 📋    | ToDo        |
| 🔄    | In Progress |
| 👀    | Review      |
| ✅    | Done        |
| ⛔    | Blocked     |
| 🟡    | Partial     |

---

## Progress

> Update this every time a phase moves status. Recompute % from the table below.

**Overall progress**: 🔄 5 / 10 phases of the first release done (50%) — P0 to P9
**Active phase**: P5 — change-notifications-and-observer
**Blocked**: none
**Deferred**: P11, outside the first release until the Bymax Finance API exists (D03, D30)

---

## Phase dashboard

| ID  | Phase                                                                                                     | Status    | Progress | Size | Last updated |
| --- | --------------------------------------------------------------------------------------------------------- | --------- | -------- | ---- | ------------ |
| P0  | scaffold-and-governance — the `nest-telemetry` scaffold, the gates and the repository rules               | ✅ Done   | 7/7      | L    | 2026-11-24   |
| P1  | model-ports-and-test-doubles — the shared model, the two ports, the in-memory store and the fake source   | ✅ Done   | 7/7      | L    | 2026-11-24   |
| P2  | module-and-options — `forRoot`, `forRootAsync`, validation at boot and secret containment                 | ✅ Done   | 5/5      | M    | 2026-11-25   |
| P3  | read-refresh-reconcile — the service, refresh on demand, staleness, ordered writes and reconciliation     | ✅ Done   | 5/5      | L    | 2026-11-25   |
| P4  | guard-and-fail-policy — the decorator, the guard, the refusal codes and the two fail policies             | ✅ Done   | 4/4      | M    | 2026-11-25   |
| P5  | change-notifications-and-observer — the typed change list, the host hook and the observer                 | 👀 Review | 5/5      | M    | 2026-11-25   |
| P6  | webhook-receiver — the processor, the controller, de-duplication, outcomes and the deadline               | 📋 ToDo   | 0/5      | L    | —            |
| P7  | revenuecat-adapter — read, identity, verification, sandbox filter, mapping tables, non-renewing purchases | 📋 ToDo   | 0/8      | L    | —            |
| P8  | management-operations — capabilities, the five operations and the management reference                    | 📋 ToDo   | 0/9      | L    | —            |
| P9  | release-readiness — the public documents, the full gate run and the release candidate                     | 📋 ToDo   | 0/6      | M    | —            |
| P11 | finance-adapter — deferred, outside the first release; built when the Finance API exists (D30)            | 📋 ToDo   | 0/5      | L    | —            |

---

## Dependency graph

```
P0 → P1 → P2 → P3
P3 → P4
P3 → P5 → P6
P2 → P7 (unit work)        P6 → P7 (closing)
P3, P7 → P8
P4, P5, P6, P7, P8 → P9
P7 → P11 (start, once unblocked)        P8, P9 → P11 (closing)
```

**Critical path**: P0 → P1 → P2 → P3 → P5 → P6 → P7 → P8 → P9.

### Parallelization notes

- **P4** and **P5** are independent of each other. Both start when P3 is done.
- **P7** has two halves. The read, the verification and the mapping tables need only the source port from P1 and the `Secret` holder from P2, so they can be built while P3 to P6 are in progress. Its non-renewing purchases (task 7.8) need the service of P3 and the change list of P5, so they are not part of that early work. Its end-to-end acceptance (AC01, AC05, AC06) drives the webhook receiver, so the phase closes only after P6.
- **P8** needs the service from P3 and the RevenueCat operations from P7.
- **P9** needs every phase from P4 to P8 closed: it documents and measures the whole first release.
- **P11** is deferred (D03, D30) and waits on something outside this repository (R01). The first release is published without it and nothing waits for it. When the Finance API exists it starts after P7 and closes after P8 (the management service) and P9 (the suite whose Finance run it adds).

---

## Requirement coverage

Every requirement of the specification has a phase that owns it; where one is split, the parentheses name the part each phase owns. A phase is not done while one of its rows lacks a test.

| Phase | Functional                                                                                           | Non-functional and security                                           | Acceptance                                                             |
| ----- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| P0    | —                                                                                                    | Specification §5.2, §8 and §11                                        | —                                                                      |
| P1    | FR01, FR02, FR03, FR04, FR05, FR06, FR07, FR08, FR09, FR22, FR39 (store and fake source)             | SEC08 (key construction)                                              | —                                                                      |
| P2    | —                                                                                                    | NFR05, SEC05, SEC07 (options and boot refusal), SEC09 (options shape) | AC09 (library objects)                                                 |
| P3    | FR23, FR24, FR25, FR26, FR27, FR28                                                                   | NFR03, NFR04, SEC08 (enforced on every read and write)                | —                                                                      |
| P4    | FR29, FR30, FR31                                                                                     | NFR01, SEC04                                                          | AC07                                                                   |
| P5    | FR32, FR33, FR34                                                                                     | SEC06 (observer payloads)                                             | —                                                                      |
| P6    | FR16, FR17, FR18, FR19, FR20, FR21                                                                   | NFR02, SEC01, SEC02, SEC03, SEC06 (no raw payload stored or logged)   | AC02 (receiver), AC03, AC04                                            |
| P7    | FR10, FR11, FR12, FR13, FR14, FR39 (RevenueCat request builders), non-renewing purchases (FR02, D31) | SEC07 (sandbox filter), SEC09 (rotation for RevenueCat)               | AC01, AC02 (RevenueCat methods), AC05, AC06, AC10 (Appendix A)         |
| P8    | FR35, FR36 (stop renewal, resume, change product, extend, refund; D32), FR37, FR38                   | SEC10                                                                 | —                                                                      |
| P9    | —                                                                                                    | Specification §5.2 measured on the whole package                      | AC08 (fake source and RevenueCat), AC09 (captured logs, whole package) |
| P11   | FR15, FR39 (Finance request builders)                                                                | SEC09 (rotation for Finance)                                          | AC08 (Finance), AC10 (Appendix B)                                      |

---

## Target layout

The specification leaves the file layout to this roadmap. These are the directories each phase fills; a phase's task file names the files.

| Path              | Holds                                                                                                                                | Subpath (D08) |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `src/shared/`     | The model, the status and origin values, the notification kinds, the error codes. No runtime dependency                              | `shared`      |
| `src/internal/`   | The classes and injection tokens that more than one entry point needs, built as one bundle                                           | not public    |
| `src/core/`       | The module, the options, the service, the guard and decorator, the webhook processor and controller, the notifications, the observer | root          |
| `src/revenuecat/` | The RevenueCat adapter                                                                                                               | `revenuecat`  |
| `src/finance/`    | The Bymax Finance adapter                                                                                                            | `finance`     |
| `src/testing/`    | The in-memory store, the conformance suite, the fake source, the signed request builders                                             | `testing`     |
| `test/e2e/`       | The end-to-end suite, against a real NestJS application                                                                              | —             |
| `test/fixtures/`  | Recorded provider payloads, with every identifier and secret replaced                                                                | —             |
| `scripts/`        | The gate scripts brought from `nest-telemetry`                                                                                       | —             |

`src/internal/` exists because of a measured failure in the family: a module reached from two entry points is copied into each bundle, and a copied class is a second injection token and a second `instanceof` target. An adapter subpath and the root both need the source port's token, so both import it from the shared internal bundle by package specifier. The `shared` subpath is reached the same way, because it defines the error class.

---

## Global conventions

> Rules every phase respects. They come from the specification §5.2 and §8, from `AGENTS.md`, and from the scaffold of `bymaxone/nest-telemetry`.

| Area               | Rule                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime            | Node.js 26 or newer, NestJS 11 (D09)                                                                                                                                                                                                 |
| Package manager    | pnpm, pinned in `packageManager`, with its settings in `pnpm-workspace.yaml`. Publishing uses `npm`, never `pnpm`                                                                                                                    |
| Dependencies       | Zero direct dependencies. NestJS packages and the two packages NestJS itself requires (`reflect-metadata` and `rxjs`) are peers; every other peer is optional. Adapters use the runtime's `fetch` and `node:crypto`, no provider SDK |
| TypeScript         | Strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`                                                                                                                                                   |
| Suppressions       | None, in any form: no `eslint-disable`, no `@ts-ignore`, no `istanbul ignore`, no Stryker disable without a recorded reason                                                                                                          |
| Injection          | Tokens are symbols. Every provider injects explicitly. The library reads no environment variable                                                                                                                                     |
| Secrets            | A secret never sits in an enumerable property. A class that owns one holds it in a `#private` field; the module options hold no secret and each adapter factory holds its credentials in a `Secret` (D26) (SEC05)                    |
| Keys               | A key built from more than one field encodes each field so that no content can move the boundary between them (`AGENTS.md` §3)                                                                                                       |
| Size               | A function is at most 50 lines, a file at most 800. Each source file opens with a header naming its purpose and layer; each export has a doc comment                                                                                 |
| Comments           | English. A comment states a constraint that still holds, never a phase, a task or a review round                                                                                                                                     |
| Tests              | Test first. 100% statement, branch, function and line coverage in the unit suite, in the end-to-end suite and in both together. Mutation score 100. Unit tests open no socket                                                        |
| Packaging          | ESM and CommonJS with declarations for each, checked against the packed tarball, plus a bundle size budget and an API surface check                                                                                                  |
| Provider facts     | A statement about RevenueCat, a store or Bymax Finance is re-read at its source in specification §12 before code relies on it, and the task cites the page                                                                           |
| Commits and review | Conventional Commits. Changes reach `main` through a pull request. No attribution to an AI tool anywhere                                                                                                                             |
| Release            | The first publish and every version bump need the owner's explicit instruction                                                                                                                                                       |

**Done, for every phase:** the phase's pull request is merged with `CI passed` green, every requirement in its row of the coverage table has a test that fails without the implementation, and no gate threshold or ignore list was loosened to get there.

---

## Phase details

### P0 — scaffold-and-governance

- **Goal**: Turn the documents-only repository into a library project that builds, tests and gates an empty package the same way `nest-telemetry` does.
- **Scope**:
  - In: package metadata with the five subpaths of D08 as empty entry points plus the internal bundle; TypeScript, lint, formatting, Jest (unit, end-to-end, combined coverage), Stryker and build configuration; the gate scripts under `scripts/`; Husky and commitlint; the organisation's reusable library CI and security workflows added to the CI workflow, keeping its documents job and the aggregate check named `CI passed`; the release workflow; CodeQL, OSV and Scorecard workflows; Dependabot, including the group that moves the pinned `agents-sync` reference; the library sections of `AGENTS.md` (design principles, security specification, testing strategy, packaging invariants, pitfalls) and its statement of the `docs/` language; `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md` and the Copilot instruction files; the required status checks in the repository ruleset.
  - Out: any library behaviour; the public README beyond what the gates need; publishing.
- **Definition of Done**:
  - [x] `pnpm install`, `typecheck`, `lint`, `test`, `test:e2e`, `test:cov:all`, `build` and `mutation` all pass locally on Node.js 26 on a tree that exports nothing but the empty entry points.
  - [x] The packed tarball loads each of the five subpaths in ESM and in CommonJS, and the strict type-resolution check passes on it.
  - [x] The pull request shows `CI passed` green, with the organisation's reusable workflows among the jobs it depends on, and the ruleset requires it.
  - [x] `AGENTS.md` no longer says the repository is at the specification stage, and nothing in it describes `nest-telemetry`'s domain.
  - [x] No file brought from `nest-telemetry` still names OpenTelemetry, a telemetry script or a telemetry baseline.
- **Context / preconditions**: The repository holds documents and three workflows. `nest-telemetry` is the scaffold to mirror (specification §11); its mutation thresholds are already 100.
- **Rules-of-phase**:
  1. Copy the mechanism, not the domain: every script and baseline is read before it is kept, and one that only serves telemetry is dropped.
  2. No gate is brought in a weakened form. A gate that cannot pass on an empty package is made to pass by the smallest real content, never by an exclusion.
  3. `agents-sync.yml` stays pinned to a release commit; every other `bymaxone/.github` reusable stays on `@v1`.
  4. The ruleset change is an action on GitHub outside the diff: the pull request body says what was changed and how to read it back.
- **References**:
  - Spec §5.2, §6.2, §8, §11
  - `AGENTS.md` §1 and §3
  - `bymaxone/nest-telemetry` at its current `main`
- **Estimated size**: L
- **Tasks**: [`docs/tasks/phase-00-scaffold-and-governance.md`](tasks/phase-00-scaffold-and-governance.md)

---

### P1 — model-ports-and-test-doubles

- **Goal**: Give every later phase the vocabulary and the two seams: the normalized model, the source port and the store port, with doubles to test against.
- **Scope**:
  - In: the snapshot and subscription record types and their closed value sets (FR01, FR02, FR03); the empty snapshot for an unknown account (FR04); the pure rule that resolves entitlements across several subscriptions (FR05); the `shared` subpath with no runtime dependency, carrying the model, the notification kinds and the error-code catalogue (FR06, §6.4); the source port with its four abilities and the rule against inferring state from a payload (FR07, FR09); registration of a host's own adapter through the same public entry the shipped ones use (FR08); the store port for snapshots, their undelivered changes and processed event identifiers (D17), the in-memory store marked as not for production, and the conformance suite a host runs against its own store (FR22, D11); the scriptable fake source (FR39); tenant and account key construction (SEC08).
  - Out: the NestJS module; any network call; the relational reference store, which is documentation and belongs to P9.
- **Definition of Done**:
  - [x] A file that imports only the `shared` subpath loads with NestJS absent from the module graph, proven by a packaging test on the tarball.
  - [x] The in-memory store passes the conformance suite, and a deliberately broken store (no uniqueness on event identifiers, no ordering on writes) fails it, each on a named case.
  - [x] A table-driven test covers every status of FR03 with its access meaning, and the FR05 overlap rule over one, two and conflicting subscriptions.
  - [x] A test proves that two different tenant and account pairs can never produce the same key, including pairs whose text contains the delimiter.
  - [x] The fake source can set a state, emit a notification and fail its next read, and implements the port with no private entry.
- **Context / preconditions**: P0 is done. The subpaths exist as empty entry points.
- **Rules-of-phase**:
  1. The guard-relevant truth is the "gives access" flag from the source. No helper derives access from a status name (FR02, R02).
  2. The `shared` subpath stays free of runtime imports. A value it needs at run time is a literal in it.
  3. The conformance suite asserts behaviour through the port only, so it runs unchanged against any host store.
  4. Error codes are a closed catalogue with one stable prefix; adding one later is a public change.
- **References**:
  - Spec §3.4, §3.5, §3.9 (FR22), §3.13, §6.4, §7
  - `AGENTS.md` §3, "A key built from more than one field keeps its boundaries"
- **Estimated size**: L
- **Tasks**: [`docs/tasks/phase-01-model-ports-and-test-doubles.md`](tasks/phase-01-model-ports-and-test-doubles.md)

---

### P2 — module-and-options

- **Goal**: Let a host configure the library once, and refuse a wrong configuration at boot with a message that names options and never values.
- **Scope**:
  - In: `forRoot` and `forRootAsync`; the options for the store, the account resolver, the hook, the fail policy, the staleness limits with their 24-hour defaults (D12), the sandbox switch, the optional cache and the controller switches; one aggregated validation error (§6.3); symbol injection tokens; the `Secret` holder for credentials and webhook secrets (SEC05, SEC09); the sandbox option and the refusal to enable it in production without the second confirming option (SEC07); loading only the configured adapter (NFR05); the optional peers `@bymax-one/nest-cache` and `@bymax-one/nest-core`.
  - Out: what the options drive (P3 to P8); adapter-specific option validation beyond the common shape, which arrives with each adapter.
- **Definition of Done**:
  - [x] A NestJS application boots with the fake source and the in-memory store through both `forRoot` and `forRootAsync`.
  - [x] Several invalid options at once produce one error that lists every offending option name and contains none of the supplied values.
  - [x] Serializing, spreading and inspecting the resolved options and every library provider, including inspection with hidden properties shown, exposes no credential and no webhook secret (AC09 for library objects).
  - [x] Enabling sandbox access in a production environment without the confirming option stops the boot.
  - [x] With one adapter configured, the other adapter's module is absent from the loaded module graph, proven on the packed tarball.
- **Context / preconditions**: P1 is done. The fake source and the in-memory store exist, so the module is testable without an adapter.
- **Rules-of-phase**:
  1. The library reads no environment variable. What "production" means is a value the host passes in.
  2. Secret containment never redefines a property on an object the host owns.
  3. An absent optional peer is a supported configuration with its own test, not an error path.
- **References**:
  - Spec §6.2, §6.3, §8, §8.2 (SEC05, SEC07, SEC09), §10.1 (D07, D12)
  - `bymaxone/nest-auth` for module options, as the specification's sibling precedent
- **Estimated size**: M
- **Tasks**: [`docs/tasks/phase-02-module-and-options.md`](tasks/phase-02-module-and-options.md)

---

### P3 — read-refresh-reconcile

- **Goal**: Keep one correct snapshot per account in the store and let the host read it, refresh it and reconcile it.
- **Scope**:
  - In: the service's two reads, which answer from the store and never wait for the source (FR28); refresh on demand, with concurrent refreshes of one account collapsed into one source call (FR24, NFR03); the age on every snapshot and the background refresh of a stale one on its next read (FR25); the rule that an older snapshot never replaces a newer one (FR27); reconciliation in bounded batches under a rate limit, as a method the host schedules (FR26, NFR04); the optional read-through cache with invalidation on every change (FR23); the tenant in every key, taken from the caller and never from a body (SEC08).
  - Out: the guard (P4); telling the host about a change (P5); webhooks (P6).
- **Definition of Done**:
  - [x] Reading a fresh snapshot or asking for an entitlement on one makes zero calls on the fake source, and no read ever waits for a source call unless a refresh was requested.
  - [x] One hundred concurrent refreshes of one account produce one source call; refreshes of different accounts do not wait for each other.
  - [x] A snapshot the source reports as older than the stored one is not written, under sequential and under concurrent writes.
  - [x] A reconciliation run refreshes only accounts older than the threshold, stops at the configured batch bound and never exceeds the configured rate.
  - [x] With a cache configured, a change is visible on the next read; with none, every test in the phase still passes.
- **Context / preconditions**: P2 is done.
- **Rules-of-phase**:
  1. A background refresh never changes what the current read returns and never rejects it.
  2. A source failure during refresh leaves the stored snapshot untouched and surfaces as the catalogue's "source unavailable" code.
  3. Time comes from one injectable clock, so staleness and tolerance are tested without waiting.
- **References**:
  - Spec §3.9, §3.10 (FR28), §7, §8.1, §9 (R05, R06)
- **Estimated size**: L
- **Tasks**: [`docs/tasks/phase-03-read-refresh-reconcile.md`](tasks/phase-03-read-refresh-reconcile.md)

---

### P4 — guard-and-fail-policy

- **Goal**: Protect a route with one decorator, and make the answer under failure an explicit choice that defaults to refusal.
- **Scope**:
  - In: the decorator naming an entitlement and the guard that enforces it; the account resolver the host supplies, and the unauthenticated refusal when it yields no account (FR29); the stable refusal codes that separate "no subscription" from "subscription exists and gives no access", with no detail about any other account (FR30); the fail policy with its two values, refuse by default and last known state within a tolerance (FR31, SEC04); no guard decision waiting on a network call (NFR01, D19).
  - Out: change notifications; the error envelope of a host that does not use `@bymax-one/nest-core`, beyond the documented default.
- **Definition of Done**:
  - [x] An end-to-end test protects a route with the decorator and gets access, the "no subscription" refusal and the "gives no access" refusal from three accounts.
  - [x] A request with no resolvable account is refused as unauthenticated.
  - [x] With the store unreadable or the snapshot missing, the guard refuses under the default policy; under the last-known-state policy it allows a snapshot younger than the tolerance and refuses an older one, at the boundary exactly (AC07).
  - [x] No guard decision waits for a source call: with a fresh snapshot the source is not called, and with a stale one the decision is returned before the background refresh resolves.
  - [x] A refusal body contains only the error code and message of the catalogue.
- **Context / preconditions**: P3 is done.
- **Rules-of-phase**:
  1. The guard reads the "gives access" flag and never a status name.
  2. The guard never trusts an account or tenant identifier from a request body, query or header it was not handed by the resolver.
  3. Refusal is the default in every unhandled case: an unexpected error in the guard denies.
- **References**:
  - Spec §3.10, §6.4, §8.1 (NFR01), §8.2 (SEC04, SEC08)
  - `bymaxone/nest-auth` for guards and decorators, as the specification's sibling precedent
- **Estimated size**: M
- **Tasks**: [`docs/tasks/phase-04-guard-and-fail-policy.md`](tasks/phase-04-guard-and-fail-policy.md)

---

### P5 — change-notifications-and-observer

- **Goal**: Tell the host what changed, at least once and idempotently, and give operations counters that carry no personal data.
- **Scope**:
  - In: the comparison of the previous and the new snapshot into the typed change list of FR32, including `overlap_detected` (FR05) and `transferred`; the hook call after the store write, with the previous snapshot, the new one and the list, and without the previous snapshot on a redelivery (FR32, D20); at-least-once delivery through changes stored with the snapshot as not delivered, cleared after the hook returns and delivered again by reconciliation (FR33, D17); the stable key per change, and containment of a hook that throws (FR33); the optional observer with counters and timings for webhooks by outcome, refreshes, source errors, cache hits and guard decisions (FR34); account identifiers absent from observer payloads and logs, or present only as a short hash (SEC06).
  - Out: a queue, a timer or a retry loop of the library's own; the webhook receiver that will later be one of the callers.
- **Definition of Done**:
  - [x] A table-driven test produces each change kind of FR32 from a pair of snapshots, and produces none for two equal snapshots.
  - [x] The same change computed twice carries the same key; two consecutive renewals carry different keys.
  - [x] A hook that throws leaves the stored snapshot in place and its changes marked as not delivered, and the failure reaches the log and the observer.
  - [x] A crash simulated between the write and the hook is followed by a reconciliation run that delivers the same change keys.
  - [x] The hook is never invoked before the store write has succeeded.
  - [x] Every observer payload in the suite is asserted free of account identifiers and payload content.
- **Context / preconditions**: P3 is done. P4 is independent and may be in progress.
- **Rules-of-phase**:
  1. The change list is a pure function of two snapshots. It never reads a webhook payload.
  2. Delivery is specified as at-least-once: the documentation and the types tell the host to be idempotent, and no code claims exactly-once.
  3. The observer is optional, and its absence costs nothing on the hot path.
- **References**:
  - Spec §3.4 (FR05), §3.11, §8.2 (SEC06), §9 (R04)
- **Estimated size**: M
- **Tasks**: [`docs/tasks/phase-05-change-notifications-and-observer.md`](tasks/phase-05-change-notifications-and-observer.md)

---

### P6 — webhook-receiver

- **Goal**: Accept a source's notification safely: verify it, de-duplicate it, refresh from the source and answer within the source's contract.
- **Scope**:
  - In: the processor that takes raw bytes and headers and returns an outcome, and the controller behind a switch that is off by default (FR17, D10); the refusal to start the controller without access to the unparsed body; the rule that a verified notification only triggers a read of the source (FR16, SEC01); verification delegated to the adapter over raw bytes before parsing (SEC02); one indistinguishable answer for every failed check (SEC03); the five outcomes and their HTTP answers (FR18); de-duplication by event identifier with a retention the host sets (FR19); acceptance of unknown event kinds and fields (FR20); the deadline, answered as a temporary failure when the source read is slow (FR21, NFR02); nothing of the raw payload stored or logged (SEC06).
  - Out: any provider's signature scheme or event names, which belong to the adapters.
- **Definition of Done**:
  - [ ] Driven by the fake source, a verified notification results in a stored snapshot read from the source, and the payload's own state is provably ignored.
  - [ ] A notification that fails verification is refused with one answer that is identical for every kind of failure, and changes nothing (AC02 for the receiver).
  - [ ] The same event delivered five times causes one source read and one host notification (AC03).
  - [ ] Events delivered in reverse order leave the snapshot equal to the source's current state (AC04).
  - [ ] A source read slower than the deadline is answered as a temporary failure before the deadline, and a later retry of that event is processed.
- **Context / preconditions**: P3 and P5 are done. De-duplication of a failed event follows D16.
- **Rules-of-phase**:
  1. No code path writes a snapshot from payload content.
  2. The controller and the processor share one implementation; the controller only adapts HTTP.
  3. A new event kind must never produce an error answer: unknown means refresh.
  4. The host hook runs outside the response deadline.
- **References**:
  - Spec §3.8, §8.1 (NFR02), §8.2 (SEC01, SEC02, SEC03, SEC06), §9 (R06), Appendix A.1
- **Estimated size**: L
- **Tasks**: [`docs/tasks/phase-06-webhook-receiver.md`](tasks/phase-06-webhook-receiver.md)

**Decided.** An event identifier is recorded when processing starts and removed when the event ends in the failed outcome, so the source's retry is processed (D16).

---

### P7 — revenuecat-adapter

- **Goal**: Make RevenueCat a working source: read it, verify its webhooks and map its states, with every rule traceable to Appendix A.
- **Scope**:
  - In: the read of a customer's subscriptions and active entitlements from version 2 of the REST API (FR10, D06); the App User ID as account identifier, events for anonymous or unknown identifiers recorded and reported, and the refresh of both accounts on an alias or a transfer (FR11); both verification methods, with the boot report when only the static header is used (FR12); the non-renewing purchases that grant an entitlement, read from the API and mapped into the model, which is extended where it cannot express them (FR02, FR05, D31); the sandbox filter applied by the adapter itself (FR13, SEC07); the status, renewal and store mappings and the three notable rules (FR14, Appendix A.3); the event kinds of Appendix A.2 mapped to the port's change kinds, with every other kind passing as unknown; secret rotation as RevenueCat allows it (SEC09); the signed request builders for RevenueCat in the testing subpath (FR39); recorded payload fixtures with identifiers and secrets replaced.
  - Out: the management operations and the management reference (P8); version 1 of the API except what P8 needs; consumables, which grant nothing (D31, specification §3.2).
- **Definition of Done**:
  - [ ] A table-driven test generated from Appendix A.3 maps every listed status, renewal status and store, and maps an unlisted value to `unknown` or `other` (AC10 for Appendix A).
  - [ ] A wrong signature, a wrong authorization header, a stale timestamp and a body altered after signing are each refused, and the comparison is constant-time by construction (AC02 for RevenueCat).
  - [ ] End to end, a recorded purchase notification yields an active entitlement through the service (AC01), and a refund of the current period removes access on the next refresh and emits `refunded` (AC05).
  - [ ] A recorded RevenueCat fixture of a non-renewing purchase that grants an entitlement yields an active entitlement through the service, with access until null for a lifetime grant, and a consumable grants nothing (D31).
  - [ ] A sandbox purchase grants nothing under the default configuration, with RevenueCat's own default of granting it reproduced in the fixture (AC06).
  - [ ] Unit tests open no socket; the suite's only HTTP is a local stand-in for the RevenueCat API.
- **Context / preconditions**: The unit work needs P1 and P2. The non-renewing purchases need P3 and P5. Closing the phase needs P6. The owner provides a RevenueCat sandbox project and its credentials, from which the fixtures are recorded (D18).
- **Rules-of-phase**:
  1. Each fact from Appendix A is re-read on the page listed in specification §12 before the code relies on it, and the three items of Appendix A.6 are resolved or kept explicitly unknown.
  2. The refund marker of version 2 is one of those items: until it is confirmed, the task records how a refund is detected and what the fixture proves.
  3. A scheduled pause is not a pause, a cancellation is not an expiry, and a billing issue follows the source's access flag.
  4. A recorded fixture never contains a real identifier, token or signature secret.
- **References**:
  - Spec §3.4 (FR02, FR05), §3.6, §8.2 (SEC07, SEC09), §9 (R02, R03), §10.1 (D31), §12, Appendix A
- **Estimated size**: L
- **Tasks**: [`docs/tasks/phase-07-revenuecat-adapter.md`](tasks/phase-07-revenuecat-adapter.md)

---

### P8 — management-operations

- **Goal**: Let a host stop a renewal, resume, change product, extend or refund where a server can, and send the person to the right place where it cannot, without ever claiming more than happened.
- **Scope**:
  - In: the capability query per subscription, answered by the adapter according to the origin (FR35); stop renewal, resume, change product, extend and refund through the service, each followed by a refresh, with the snapshot read back from the source as the result (FR36, FR38, D32); the "not possible from a server" result that carries the management reference instead of an error (FR36); the management reference on its own (FR37); the check that the subscription belongs to the authenticated account (SEC10); for RevenueCat, each operation for the origins where RevenueCat documents it as possible from a server, through the version of its API that offers it, and the others answered as not possible with the management reference (Appendix A.4, D06, D13, D32).
  - Out: any controller for these operations, which the host writes.
- **Definition of Done**:
  - [ ] The capability answer for every operation and every origin matches Appendix A.4 as recorded from RevenueCat's documentation, in a table-driven test.
  - [ ] For every operation (stop renewal, resume, change product, extend, refund), the result is the snapshot read back from the source, in one test per operation, and an accepted request that the read-back contradicts is reported as not done.
  - [ ] Stop renewal on a Google Play subscription calls the source once and returns the snapshot read back afterwards, with will renew `no`.
  - [ ] Stop renewal on an App Store subscription returns the "must be done by the person" result with the management reference, and calls nothing.
  - [ ] An operation on a subscription of another account, or of another tenant, is refused and reaches no source.
  - [ ] When the source accepts the request and the read-back still shows a renewing subscription, the result reports what the source says.
- **Context / preconditions**: P3 and P7 are done.
- **Rules-of-phase**:
  1. The result type has no "assumed done" value: success is defined by the read-back.
  2. The subscription is looked up inside the caller's own snapshot, never by an identifier taken on trust.
  3. Which origin allows which operation is taken from RevenueCat's documentation, re-read and cited before each operation is coded, and recorded in Appendix A.4; none is assumed. Version 1 of the API is used only for an operation that exists only there.
- **References**:
  - Spec §3.12, §8.2 (SEC10), §10.1 (D06, D13, D32), Appendix A.4
- **Estimated size**: L
- **Tasks**: [`docs/tasks/phase-08-management-operations.md`](tasks/phase-08-management-operations.md)

---

### P9 — release-readiness

- **Goal**: Make the package publishable: documented to the family's standard, measured as a whole and ready for the owner's release instruction.
- **Scope**:
  - In: the public `README.md` in the family's canonical sequence, including the raw-body setup for NestJS (FR17), the reference store over a relational table (FR22, D11), the error code catalogue and the security table; the changelog entry of the first release; a sweep of captured logs across the whole end-to-end suite for secrets and account identifiers (AC09); a full, non-incremental mutation run; the bundle size budget and the API surface baseline set from the real build; the checks that README links resolve and its snippets compile; the scheduled job that watches the provider's changelog (R03); a publish dry run; one end-to-end suite in this repository that runs the same routes and the same hook code, unchanged, against the fake source and against a local stand-in of the RevenueCat API (AC08, D29).
  - Out: `npm publish` and the version tag, which are the owner's (specification §8); the Finance adapter's documentation beyond stating that it is planned; the Finance run of AC08, which belongs to P11; any example repository (D29).
- **Definition of Done**:
  - [ ] Every acceptance criterion from AC01 to AC07, AC09 and the Appendix A half of AC10 points at a named, passing test in a table in the pull request.
  - [ ] The full mutation run scores 100 with no disable directive lacking a recorded reason.
  - [ ] Every README snippet compiles against the built package, and every statement in its security section names a control the repository actually runs.
  - [ ] No log line captured across the end-to-end suite contains a configured secret or a raw account identifier.
  - [ ] One end-to-end suite runs unchanged against the fake source and against a local RevenueCat stand-in, with no difference in routes or hook code between the two runs (AC08).
  - [ ] `npm publish --dry-run` succeeds from a clean checkout, and the tarball passes the export, runtime and published-surface checks.
- **Context / preconditions**: P4, P5, P6, P7 and P8 are done.
- **Rules-of-phase**:
  1. A documented guarantee states its limit next to it. The fail policy, sandbox handling and at-least-once delivery are described with what they do not cover.
  2. Badges and counts reflect the repository's measured numbers, not a gate's floor.
  3. The phase ends at a release candidate. Publishing, tagging and the first manual publish wait for the owner's explicit instruction.
- **References**:
  - Spec §5, §5.1 (AC08), §8, §9 (R03, R05), §10.1 (D29)
  - `bymaxone/nest-telemetry` for the README and release workflow
- **Estimated size**: M
- **Tasks**: [`docs/tasks/phase-09-release-readiness.md`](tasks/phase-09-release-readiness.md)

---

> P10 (an example repository) was removed by D29; the phase IDs are kept, so the list runs from P9 to P11.

---

### P11 — finance-adapter

- **Goal**: Make Bymax Finance a working source for a host that uses no RevenueCat, with the same host code.
- **Scope**:
  - In: the read of a customer's subscription and entitlements with a tenant API key, the verification of Finance's signed webhooks, and the state mapping of Appendix B (FR15); the pair of host account identifier and Finance customer identifier stored at first contact, and the lookup by external reference once Finance offers it (D15); the host's map from plan identifiers to entitlement names (D07); the test-data marker (SEC07) and secret rotation (SEC09); stop renewal at period end and the management reference; the Finance request builders in the testing subpath (FR39); the Finance run of the AC08 suite of this repository.
  - Out: subscriptions bought through the app stores, which Finance does not report as specified today (R01).
- **Definition of Done**:
  - [ ] Every item of Appendix B is checked against the released Finance API, and each difference is recorded in the specification before code is written.
  - [ ] A table-driven test generated from Appendix B maps every Finance state, with "pending first payment" yielding no subscription record (AC10 for Appendix B).
  - [ ] The AC08 suite of this repository passes against the Finance adapter with no change in routes or hook code (AC08).
  - [ ] With the Finance adapter configured, no RevenueCat code is loaded, and the reverse (NFR05).
- **Context / preconditions**: Deferred (D30): not part of the first release, and it blocks nothing. It stays pending until the Bymax Finance public API exists (D03). It closes after P8 and P9, whose suite it extends. Appendix B is a planned contract and can change. The needs it lists are sent to the Finance project now, so the API can meet them.
- **Rules-of-phase**:
  1. Nothing is built against the planned contract. The phase starts by re-reading the released API.
  2. The adapter uses no private entry of the library; if it needs one, the port is what changes, for every adapter.
  3. Starting this phase does not reopen the first release: it ships as a later version on the owner's instruction (D30).
- **References**:
  - Spec §3.7, §9 (R01), §10.1 (D03, D07, D15, D29, D30), Appendix B
- **Estimated size**: L
- **Tasks**: [`docs/tasks/phase-11-finance-adapter.md`](tasks/phase-11-finance-adapter.md)

---

## Update protocol

When a phase moves status:

1. Edit the row in the **Phase dashboard** table: status emoji, progress and last-updated date. Make the same change in the phase index of [`docs/tasks/README.md`](tasks/README.md), with its counters.
2. Update the **Overall progress** counter and percentage.
3. Update the **Active phase** and **Blocked** lines at the top.
4. If the phase is ✅ Done, append a one-line entry to the **Completion log** below.
5. If a downstream phase becomes unblocked, say so in the same change; its status moves to 🔄 In Progress only when work on it starts.
6. If the phase changed what a later phase must do, edit that later phase here in the same pull request, and edit the specification first when the change is to a requirement.
7. Leave the commit to the owner. Suggested message when asked: `chore(roadmap): nest-subscription phase N → status`. Commands that run this protocol never commit on their own.

---

## Completion log

> Append-only. One line per phase completion.

- P0 ✅ 2026-11-24 — scaffold, gates, CI and repository documents merged in #4; CI passed is a required check
- P1 ✅ 2026-11-24 — the model, the two ports, the in-memory store, the conformance suite and the fake source merged in #6
- P2 ✅ 2026-11-25 — the module, its options and their validation, secret containment and the sandbox boot refusal merged in #7
- P3 ✅ 2026-11-25 — reads, refresh with single flight, staleness, the cache and reconciliation merged in #9
- P4 ✅ 2026-11-25 — the decorator, the guard, the stable refusal codes and the two fail policies merged in #10 (cba5824)

---

## Sign-off

The task files for every phase are in [`docs/tasks/`](tasks/README.md). Work starts with task 0.1 of [`phase-00-scaffold-and-governance.md`](tasks/phase-00-scaffold-and-governance.md), one phase at a time, in the order of the dependency graph.
