# Phase 9 — Release readiness

> **Status**: 🔄 In Progress &nbsp;·&nbsp; **Progress**: 3 / 6 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-26
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P9 — release-readiness
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library does everything the first release promises except the Bymax Finance adapter, and its public documents still describe a scaffold.

At the end the package is publishable: the README follows the family's canonical sequence and every snippet in it compiles against the built package, the host-facing guides exist (raw body, the reference store over a relational table), the whole package is measured (full mutation run, log sweep, size budget, API baseline), every acceptance criterion points at a passing test, and a publish dry run succeeds. The phase ends at a release candidate. Publishing and tagging wait for the owner's explicit instruction.

---

## Rules-of-phase

1. A documented guarantee states its limit next to it: the fail policy, sandbox handling and at-least-once delivery are described with what they do not cover.
2. A security control is claimed only if the repository runs it. Count per repository before writing.
3. Badges and counts show the repository's measured numbers, not a gate's floor.
4. Every code snippet in a public document compiles against the built package.
5. No `npm publish`, no version bump and no tag in this phase.

---

## Reference docs

- `docs/spec.md` §5 (success criteria), §8 (constraints, release), §9 (R03, R05)
- `docs/plan.md` § "P9 — release-readiness"
- The README of `bymaxone/nest-telemetry` and of `bymaxone/nest-queue`, for the family's section sequence and the shape of each section
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                              | Status  | Priority | Size | Depends on    |
| --- | ------------------------------------------------- | ------- | -------- | ---- | ------------- |
| 9.1 | Write the public README                           | ✅ Done | P0       | L    | —             |
| 9.2 | Write the host guides                             | 📋 ToDo | P0       | M    | 9.1           |
| 9.3 | Sweep the captured logs of the whole suite        | ✅ Done | P0       | M    | 9.1           |
| 9.6 | Prove AC08 with one suite run against two sources | ✅ Done | P0       | M    | —             |
| 9.4 | Measure the whole package                         | 📋 ToDo | P0       | M    | 9.2, 9.3, 9.6 |
| 9.5 | Prepare the release candidate                     | 📋 ToDo | P0       | M    | 9.4           |

---

## Tasks

### Task 9.1 — Write the public README

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: —

#### Description

Replace the scaffold README with the public document of the package, in the family's canonical sequence.

#### Acceptance criteria

- [x] The README has, in order: centred header with badges and links; Overview with "Why"; Features; Subpath Exports with a dependency diagram and the peer dependency matrix; Quick Start; Configuration (options table); the domain sections (reading and guarding, webhooks, refresh and reconciliation, change notifications, management operations, testing); Architecture with a drawn diagram and design principles; Security Model; Security Table; Tech Stack; Testing and Quality; API Reference; Error Code Catalog; What This Library Does Not Do; Contributing; Security Policy; License; footer.
- [x] Every snippet compiles: `pnpm check:docs` passes with the snippet baseline empty.
- [x] The Security Model has one subsection per property, each stating its limit, and the Security Table lists only controls the repository runs.
- [x] The Bymax Finance adapter is described as planned and not available.
- [x] The error code catalog table is checked against `SUBSCRIPTION_ERROR_CODES` by a test or a gate.
- [x] The security contact is `support@bymax.one`.

#### Files to create / modify

- ✎ `README.md`
- ✎ `scripts/doc-snippets-baseline.json` (stays empty)
- ✚ a check that the README's error table matches the catalogue, in `scripts/` or the unit suite

#### Agent prompt (EN)

```
You are a senior technical writer who knows the library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P9 (release-readiness) — Task 9.1 of 6 (FIRST of this phase)

PRECONDITIONS
- P4, P5, P6, P7 and P8 are ✅ Done: the first release's behaviour is complete and every gate passes.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` (whole document)
- `docs/plan.md` § "P9 — release-readiness"
- The README of `bymaxone/nest-telemetry` and of `bymaxone/nest-queue`, for the family's section sequence and the shape of each section
- `src/core/index.ts`, `src/shared/index.ts`, `src/revenuecat/index.ts`, `src/testing/index.ts` and the option types, for the real names

TASK
Write the public `README.md` of `@bymax-one/nest-subscription`.

DELIVERABLES

1. The README in the sequence above, with `---` between every second-level section, formatted with Prettier.

2. An Architecture diagram drawn with box characters that shows what flows to what (request to guard to service to store; webhook to verification to source read to store to hook), not a list of components.

3. A Quick Start a reader can paste: module configuration with the RevenueCat adapter, a store, a resolver, one protected route, the webhook controller with raw body.

4. The limits written beside their guarantees: last-known-state extends access during an outage, including for a refunded account; delivery is at least once and the host must be idempotent; sandbox access is off unless enabled twice in production.

Constraints:
- Describe only what the code does today. Read the source for every claim; do not write from the specification where the two might differ, and report any difference found.
- No badge shows a number that was not measured in this repository.
- English everywhere. No attribution to an AI tool in any file, commit or pull request.
- A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written, and the source is cited.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm build && pnpm check:docs && pnpm check:published` — expected: pass
- `pnpm exec prettier --check README.md` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-09-release-readiness.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/6 tasks`)
5. Update the P9 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/6`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 9.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 9.2 — Write the host guides

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 9.1

#### Description

Write the two guides the specification promises to a host: how to obtain the raw request body in NestJS (FR17), and a reference implementation of the store over a relational table (FR22, D11).

#### Acceptance criteria

- [ ] `docs/raw-body.md` shows how to enable the raw body for the webhook route with the Express adapter, what breaks without it, and what a Fastify host does.
- [ ] `docs/reference-store.md` gives the two records of specification §7 as a table definition, the uniqueness and ordering the library relies on, and each port method as a query, for PostgreSQL.
- [ ] The reference store's code, kept as a test fixture, passes `storeConformanceCases`; if a database is not available in CI, the guide says how it was run and the fixture is exercised against a database by the host that adopts it.
- [ ] Both guides are linked from the README and from `docs/README.md`.

#### Files to create / modify

- ✚ `docs/raw-body.md`
- ✚ `docs/reference-store.md`
- ✎ `docs/README.md`, `README.md`

#### Agent prompt (EN)

```
You are a senior technical writer who knows the library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P9 (release-readiness) — Task 9.2 of 6 (MIDDLE of this phase)

PRECONDITIONS
- P4, P5, P6, P7 and P8 are ✅ Done: the first release's behaviour is complete and every gate passes.
- Task 9.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.8 (FR17), §3.9 (FR22, FR27), §7, §9 (R05), §10.1 (D11)
- `src/internal/store.port.ts`, `src/testing/store-conformance.ts`, `src/core/webhook/raw-body.ts`

TASK
Write the raw-body guide and the reference-store guide.

DELIVERABLES

1. `docs/raw-body.md`, checked against the current NestJS documentation at its source.

2. `docs/reference-store.md`: the schema, the atomic "mark event processed" statement, the conditional write that keeps an older snapshot from replacing a newer one, the stale listing with a limit and a cursor, and the retention delete.

Constraints:
- The library ships no database client and no migration (specification §3.2). The guide is documentation; its code is not exported.
- State the isolation level or the statement form that makes each guarantee hold, and why.
- English everywhere. No attribution to an AI tool in any file, commit or pull request.
- A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written, and the source is cited.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- The CI job that checks documents and relative links — expected: passes
- `pnpm check:published` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-09-release-readiness.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/6 tasks`)
5. Update the P9 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/6`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 9.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 9.3 — Sweep the captured logs of the whole suite

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 9.1

#### Description

Prove AC09 on the whole package: no secret and no account identifier in any log line, error message, observer payload or serialized instance, across the entire end-to-end suite.

#### Acceptance criteria

- [x] The end-to-end suite runs with every configured secret and every account and tenant identifier set to recognisable sentinels, and a global teardown fails the run if any captured log line, observer payload, thrown error message or HTTP response body contains one.
- [x] The four serialization paths (JSON, spread, inspect, inspect with hidden properties) are applied to every provider the module exports and to the object each adapter factory returns.
- [x] A deliberately introduced leak (a log line with an identifier, added and then removed) is caught by the sweep.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `test/e2e/setup/sentinel-sweep.ts`
- ✎ `jest.e2e.config.ts` — global setup and teardown
- ✎ `test/e2e/secret-containment.e2e-spec.ts`, `test/e2e/no-identifiers.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P9 (release-readiness) — Task 9.3 of 6 (MIDDLE of this phase)

PRECONDITIONS
- P4, P5, P6, P7 and P8 are ✅ Done: the first release's behaviour is complete and every gate passes.
- `createCapture` and `assertNoSentinel` exist in `src/testing/capture.ts` (P5).

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.1 (AC09), §8.2 (SEC05, SEC06)
- `src/testing/capture.ts`, `test/e2e/no-identifiers.e2e-spec.ts`

TASK
Turn the per-suite sentinel checks into one sweep over the whole end-to-end run.

DELIVERABLES

1. `sentinel-sweep.ts`: installs a capturing logger for every test application and checks everything captured at teardown.

2. Every end-to-end fixture application using the sentinels for its identifiers and secrets.

3. The proof-by-injection recorded in the pull request body.

Constraints:
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e` — expected: pass, with the sweep reporting how many lines and payloads it checked
- `pnpm test:cov:all` — expected: 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-09-release-readiness.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/6 tasks`)
5. Update the P9 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/6`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 9.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 9.4 — Measure the whole package

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 9.2, 9.3, 9.6

#### Description

Run the full, non-incremental mutation run, set the size budget and the API baseline from the real build, and build the acceptance table.

#### Acceptance criteria

- [ ] `pnpm mutation:full` scores 100, with no disable directive lacking a recorded reason (`pnpm check:mutants`).
- [ ] The size budget is set per subpath from the measured build with a small stated margin, and `pnpm size` passes.
- [ ] The API surface baseline matches the build, reviewed name by name for anything exported by accident.
- [ ] `docs/acceptance.md` maps AC01 to AC07, AC09 and the Appendix A half of AC10 to named passing tests, maps AC08 to the suite of task 9.6 for the fake source and the RevenueCat stand-in, and marks the Finance run of AC08 and the Appendix B half of AC10 as owned by P11.
- [ ] `docs/mutation_testing_results.md` records the full run's numbers.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `docs/acceptance.md`
- ✚ `docs/mutation_testing_results.md`
- ✎ the size budget and the API surface baseline
- ✎ `docs/README.md`

#### Agent prompt (EN)

```
You are a senior release engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P9 (release-readiness) — Task 9.4 of 6 (MIDDLE of this phase)

PRECONDITIONS
- P4, P5, P6, P7 and P8 are ✅ Done: the first release's behaviour is complete and every gate passes.
- Tasks 9.1 to 9.3 and 9.6 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.1, §5.2
- `docs/plan.md` § "Requirement coverage"
- `stryker.config.json`, `scripts/check-size.mjs`, `scripts/check-api-surface.mjs`

TASK
Measure the package as a whole and record the results.

DELIVERABLES

1. The full mutation run and its results document.

2. The budgets and baselines regenerated from the build, with the margin stated in the pull request.

3. `docs/acceptance.md`: a table of criterion, test file and test name, checked by running each named test.

Constraints:
- A surviving mutant is killed by a test or the code is simplified. A disable directive needs a reason that the mutation is equivalent, recorded where `check:mutants` reads it.
- Do not raise a budget to make a gate pass without saying what grew and why.
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm mutation:full` — expected: 100
- `pnpm build && pnpm size && pnpm check:api && pnpm check:exports && pnpm check:runtime` — expected: all pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-09-release-readiness.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/6 tasks`)
5. Update the P9 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/6`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 9.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 9.5 — Prepare the release candidate

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 9.4

#### Description

Write the changelog entry, add the scheduled job that watches the provider's changelog (R03), and prove a publish would succeed, without publishing.

#### Acceptance criteria

- [ ] `CHANGELOG.md` has the first release's entry under "Unreleased", written for a host: what the library does, its requirements (Node.js 26, NestJS 11), and its known limits.
- [ ] A scheduled workflow checks the RevenueCat changelog or API reference for changes to the facts in `docs/revenuecat-facts.md` and opens an issue when something moved; its first manual run is green.
- [ ] `npm publish --dry-run` succeeds from a clean checkout, and the tarball's file list holds `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE` and nothing from `test/`, `scripts/` or `docs/`.
- [ ] `prepublishOnly` runs the whole gate chain and passes.
- [ ] A list for the owner states what a release needs: the version number, the first manual publish (trusted publishing can be configured only after the package exists), the `npm-publish` environment, the tag made from updated `main` after the merge.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✎ `CHANGELOG.md`
- ✚ `.github/workflows/provider-changelog.yml`
- ✚ `scripts/check-provider-facts.mjs` and its `node --test` file
- ✎ `.npmignore` or the `files` field, if the dry run shows a stray file

#### Agent prompt (EN)

```
You are a senior release engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P9 (release-readiness) — Task 9.5 of 6 (LAST of this phase)

PRECONDITIONS
- P4, P5, P6, P7 and P8 are ✅ Done: the first release's behaviour is complete and every gate passes.
- Task 9.4 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §8 (release), §9 (R03)
- `docs/plan.md` § "P9 — release-readiness", Definition of Done
- `bymaxone/nest-telemetry`: `.github/workflows/release.yml` and its `CHANGELOG.md`, for the entry format

TASK
Bring the package to a release candidate and stop there.

DELIVERABLES

1. The changelog entry, with the note on how a derived backend adopts the library.

2. The provider watch: a script that fetches the pages cited in `docs/revenuecat-facts.md`, compares what it can compare mechanically (event type list, status values), and a workflow that runs it weekly on a day the repository's other schedules leave free. Third-party actions pinned by SHA.

3. The dry-run output and the tarball file list in the pull request body.

4. In the pull request body: the Definition of Done of P9, one line per item with its evidence, and the list for the owner.

Constraints:
- Do not run `npm publish` without `--dry-run`. Do not change the `version` field. Do not create a tag.
- The watch script sends no repository or account detail to the provider: plain unauthenticated GET requests to public pages.
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `npm publish --dry-run` — expected: success, with the expected file list
- `node --test scripts/check-provider-facts.test.mjs` — expected: pass
- `gh workflow run provider-changelog.yml` after merge — expected: green

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-09-release-readiness.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/6 tasks`)
5. Update the P9 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/6`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 9.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 9.6 — Prove AC08 with one suite run against two sources

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Add one end-to-end suite that runs the same routes and the same hook code, unchanged, against the library's fake source and against the RevenueCat adapter pointed at a local stand-in of the RevenueCat API, so that AC08 is proven in this repository (D29). The Finance run of AC08 is added by P11.

#### Acceptance criteria

- [x] One suite file holds every case, and one application factory builds the host: the protected routes, the webhook controller with the raw body and the hook are written once and shared by both runs.
- [x] The only difference between the two runs is the module configuration: the fake source in one, `revenueCatSource` with its `baseUrl` option set to the local stand-in (task 7.2) in the other. A test fails if a route or the hook is defined per source.
- [x] Both runs pass the same cases: a granted entitlement admits the request, an account with no subscription is refused, a webhook event changes the snapshot and calls the hook once, the same event delivered again calls it once, and the source down follows the configured fail policy (AC08, AC03, AC07).
- [x] The RevenueCat run serves recorded fixtures from `test/fixtures/revenuecat/` through the local stand-in; it opens no connection to a host outside the loopback address and uses no real credential. The credential and the webhook secret are literals made for the test.
- [x] The suite is registered so that adding the Finance adapter later is one more entry in the list of sources, with the cases untouched.
- [x] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `test/e2e/source-parity.e2e-spec.ts`
- ✚ `test/e2e/fixtures/parity-app.ts`
- ✎ `test/e2e/fixtures/revenuecat-stand-in.ts`, only if a case needs a response it cannot serve yet

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P9 (release-readiness) — Task 9.6 of 6 (MIDDLE of this phase)

PRECONDITIONS
- P4, P5, P6, P7 and P8 are ✅ Done: the guard, the hook, the webhook receiver, the RevenueCat adapter and its stand-in exist and every gate passes.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.1 (AC03, AC07, AC08), §10.1 (D29)
- `docs/plan.md` § "P9 — release-readiness", Definition of Done
- `test/e2e/fixtures/webhook-app.ts` and `test/e2e/fixtures/revenuecat-stand-in.ts`
- `src/testing/index.ts` (the fake source and the signed request builders)

TASK
Write the suite that proves AC08 in this repository: one set of routes and one hook, run against two sources.

DELIVERABLES

1. `test/e2e/fixtures/parity-app.ts`: one function that builds the host application from a module configuration it receives, with the protected routes, the webhook controller with the raw body and the hook. It contains no reference to a source.

2. `test/e2e/source-parity.e2e-spec.ts`: one list of sources, each entry holding only its module configuration, the way it scripts the account (the fake source's script, or the stand-in's fixtures) and its signed webhook request builder (the fake source's `buildRequest`, or `buildRevenueCatWebhookRequest`), and one set of cases that call the entry and never branch on its name.

3. In the pull request body: the Definition of Done of P9 for AC08, with the test names, and a statement of what the two runs differ in (the module configuration only).

Constraints:
- The cases and the application factory are the same for both runs. Do not add a branch on the source's name to either; if a case needs one, the port is what is missing.
- The RevenueCat run uses the adapter's real code over HTTP to the local stand-in, with recorded fixtures. No real network, no real credential, no secret from the environment.
- Test first: write the failing test, watch it fail, then make it pass. A case that cannot fail when the two sources behave differently is not a case.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new file opens with a header stating its purpose and layer. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test:e2e -t "source parity"` — expected: every case passes once per source
- `pnpm test:cov:all` — expected: 100 for statements, branches, functions and lines

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-09-release-readiness.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/6 tasks`)
5. Update the P9 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/6`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 9.6 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 9.6 ✅ 2026-11-26 — one suite runs the same application and cases against the fake source and the RevenueCat adapter over a local stand-in (AC08)
- 9.3 ✅ 2026-11-26 — a per-file sweep and a global teardown search every log line, observer payload, response body and library error of the whole end-to-end run for the sentinels the specs declare
- 9.1 ✅ 2026-11-26 — the public README in the family's sequence, every snippet compiled against the built package, the error table checked against the catalogue
