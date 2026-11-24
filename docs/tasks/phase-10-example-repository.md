# Phase 10 — Example repository

> **Status**: 📋 ToDo &nbsp;·&nbsp; **Progress**: 0 / 5 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-24
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P10 — example-repository
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library is a release candidate and no application uses it.

At the end the repository `nest-subscription-example` (D14) holds a NestJS application that uses the library the way a product would: a store over a relational table that passes the conformance suite against a real database, protected routes, a hook that reacts idempotently, the webhook controller with the raw body, and a scheduled reconciliation. One test suite runs unchanged against the fake source and against the RevenueCat adapter, which is the proof of AC08 for those two sources. The Finance run of AC08 belongs to P11.

This phase works in another repository. Friction found here is reported as an issue on the library, not patched around.

---

## Rules-of-phase

1. The example installs the library from the packed tarball or the published version, never from a path into the library's source tree.
2. The example follows the family's example repositories for structure and gates.
3. No secret is committed. RevenueCat is replaced by a local stand-in in CI; a run against a real sandbox project is a documented manual step.
4. Switching the source changes the module configuration and nothing else: routes, hook and tests are shared (AC08).
5. Friction found while writing the example is reported as an issue on `bymaxone/nest-subscription`, with a reproduction.

---

## Reference docs

- `docs/spec.md` §5.1 (AC08), §10.1 (D14), §9 (R05), §4 (user stories)
- `docs/plan.md` § "P10 — example-repository" (in the library repository)
- The library's `README.md`, `docs/raw-body.md` and `docs/reference-store.md`
- A sibling example repository, for structure: `bymaxone/nest-auth-example` or `bymaxone/nest-core-example`
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID   | Task                                                          | Status  | Priority | Size | Depends on |
| ---- | ------------------------------------------------------------- | ------- | -------- | ---- | ---------- |
| 10.1 | Create and scaffold the example repository                    | 📋 ToDo | P0       | M    | —          |
| 10.2 | Implement the relational store and pass the conformance suite | 📋 ToDo | P0       | M    | 10.1       |
| 10.3 | Wire the application the way a product would                  | 📋 ToDo | P0       | M    | 10.2       |
| 10.4 | Run one suite against the fake source and RevenueCat          | 📋 ToDo | P0       | M    | 10.3       |
| 10.5 | Link the example and close the phase                          | 📋 ToDo | P0       | S    | 10.4       |

---

## Tasks

### Task 10.1 — Create and scaffold the example repository

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Create `bymaxone/nest-subscription-example` and give it the family's example scaffold: a NestJS application, its gates, its CI and its repository documents.

#### Acceptance criteria

- [ ] The repository exists, public, MIT, with the organisation's rulesets applying, created by the owner or with the owner's explicit confirmation.
- [ ] A NestJS 11 application boots on Node.js 26 with a health route.
- [ ] Typecheck, lint, unit and end-to-end test commands exist and pass, and the CI aggregate check is named `CI passed`.
- [ ] `AGENTS.md`, `README.md`, `SECURITY.md` and the `agents-sync` and `no-ai-attribution` workflows are present, with `agents-sync.yml` pinned to a release commit.
- [ ] `@bymax-one/nest-subscription` is installed from the tarball or from npm, and the lockfile records which.
- [ ] The example's own gates pass: typecheck, lint, unit and end-to-end tests.

#### Files to create / modify

- ✚ in `nest-subscription-example`: `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `eslint.config.mjs`, `src/main.ts`, `src/app.module.ts`, `test/`, `.github/workflows/*`, `AGENTS.md`, `README.md`, `SECURITY.md`, `LICENSE`, `docker-compose.yml` (PostgreSQL for local runs)

#### Agent prompt (EN)

```
You are a senior NestJS application engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.
WORKING REPOSITORY: tasks of this phase are done in the separate repository `bymaxone/nest-subscription-example`, except where a task says otherwise. The task file and the roadmap stay in `bymaxone/nest-subscription`; run the Completion Protocol there.

CURRENT PHASE: P10 (example-repository) — Task 10.1 of 5 (FIRST of this phase)

PRECONDITIONS
- P9 is ✅ Done: `@bymax-one/nest-subscription` is a release candidate, installable from its packed tarball (`pnpm pack` in the library repository) or from npm once the owner has published it.
- Creating a repository is an action on GitHub that needs the owner: ask before creating it, or work in a repository the owner created.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §10.1 (D14), §5.1 (AC08) in the library repository
- `docs/plan.md` § "P10 — example-repository" (in the library repository)
- A sibling example repository's tree and CI (`gh api repos/bymaxone/nest-auth-example/git/trees/HEAD?recursive=1`)

TASK
Create the example repository and its scaffold.

DELIVERABLES

1. The repository, after the owner's confirmation, with the same baseline documents and workflows the library repository started with.

2. The application skeleton and its gates, mirrored from a sibling example with that example's domain removed.

3. The library dependency, with a script that installs it from a tarball path given by an environment variable for use before the first publish.

Constraints:
- Do not copy a secret, an `.env` file or a deployment configuration from the sibling.
- The example is an application: it may have dependencies. Choose the database client the sibling examples use, and state it in the README.
- Test first. TypeScript strict, no `any`, no suppression of any kind.
- Use only the public subpaths of `@bymax-one/nest-subscription`, installed from the packed tarball or from npm.
- English everywhere. No attribution to an AI tool in any file, commit or pull request. No secret in the repository.
- A gap or friction in the library is reported as an issue on `bymaxone/nest-subscription`, not patched around.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm install && pnpm typecheck && pnpm lint && pnpm test` — expected: pass
- A draft pull request in the example repository — expected: `CI passed` green

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-10-example-repository.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P10 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 10.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 10.2 — Implement the relational store and pass the conformance suite

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 10.1

#### Description

Implement `SubscriptionStore` over PostgreSQL following the library's reference-store guide, and run the library's conformance suite against it with a real database (R05).

#### Acceptance criteria

- [ ] The store implements every method of the port, with the two records of specification §7.
- [ ] `storeConformanceCases` from `@bymax-one/nest-subscription/testing` all pass against the store connected to a real PostgreSQL, locally and in CI.
- [ ] The migration creates the uniqueness on (source, event identifier) and on (tenant, account), and the conditional write is a single statement.
- [ ] Concurrent `markEventProcessed` calls for one identifier yield exactly one "new", proven against the database.
- [ ] The example's own gates pass: typecheck, lint, unit and end-to-end tests.

#### Files to create / modify

- ✚ in `nest-subscription-example`: `src/subscription/postgres-subscription.store.ts`, its migration, `test/store-conformance.e2e-spec.ts`
- ✎ the CI workflow — a PostgreSQL service container

#### Agent prompt (EN)

```
You are a senior NestJS and PostgreSQL engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.
WORKING REPOSITORY: tasks of this phase are done in the separate repository `bymaxone/nest-subscription-example`, except where a task says otherwise. The task file and the roadmap stay in `bymaxone/nest-subscription`; run the Completion Protocol there.

CURRENT PHASE: P10 (example-repository) — Task 10.2 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P9 is ✅ Done: `@bymax-one/nest-subscription` is a release candidate, installable from its packed tarball (`pnpm pack` in the library repository) or from npm once the owner has published it.
- Task 10.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/reference-store.md` and `docs/spec.md` §3.9 (FR22, FR27), §7 in the library repository
- The type `SubscriptionStore` as published in the installed package

TASK
Implement the PostgreSQL store and prove it with the library's conformance suite.

DELIVERABLES

1. The store, the migration and the test that feeds `storeConformanceCases` a factory for a clean schema per case.

2. A note in the example's README on what the conformance suite guarantees and that a host should run it against its own store.

3. An issue on the library for anything in the reference-store guide that turned out wrong or unclear.

Constraints:
- Queries are parameterized. No string-built SQL.
- The snapshot is stored as a document column, as specification §7 sketches; do not normalize it into columns the library does not define.
- Test first. TypeScript strict, no `any`, no suppression of any kind.
- Use only the public subpaths of `@bymax-one/nest-subscription`, installed from the packed tarball or from npm.
- English everywhere. No attribution to an AI tool in any file, commit or pull request. No secret in the repository.
- A gap or friction in the library is reported as an issue on `bymaxone/nest-subscription`, not patched around.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `docker compose up -d && pnpm test:e2e -t "store conformance"` — expected: every case passes

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-10-example-repository.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P10 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 10.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 10.3 — Wire the application the way a product would

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 10.2

#### Description

Configure `SubscriptionModule`, protect routes, react to changes idempotently, mount the webhook controller with the raw body, and schedule reconciliation.

#### Acceptance criteria

- [ ] The module is configured in one file whose only source-specific part is the line that builds the source.
- [ ] Two routes are protected with `RequiresEntitlement`, behind a stand-in authentication guard that supplies the account to the resolver.
- [ ] The hook grants a product benefit on `renewed` exactly once per change key, proven by delivering the same change twice.
- [ ] The webhook controller is mounted, raw body is enabled, and the route is outside the authentication guard.
- [ ] A scheduled job calls `reconcile` with a batch bound, and a route lets the app force a refresh after a purchase.
- [ ] A "stop renewal" route calls the service and returns the person-must-act result with the management reference when that is the outcome.
- [ ] The example's own gates pass: typecheck, lint, unit and end-to-end tests.

#### Files to create / modify

- ✚ in `nest-subscription-example`: `src/subscription/subscription.config.ts`, `account.resolver.ts`, `subscription-changes.handler.ts`, `reconciliation.job.ts`, `src/premium/premium.controller.ts`, `src/billing/billing.controller.ts`
- ✎ `src/main.ts`, `src/app.module.ts`

#### Agent prompt (EN)

```
You are a senior NestJS application engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.
WORKING REPOSITORY: tasks of this phase are done in the separate repository `bymaxone/nest-subscription-example`, except where a task says otherwise. The task file and the roadmap stay in `bymaxone/nest-subscription`; run the Completion Protocol there.

CURRENT PHASE: P10 (example-repository) — Task 10.3 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P9 is ✅ Done: `@bymax-one/nest-subscription` is a release candidate, installable from its packed tarball (`pnpm pack` in the library repository) or from npm once the owner has published it.
- Tasks 10.1 and 10.2 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- The library's `README.md` (Quick Start, Configuration, the domain sections) and `docs/raw-body.md`
- `docs/spec.md` §4 (user stories) in the library repository

TASK
Build the example application on top of the library's public API only.

DELIVERABLES

1. The files above, each small and commented for a reader who is learning the library.

2. The idempotency table for the hook: change key as a unique column, insert-or-skip.

3. An issue on the library for every place the README was not enough to write this code.

Constraints:
- Import only from the package's public subpaths. A deep import into `dist/` is a defect in the example.
- The scheduler belongs to the application; the library starts none.
- Test first. TypeScript strict, no `any`, no suppression of any kind.
- Use only the public subpaths of `@bymax-one/nest-subscription`, installed from the packed tarball or from npm.
- English everywhere. No attribution to an AI tool in any file, commit or pull request. No secret in the repository.
- A gap or friction in the library is reported as an issue on `bymaxone/nest-subscription`, not patched around.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test` — expected: pass
- `pnpm start` and a request to a protected route without an account — expected: 401

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-10-example-repository.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P10 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 10.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 10.4 — Run one suite against the fake source and RevenueCat

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 10.3

#### Description

Write one end-to-end suite and run it, unchanged, with the fake source and with the RevenueCat adapter pointed at a local stand-in (AC08).

#### Acceptance criteria

- [ ] The suite covers: purchase then access; refund then no access and a `refunded` reaction; duplicate webhook then one reaction; source down then the configured fail policy; stop renewal.
- [ ] The same test files run twice in CI, selected by one environment variable that only `subscription.config.ts` reads.
- [ ] `git diff` between the two runs' code paths is empty outside `subscription.config.ts`: no route, hook or test branches on the source.
- [ ] Each source provides its scenario driver behind one small test interface (set a state, emit a signed notification), which is the only source-specific test code.
- [ ] The example's own gates pass: typecheck, lint, unit and end-to-end tests.

#### Files to create / modify

- ✚ in `nest-subscription-example`: `test/subscription.e2e-spec.ts`, `test/drivers/source-driver.ts`, `test/drivers/fake.driver.ts`, `test/drivers/revenuecat.driver.ts`, `test/drivers/revenuecat-stand-in.ts`
- ✎ the CI workflow — a matrix over the two sources

#### Agent prompt (EN)

```
You are a senior NestJS test engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.
WORKING REPOSITORY: tasks of this phase are done in the separate repository `bymaxone/nest-subscription-example`, except where a task says otherwise. The task file and the roadmap stay in `bymaxone/nest-subscription`; run the Completion Protocol there.

CURRENT PHASE: P10 (example-repository) — Task 10.4 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P9 is ✅ Done: `@bymax-one/nest-subscription` is a release candidate, installable from its packed tarball (`pnpm pack` in the library repository) or from npm once the owner has published it.
- Tasks 10.1 to 10.3 are ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.1 (AC08), §3.13 (FR39) in the library repository
- The exports of `@bymax-one/nest-subscription/testing` in the installed package

TASK
Prove AC08 for the fake source and the RevenueCat adapter.

DELIVERABLES

1. The suite and the two drivers, using `FakeSubscriptionSource`, `buildRevenueCatWebhookRequest` and a local HTTP stand-in for the RevenueCat API.

2. The CI matrix.

3. A README section, "Run against a real RevenueCat sandbox", listing the manual steps and the environment variables, with no value in the repository.

Constraints:
- A test that needs `if (source === ...)` is a finding against the library's abstraction: report it as an issue instead of writing the branch.
- Test first. TypeScript strict, no `any`, no suppression of any kind.
- Use only the public subpaths of `@bymax-one/nest-subscription`, installed from the packed tarball or from npm.
- English everywhere. No attribution to an AI tool in any file, commit or pull request. No secret in the repository.
- A gap or friction in the library is reported as an issue on `bymaxone/nest-subscription`, not patched around.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `SUBSCRIPTION_SOURCE=fake pnpm test:e2e && SUBSCRIPTION_SOURCE=revenuecat pnpm test:e2e` — expected: both pass with the same test count

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-10-example-repository.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P10 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 10.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 10.5 — Link the example and close the phase

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 10.4

#### Description

Link the example from the library's README, record AC08's evidence, and collect the issues the example raised.

#### Acceptance criteria

- [ ] The library's README links to `nest-subscription-example` in its header links and in a tip under Subpath Exports.
- [ ] `docs/acceptance.md` in the library records AC08 for the fake source and RevenueCat, with the example's CI run as evidence, and still marks the Finance run as owned by P11.
- [ ] Every issue opened on the library from this phase is listed in the pull request, each either fixed or scheduled.
- [ ] The example's CI is green on its default branch.

#### Files to create / modify

- ✎ in `nest-subscription`: `README.md`, `docs/acceptance.md`
- ✎ in `nest-subscription-example`: `README.md`

#### Agent prompt (EN)

```
You are a senior maintainer engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.
WORKING REPOSITORY: tasks of this phase are done in the separate repository `bymaxone/nest-subscription-example`, except where a task says otherwise. The task file and the roadmap stay in `bymaxone/nest-subscription`; run the Completion Protocol there.

CURRENT PHASE: P10 (example-repository) — Task 10.5 of 5 (LAST of this phase)

PRECONDITIONS
- P9 is ✅ Done: `@bymax-one/nest-subscription` is a release candidate, installable from its packed tarball (`pnpm pack` in the library repository) or from npm once the owner has published it.
- Tasks 10.1 to 10.4 are ✅ Done.
- This task edits the library repository.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/plan.md` § "P10 — example-repository", Definition of Done
- `docs/acceptance.md`

TASK
Connect the two repositories and write the phase's evidence.

DELIVERABLES

1. The README links, checked by the library's published-surface gate.

2. The AC08 row in `docs/acceptance.md`.

3. In the pull request body: the Definition of Done of P10, one line per item with its evidence.

Constraints:
- English everywhere. No attribution to an AI tool in any file, commit or pull request.
- A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written, and the source is cited.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm check:published` in the library — expected: pass
- `gh run list --repo bymaxone/nest-subscription-example --branch main --limit 1` — expected: success

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-10-example-repository.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P10 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 10.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->
