# Phase 0 — Scaffold and governance

> **Status**: 🔄 In Progress &nbsp;·&nbsp; **Progress**: 2 / 7 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-24
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P0 — scaffold-and-governance
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the repository holds documents only, with the issue templates and the workflows `agents-sync.yml`, `ci.yml` and `no-ai-attribution.yml`. There is no `package.json` and no source.

At the end it is a library project that builds, tests and gates an empty package the way `bymaxone/nest-telemetry` does: five public subpaths (root, `shared`, `revenuecat`, `finance`, `testing`) and the internal bundle exist as entry points with no behaviour, every gate of the family runs on them and passes, the organisation's reusable CI runs beside the documents job, and the repository documents describe a library instead of a specification stage. No library behaviour is written in this phase.

---

## Rules-of-phase

1. Copy the mechanism, not the domain: every script, configuration and baseline taken from `nest-telemetry` is read before it is kept, and one that only serves telemetry is dropped.
2. No gate arrives weakened. A gate that cannot pass on an empty package is made to pass by the smallest real content, never by an exclusion, a lowered threshold or a wider ignore glob.
3. `agents-sync.yml` stays pinned to a release commit of `bymaxone/.github`; every other reusable from that repository stays on `@v1`; third-party actions are pinned by commit SHA.
4. The ruleset change is an action on GitHub outside the diff: the pull request body says what was changed and how to read it back.
5. The aggregate check keeps the literal name `CI passed`.

---

## Reference docs

- `docs/spec.md` §5.2 (quality gates), §6.2 (package), §8 (constraints), §11 (what the first implementation phase must deliver)
- `docs/plan.md` § "Global conventions", § "Target layout", § "P0 — scaffold-and-governance"
- `bymaxone/nest-telemetry`: `package.json`, `tsup.config.ts`, `tsconfig*.json`, `jest*.config.ts`, `stryker.config.json`, `eslint.config.mjs`, `scripts/`, `.github/`
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 0.1 | Bring the package metadata and the build toolchain | ✅ Done | P0 | L | — |
| 0.2 | Bring the test, coverage and mutation configuration | ✅ Done | P0 | M | 0.1 |
| 0.3 | Bring the packaging, size and source gates | 📋 ToDo | P0 | M | 0.2 |
| 0.4 | Bring the git hooks and commit rules | 📋 ToDo | P1 | S | 0.1 |
| 0.5 | Extend the CI with the family workflows | 📋 ToDo | P0 | M | 0.3 |
| 0.6 | Write the repository documents for a library | 📋 ToDo | P0 | M | 0.3 |
| 0.7 | Require the status checks and close the phase | 📋 ToDo | P0 | S | 0.5, 0.6 |

---

## Tasks

### Task 0.1 — Bring the package metadata and the build toolchain

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: —

#### Description

Create the package manifest, the TypeScript projects, the bundler configuration and the formatting and lint configuration, with the five subpaths of D08 and the internal bundle as empty entry points.

#### Acceptance criteria

- [x] `pnpm install` succeeds with a committed lockfile, and `package.json` has an empty `dependencies` field, `engines.node` at `>=26.0.0`, and NestJS packages as peers.
- [x] `pnpm build` emits ESM, CommonJS and both declaration formats for `.`, `./shared`, `./revenuecat`, `./finance`, `./testing` and the internal bundle.
- [x] The `exports` map gives each condition its own `types` entry, and `main`, `module`, `types` and `typesVersions` are present at the top level.
- [x] `pnpm typecheck` and `pnpm lint` pass.
- [x] The commands this task introduces pass locally on Node.js 26, and nothing brought from `nest-telemetry` names OpenTelemetry or telemetry.

#### Files to create / modify

- ✚ `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- ✚ `tsconfig.json`, `tsconfig.build.json`, `tsconfig.e2e.json`, `tsconfig.jest.json`, `tsup.config.ts`
- ✚ `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.npmignore`
- ✚ `src/shared/index.ts`, `src/internal/index.ts`, `src/core/index.ts`, `src/revenuecat/index.ts`, `src/finance/index.ts`, `src/testing/index.ts`
- ✎ `.gitignore` — only if the scaffold needs an entry it lacks

#### Agent prompt (EN)

````
You are a senior TypeScript build and packaging engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P0 (scaffold-and-governance) — Task 0.1 of 7 (FIRST of this phase)

PRECONDITIONS
- The repository holds documents only; there is no `package.json`.
- Node.js 26 and pnpm are installed locally.
- The scaffold to mirror is the public repository `bymaxone/nest-telemetry` at its current `main`. Read its files with `gh api repos/bymaxone/nest-telemetry/contents/<path>` or a shallow clone outside this repository.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.2, §6.2, §8 and §11
- `docs/plan.md` § "Global conventions", § "Target layout" and § "P0 — scaffold-and-governance"
- `bymaxone/nest-telemetry`: `package.json`, `pnpm-workspace.yaml`, `tsup.config.ts`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.e2e.json`, `tsconfig.jest.json`, `eslint.config.mjs`, `.prettierrc`, `.npmignore`

TASK
Create the package manifest and the build toolchain of `@bymax-one/nest-subscription`, mirrored from `nest-telemetry`, with six entry points that export nothing yet.

DELIVERABLES

1. `package.json`: name `@bymax-one/nest-subscription`, MIT, public, `"dependencies": {}`, `engines.node` `>=26.0.0`, the pinned `packageManager` the sibling uses, and the sibling's script names (see `docs/tasks/README.md` §4). Peers: `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `rxjs`, plus `@bymax-one/nest-cache` and `@bymax-one/nest-core` as optional peers. Do not copy any OpenTelemetry or `prom-client` peer. The version is `0.0.0`: publishing and version numbers are the owner's decision.

2. The `exports` map for `.`, `./shared`, `./revenuecat`, `./finance`, `./testing`, `./internal` and `./package.json`, each with `import` and `require` conditions that carry their own `types` (`.d.ts` and `.d.cts`), plus top-level `main`, `module`, `types` and a `typesVersions` block for the subpaths that lists `.d.cts` first and `.d.ts` as fallback.

3. `tsup.config.ts`: one entry per directory of `docs/tasks/README.md` §5, ESM and CommonJS, declarations for both, with `@bymax-one/nest-subscription/internal` marked external so that the other entry points import it by package specifier.

4. The four `tsconfig` files and `eslint.config.mjs`, taken from the sibling with every telemetry-specific path, rule exception and comment removed. Strict mode, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` stay on.

5. The six `index.ts` entry points, each with its file header and no export beyond what a later task needs to keep the build valid.

Constraints:
- Record in the pull request body which files of the sibling were dropped and why.
- Settings pnpm no longer reads from `package.json` go in `pnpm-workspace.yaml`.
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm install --frozen-lockfile` — expected: success
- `pnpm typecheck && pnpm lint && pnpm build` — expected: 0 errors, `dist/` holds `.mjs`, `.cjs`, `.d.ts` and `.d.cts` for all six entries
- `grep -rni "telemetry\|opentelemetry\|otel" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=docs --exclude=pnpm-lock.yaml .` — expected: only the references to the sibling repository in `AGENTS.md`

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-00-scaffold-and-governance.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P0 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 0.1 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 0.2 — Bring the test, coverage and mutation configuration

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 0.1

#### Description

Add the Jest projects (unit, end-to-end, combined coverage), the no-socket gate for unit tests and the Stryker configuration, and make every one of them pass on the empty package.

#### Acceptance criteria

- [x] `pnpm test`, `pnpm test:e2e` and `pnpm test:cov:all` pass, each meeting the 100% threshold on its own.
- [x] A unit test that opens a socket fails, proven once and then removed.
- [x] `pnpm mutation` runs to completion with thresholds `high`, `low` and `break` at 100.
- [x] The commands this task introduces pass locally on Node.js 26, and nothing brought from `nest-telemetry` names OpenTelemetry or telemetry.

#### Files to create / modify

- ✚ `jest.config.ts`, `jest.e2e.config.ts`, `jest.coverage.config.ts`, `jest.mutants.config.ts`, `jest.stryker.config.ts`, `stryker.config.json`
- ✚ `scripts/jest-no-sockets.resolver.cjs`, `scripts/jest-no-sockets.setup.cjs`, `scripts/jest-no-sockets.fixture.cjs`, `scripts/jest-no-sockets.supertest.cjs`, `scripts/check-socket-gate.mjs`
- ✚ `src/shared/index.spec.ts` (and one spec per entry point), `test/e2e/entrypoints.e2e-spec.ts`

#### Agent prompt (EN)

````
You are a senior test infrastructure engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P0 (scaffold-and-governance) — Task 0.2 of 7 (MIDDLE of this phase)

PRECONDITIONS
- Task 0.1 is ✅ Done: the package builds and the six entry points exist.
- The scaffold to mirror is the public repository `bymaxone/nest-telemetry` at its current `main`. Read its files with `gh api repos/bymaxone/nest-telemetry/contents/<path>` or a shallow clone outside this repository.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.2, §6.2, §8 and §11
- `docs/plan.md` § "Global conventions", § "Target layout" and § "P0 — scaffold-and-governance"
- `bymaxone/nest-telemetry`: `jest.config.ts`, `jest.e2e.config.ts`, `jest.coverage.config.ts`, `jest.mutants.config.ts`, `jest.stryker.config.ts`, `stryker.config.json`, `scripts/jest-no-sockets.*.cjs`, `scripts/check-socket-gate.mjs`, `test/e2e/entrypoints.e2e-spec.ts`

TASK
Bring the sibling's test, coverage and mutation setup and make each suite pass on the empty package with real, minimal tests.

DELIVERABLES

1. The five Jest configurations and `stryker.config.json`, with paths adapted to this repository's layout (`src/**/*.spec.ts`, `test/e2e/*.e2e-spec.ts`) and coverage thresholds at 100 for statements, branches, functions and lines.

2. The no-socket gate for the unit suite and its checker script, wired into `pnpm lint` as in the sibling.

3. One unit spec per entry point and `test/e2e/entrypoints.e2e-spec.ts`, asserting that each subpath loads and exposes exactly the names it should (none yet). These are the tests later phases extend, not placeholders to delete.

4. A note in the pull request body on how the mutation gate behaves with no mutants to kill. If Stryker cannot report a score on an empty package, give the entry points the smallest real content that a later phase keeps, and say which.

Constraints:
- Do not lower a threshold or add an exclusion to make an empty package pass.
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test && pnpm test:e2e && pnpm test:cov:all` — expected: all pass at 100%
- `pnpm mutation` — expected: completes; thresholds read 100 in `stryker.config.json`
- `pnpm lint` — expected: the socket gate check runs and passes

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-00-scaffold-and-governance.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P0 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 0.2 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 0.3 — Bring the packaging, size and source gates

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 0.2

#### Description

Add the gate scripts that check the packed tarball, the API surface, the bundle size, the documentation snippets and the file and function length limits.

#### Acceptance criteria

- [ ] `pnpm check:exports` and `pnpm check:runtime` pass against the packed tarball for all five public subpaths, in ESM and in CommonJS.
- [ ] `pnpm check:api`, `pnpm size`, `pnpm check:docs`, `pnpm check:published`, `pnpm check:file-length`, `pnpm check:function-length`, `pnpm check:spec-headers` and `pnpm check:mutants` pass.
- [ ] No script kept from the sibling loads a telemetry module, and no baseline lists a telemetry file.
- [ ] The commands this task introduces pass locally on Node.js 26, and nothing brought from `nest-telemetry` names OpenTelemetry or telemetry.

#### Files to create / modify

- ✚ `scripts/check-api-surface.mjs`, `scripts/check-consumer-runtime.mjs`, `scripts/check-dist-fresh.mjs`, `scripts/check-size.mjs`, `scripts/check-doc-snippets.mjs`, `scripts/check-published-surface.mjs`
- ✚ `scripts/check-file-length.mjs`, `scripts/check-function-length.mjs`, `scripts/function-length-key.mjs`, `scripts/check-spec-headers.mjs`, `scripts/check-mutation-directives.mjs`, `scripts/readme-snippet-modules.mjs`, `scripts/readme-prelude.d.ts`
- ✚ the baselines those scripts read, regenerated for this repository, and the `node --test` files that cover the scripts
- ✎ `package.json` — `prepublishOnly` chains every gate

#### Agent prompt (EN)

````
You are a senior build and release tooling engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P0 (scaffold-and-governance) — Task 0.3 of 7 (MIDDLE of this phase)

PRECONDITIONS
- Tasks 0.1 and 0.2 are ✅ Done.
- The scaffold to mirror is the public repository `bymaxone/nest-telemetry` at its current `main`. Read its files with `gh api repos/bymaxone/nest-telemetry/contents/<path>` or a shallow clone outside this repository.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.2, §6.2, §8 and §11
- `docs/plan.md` § "Global conventions", § "Target layout" and § "P0 — scaffold-and-governance"
- `bymaxone/nest-telemetry`: every file under `scripts/` and the `scripts` block of `package.json`

TASK
Triage the sibling's `scripts/` directory: keep and adapt every gate that applies to any `@bymax-one` library, drop what only serves telemetry, and regenerate each baseline from this repository.

DELIVERABLES

1. The gate scripts listed above, adapted to the six entry points. `check-consumer-runtime.mjs` loads each public subpath from the packed tarball in ESM and CommonJS; the internal bundle is loaded only through the public ones.

2. Baselines regenerated here, never copied: the API surface baseline, the size budget, and empty length and snippet baselines.

3. A table in the pull request body listing every file of the sibling's `scripts/` with "kept", "adapted" or "dropped" and one reason. Expected drops include the OpenTelemetry runtime proofs, the builtin-call inventory and the constant-table mutation helper, unless reading them shows a generic use.

4. `prepublishOnly` in `package.json` running the full chain, so a manual `npm publish` cannot bypass a gate.

Constraints:
- The export check packs the tarball itself and clears `npm_config_dry_run` in the child environment, as the sibling does.
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm build && pnpm check:exports && pnpm check:runtime && pnpm check:api && pnpm size` — expected: all pass
- `pnpm check:file-length && pnpm check:function-length && pnpm check:spec-headers && pnpm check:mutants && pnpm check:docs && pnpm check:published` — expected: all pass
- `ls scripts | grep -i "otel\|winston\|instrumentation\|logger-proofs\|database-proofs"` — expected: no output

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-00-scaffold-and-governance.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P0 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 0.3 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 0.4 — Bring the git hooks and commit rules

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 0.1

#### Description

Add Husky, commitlint and the local rule that rejects AI attribution in a commit message, plus the editor settings the sibling ships.

#### Acceptance criteria

- [ ] A commit whose message is not a Conventional Commit is rejected locally.
- [ ] A commit message that names an AI tool as author or reviewer is rejected locally, by the same patterns the organisation check uses.
- [ ] `pnpm install` installs the hooks through the `prepare` script.
- [ ] The commands this task introduces pass locally on Node.js 26, and nothing brought from `nest-telemetry` names OpenTelemetry or telemetry.

#### Files to create / modify

- ✚ `.husky/commit-msg`, `.husky/pre-commit`, `.husky/pre-push`
- ✚ `commitlint.config.cjs`, `scripts/commitlint-no-ai-attribution.cjs`, `.gitmessage`
- ✚ `.vscode/settings.json`, `.vscode/extensions.json`, `.cursor/rules/commit-messages.mdc`, `.codex/config.toml`

#### Agent prompt (EN)

````
You are a senior developer tooling engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P0 (scaffold-and-governance) — Task 0.4 of 7 (MIDDLE of this phase)

PRECONDITIONS
- Task 0.1 is ✅ Done.
- The scaffold to mirror is the public repository `bymaxone/nest-telemetry` at its current `main`. Read its files with `gh api repos/bymaxone/nest-telemetry/contents/<path>` or a shallow clone outside this repository.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `bymaxone/nest-telemetry`: `.husky/*`, `commitlint.config.cjs`, `scripts/commitlint-no-ai-attribution.cjs`, `.gitmessage`, `.vscode/*`, `.cursor/rules/commit-messages.mdc`, `.codex/config.toml`

TASK
Bring the sibling's git hooks, commit message rules and editor settings, unchanged except for names and paths that mention telemetry.

DELIVERABLES

1. The three Husky hooks, running what the sibling runs (commit message lint, staged checks, pre-push gates), with every command existing in this repository's `package.json`.

2. `commitlint.config.cjs` with the Conventional Commits rules and the no-attribution plugin.

3. The editor and agent configuration files, with no reference to telemetry.

Constraints:
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `echo "bad message" | pnpm exec commitlint` — expected: rejected
- `echo "fix: address copilot review" | pnpm exec commitlint` — expected: read the plugin first, then confirm it rejects a subject that names an AI tool as reviewer
- `echo "feat: add the shared model" | pnpm exec commitlint` — expected: accepted

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-00-scaffold-and-governance.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P0 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 0.4 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 0.5 — Extend the CI with the family workflows

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 0.3

#### Description

Call the organisation's reusable library CI and security workflows, add the release, CodeQL, OSV, Scorecard, API surface and full-mutation workflows, and add Dependabot.

#### Acceptance criteria

- [ ] The pull request shows the aggregate check `CI passed` green, produced by jobs that call `bymaxone/.github` reusables at `@v1`.
- [ ] The job that checks the required documents and the relative Markdown links is kept, and the aggregate check depends on it.
- [ ] `agents-sync.yml` is still pinned to a release commit, and `.github/dependabot.yml` has the group that moves that pin.
- [ ] Every third-party action is pinned by commit SHA with its version in a trailing comment.
- [ ] The release workflow publishes only from a version tag, through the `npm-publish` environment, and nothing in this task creates a tag.
- [ ] The commands this task introduces pass locally on Node.js 26, and nothing brought from `nest-telemetry` names OpenTelemetry or telemetry.

#### Files to create / modify

- ✎ `.github/workflows/ci.yml` — the family's jobs added around the documents job, which stays
- ✚ `.github/workflows/release.yml`, `codeql.yml`, `osv-scanner.yml`, `scorecard.yml`, `api-surface.yml`, `mutation-full.yml`, `peer-advisory-drift.yml`
- ✚ `.github/dependabot.yml`, `osv-scanner.toml`
- — `.github/workflows/agents-sync.yml` and `no-ai-attribution.yml` stay as they are

#### Agent prompt (EN)

````
You are a senior CI and release engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P0 (scaffold-and-governance) — Task 0.5 of 7 (MIDDLE of this phase)

PRECONDITIONS
- Tasks 0.1 to 0.3 are ✅ Done: every command the workflows call exists and passes locally.
- The scaffold to mirror is the public repository `bymaxone/nest-telemetry` at its current `main`. Read its files with `gh api repos/bymaxone/nest-telemetry/contents/<path>` or a shallow clone outside this repository.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §5.2, §6.2, §8 and §11
- `docs/plan.md` § "Global conventions", § "Target layout" and § "P0 — scaffold-and-governance"
- `AGENTS.md` §3, "Settled decisions are not review findings"
- `bymaxone/nest-telemetry`: every file under `.github/workflows/`, `.github/dependabot.yml`, `osv-scanner.toml`
- `bymaxone/.github`: `README.md`, the sections on `node-lib-ci.yml`, `security.yml` and `agents-sync.yml`, and `.github/workflow-templates/dependabot.yml`

TASK
Add the family's reusable library pipeline to the CI workflow, keeping its documents job, and add the sibling's other workflows, adapted to this package.

DELIVERABLES

1. `.github/workflows/ci.yml` calling `node-lib-ci.yml@v1` and `security.yml@v1`, plus the build verification job that runs the packaging, size, snippet and length gates, the existing job that checks the required documents and the relative Markdown links (kept as it is, because later tasks add documents and verify against it), and the aggregate job named exactly `CI passed` that fails when any dependency failed or was cancelled. The header comment states what the workflow checks, with no mention of a phase.

2. The release workflow (tag-triggered, `npm publish --provenance --access public` through the `npm-publish` environment), and the scheduled workflows of the sibling, each on a weekday and hour read from this repository's own schedule so they do not collide. Drop `otel-latest.yml`: it tests an OpenTelemetry peer this library does not have.

3. `.github/dependabot.yml` for npm and GitHub Actions, including the group from the organisation's template that moves the pinned `agents-sync.yml` reference in its own pull request.

4. In the pull request body: the list of inputs passed to each reusable workflow, each checked against that workflow's declared inputs at `v1`.

Constraints:
- Do not pin a `bymaxone/.github` reusable other than `agents-sync.yml` to a SHA, and do not move `agents-sync.yml` back to `@v1`.
- Jobs that check tags or the published surface need a full clone (`fetch-depth: 0`).
- Do not create the `npm-publish` environment or any secret; list what the owner has to configure.
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `python3 -c "import yaml,glob;[yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]"` — expected: every workflow parses
- `grep -rn "uses:" .github/workflows | grep -v "@[0-9a-f]\{40\}" | grep -v "bymaxone/.github/.github/workflows/.*@v1\|bymaxone/.github/.github/actions/.*@v1"` — expected: no output
- Open a draft pull request — expected: `CI passed` is green

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-00-scaffold-and-governance.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P0 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 0.5 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 0.6 — Write the repository documents for a library

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 0.3

#### Description

Add the library sections of `AGENTS.md`, and write `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md` and the Copilot instruction files.

#### Acceptance criteria

- [ ] `AGENTS.md` no longer says the repository is at the specification stage, and has the sections: design principles, security specification, testing strategy, packaging invariants, pitfalls.
- [ ] Below the shared block of §3, `AGENTS.md` states the language policy for `docs/` (English) and the rules specific to this repository.
- [ ] The shared block between `<!-- shared:begin -->` and its closing marker is byte-identical to what it was.
- [ ] `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.github/copilot-instructions.md`, `.github/instructions/code.instructions.md` and `.github/instructions/tests.instructions.md` exist and name no telemetry concept.
- [ ] `README.md` states the stage truthfully: scaffolded, no behaviour, not published.

#### Files to create / modify

- ✎ `AGENTS.md`
- ✚ `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`
- ✚ `.github/copilot-instructions.md`, `.github/instructions/code.instructions.md`, `.github/instructions/tests.instructions.md`, `.github/agents/agent-code-reviewer.agent.md`
- ✎ `README.md`, `docs/README.md`

#### Agent prompt (EN)

````
You are a senior technical writer and maintainer engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P0 (scaffold-and-governance) — Task 0.6 of 7 (MIDDLE of this phase)

PRECONDITIONS
- Tasks 0.1 to 0.3 are ✅ Done, so every command and path the documents name exists.
- The scaffold to mirror is the public repository `bymaxone/nest-telemetry` at its current `main`. Read its files with `gh api repos/bymaxone/nest-telemetry/contents/<path>` or a shallow clone outside this repository.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` (whole document)
- `docs/plan.md` § "Global conventions" and § "Target layout"
- `bymaxone/nest-telemetry`: `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `.github/copilot-instructions.md`, `.github/instructions/*.md`, `.github/agents/agent-code-reviewer.agent.md`, for structure only

TASK
Write this repository's own contributor and agent documents, using the sibling's structure and this library's content.

DELIVERABLES

1. `AGENTS.md`: replace §1 and the stage line with the library's map (directories, subpaths, commands), keep §2, keep §3's shared block untouched, and add after it: the `docs/` language policy; design principles (access from the source flag, webhook as trigger, ports, zero dependencies, no environment reads); security specification (SEC01 to SEC10, each with where it is enforced once built); testing strategy (three coverage scopes, mutation at 100, no sockets in unit tests, table-driven mappings); packaging invariants (dual format, per-condition types, the internal bundle and why); pitfalls.

2. `CLAUDE.md`: a short pointer document that imports or references `AGENTS.md` rather than repeating it.

3. `CONTRIBUTING.md`: setup, the gate commands, the pull request and commit rules, the release rule (owner instruction only).

4. `CHANGELOG.md`: the header and an "Unreleased" section. No version entry.

5. The Copilot instruction files and the reviewer agent file, with this library's rules.

6. `README.md` and `docs/README.md`: update the stage statement and the list of documents.

Constraints:
- Never edit the text between the `shared` markers in `AGENTS.md`: the `agents-sync` workflow replaces it wholesale.
- A security control is described as present only if the repository runs it now; a control that arrives in a later phase is described as a requirement, with its identifier.
- English everywhere. No attribution to an AI tool in any file, commit or pull request.
- A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written, and the source is cited.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `git diff main -- AGENTS.md | grep "^[+-]" | grep -c "shared:"` — expected: 0
- The CI job that checks required documents and relative links — expected: passes
- `grep -rni "opentelemetry\|otel\|span" AGENTS.md CLAUDE.md CONTRIBUTING.md .github/*.md .github/instructions` — expected: no output

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-00-scaffold-and-governance.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P0 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 0.6 ✅ YYYY-MM-DD — <one-line summary>`
````

---

### Task 0.7 — Require the status checks and close the phase

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 0.5, 0.6

#### Description

Add the required status checks to the repository ruleset, verify the whole phase against its Definition of Done, and record the evidence in the pull request.

#### Acceptance criteria

- [ ] The repository ruleset for `main` requires `CI passed`, read back from the GitHub API.
- [ ] Every Definition of Done item of P0 in `docs/plan.md` has its evidence (a command and its result) in the pull request body.
- [ ] The packed tarball loads each of the five subpaths in ESM and CommonJS on Node.js 26.

#### Files to create / modify

- — no file in the diff for the ruleset: it is a setting on GitHub
- ✎ `docs/plan.md` — P0 status, through the Completion Protocol

#### Agent prompt (EN)

````
You are a senior repository maintainer engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P0 (scaffold-and-governance) — Task 0.7 of 7 (LAST of this phase)

PRECONDITIONS
- Tasks 0.1 to 0.6 are ✅ Done and the phase's pull request is open with `CI passed` green.
- The person running this has admin rights on `bymaxone/nest-subscription`, or hands the ruleset step to the owner.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/plan.md` § "P0 — scaffold-and-governance", Definition of Done
- `docs/spec.md` §11

TASK
Make `CI passed` a required check on `main`, then prove each Definition of Done item of the phase and write the proof into the pull request.

DELIVERABLES

1. The ruleset change, made through the GitHub API or the settings page after confirming with the owner, and read back with `gh api repos/bymaxone/nest-subscription/rulesets` and the ruleset's own endpoint. The organisation-level `require-ci-passed` ruleset gets this repository added if that is how the siblings are covered; check `bymaxone/nest-telemetry` first.

2. A "Definition of Done" section in the pull request body: one line per item of the roadmap's P0 list, each with the command run and what it returned.

3. A list for the owner of what remains outside the repository: the `npm-publish` environment, npm trusted publishing (possible only after the first manual publish), and any secret the workflows expect.

Constraints:
- Changing a ruleset is outward-facing: confirm with the owner before making it, and never weaken an existing rule.
- English everywhere. No attribution to an AI tool in any file, commit or pull request.
- A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written, and the source is cited.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `gh api repos/bymaxone/nest-subscription/rules/branches/main --jq '.[] | select(.type=="required_status_checks")'` — expected: lists `CI passed`
- `pnpm build && pnpm check:runtime` on Node.js 26 — expected: all five subpaths load in both formats

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-00-scaffold-and-governance.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/7 tasks`)
5. Update the P0 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/7`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 0.7 ✅ YYYY-MM-DD — <one-line summary>`
````

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 0.1 ✅ 2026-11-24 — package manifest, the six empty entry points, TypeScript, lint, format and tsup configuration; build emits ESM, CJS and both declaration formats for every entry
- 0.2 ✅ 2026-11-24 — Jest unit, end-to-end and combined configs, no-socket gate with a runtime spec, Stryker at 100; the empty package has no mutants, so the run completes with no score
<!-- entries are added as tasks complete -->
