# Phase 2 — Module and options

> **Status**: 📋 ToDo &nbsp;·&nbsp; **Progress**: 0 / 5 tasks &nbsp;·&nbsp; **Last updated**: 2026-11-24
> **Source roadmap**: [`docs/plan.md`](../plan.md) § P2 — module-and-options
> **Source spec**: [`docs/spec.md`](../spec.md)

---

## Context

At the start the library has its model, its two ports and its test doubles, and nothing a NestJS application can import as a module.

At the end a host configures the library once, with `SubscriptionModule.forRoot` or `forRootAsync`, and a wrong configuration stops the boot with one message that names every offending option and none of their values. The resolved options hold credentials and webhook secrets so that no serialization, spread or inspection exposes them. The module provides the source, the store, the clock and the optional cache and observer under their tokens. What those options drive (reads, guard, webhooks) arrives in later phases; this phase validates and wires them.

---

## Rules-of-phase

1. The library reads no environment variable. What "production" means is a value the host passes in.
2. Secret containment is applied at the one place the resolved options object is built, and never by redefining a property on an object the host owns.
3. An absent optional peer (`@bymax-one/nest-cache`, `@bymax-one/nest-core`) is a supported configuration with its own test, not an error path.
4. `src/core/` never imports an adapter: the host passes a `SubscriptionSource` built by the adapter's factory, which is how an unused adapter loads no code (NFR05).
5. A validation message names options and never values.

---

## Reference docs

- `docs/spec.md` §6.2 (package), §6.3 (module), §8 (family rules), §8.2 (SEC05, SEC07, SEC09), §10.1 (D07, D10, D12)
- `docs/plan.md` § "P2 — module-and-options"
- `bymaxone/nest-auth`: its module options and `forRootAsync`, the sibling precedent the specification names
- [`docs/tasks/README.md`](README.md): the names, paths and commands shared by every task file
- `AGENTS.md`: repository rules and code review rules
- `/bymax-workflow:standards` skill: universal coding rules

---

## Task index

| ID  | Task                                               | Status  | Priority | Size | Depends on |
| --- | -------------------------------------------------- | ------- | -------- | ---- | ---------- |
| 2.1 | Define the module options and their defaults       | 📋 ToDo | P0       | M    | —          |
| 2.2 | Validate the options into one aggregated error     | 📋 ToDo | P0       | M    | 2.1        |
| 2.3 | Contain the secrets in the resolved options        | 📋 ToDo | P0       | M    | 2.1        |
| 2.4 | Implement the module with forRoot and forRootAsync | 📋 ToDo | P0       | L    | 2.2, 2.3   |
| 2.5 | Prove that an unused adapter loads no code         | 📋 ToDo | P0       | S    | 2.4        |

---

## Tasks

### Task 2.1 — Define the module options and their defaults

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Write the option types the host fills in, the resolved form the library uses internally, and the defaults the specification fixes (§6.3, D10, D12).

#### Acceptance criteria

- [ ] `SubscriptionModuleOptions` covers: the source, the store, the account resolver, the change hook, the fail policy with its tolerance, the maximum snapshot age, the sandbox switch with its production confirmation, the production flag, the optional cache, the optional observer, the event retention, the webhook controller switch and path, and the multi-tenant flag.
- [ ] `resolveOptions` applies the defaults: fail policy `refuse`, last-known-state tolerance 24 hours, maximum age 24 hours, sandbox access off, webhook controller off.
- [ ] Durations are plain numbers of milliseconds with the unit in the option name.
- [ ] A test pins every default against the specification.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/options/subscription-options.types.ts`
- ✚ `src/core/options/defaults.ts`
- ✚ `src/core/options/resolve-options.ts`, `src/core/options/resolve-options.spec.ts`
- ✎ `src/core/index.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P2 (module-and-options) — Task 2.1 of 5 (FIRST of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model and `SubscriptionError` in `src/shared/`, the ports, tokens, `Clock` and `encodeAccountKey` in `src/internal/`, and `InMemorySubscriptionStore` and `FakeSubscriptionSource` in `src/testing/` exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §3.9 (FR23, FR25), §3.10 (FR29, FR31), §3.11 (FR32, FR34), §6.3, §8.2 (SEC04, SEC07), §10.1 (D10, D12)
- `docs/plan.md` § "P2 — module-and-options"

TASK
Define the host-facing option types and `resolveOptions`, which turns them into the frozen form the library reads.

DELIVERABLES

1. `subscription-options.types.ts`: `SubscriptionModuleOptions`, `SubscriptionModuleAsyncOptions` (`imports`, `inject`, `useFactory`) and `ResolvedSubscriptionOptions`. The source option is a `SubscriptionSource` instance (what an adapter factory returns), and the store option is a `SubscriptionStore` instance or an injection token for one.

2. `defaults.ts`: named constants for every default, each with a doc comment citing the decision it comes from.

3. `resolve-options.ts`: `resolveOptions(input)` returning a deeply frozen `ResolvedSubscriptionOptions` built from a copy of the input. It does not validate (task 2.2) and does not hide secrets (task 2.3).

Constraints:
- Copy the host's object before touching it; never freeze or redefine a property on it.
- No option reads `process.env`. The host passes `isProduction`.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/options` — expected: pass at 100%
- `pnpm typecheck` — expected: 0 errors

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-02-module-and-options.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P2 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 2.1 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 2.2 — Validate the options into one aggregated error

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.1

#### Description

Refuse an invalid configuration at boot with a single error that lists every offending option by name and contains no value (§6.3, SEC07).

#### Acceptance criteria

- [ ] Several invalid options at once produce one `SubscriptionError` with the configuration code, whose message lists every offending option name.
- [ ] For each rule, a test supplies a recognisable sentinel value and asserts the sentinel is absent from the message, the cause and the serialized error.
- [ ] Enabling sandbox access with `isProduction` true and without the confirming option is refused; with the confirming option it is accepted.
- [ ] A last-known-state fail policy without a positive tolerance, a negative duration, a missing source, a missing store and a missing account resolver are each refused.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/options/validate-options.ts`, `src/core/options/validate-options.spec.ts`
- ✎ `src/core/options/resolve-options.ts` — call the validator before returning

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P2 (module-and-options) — Task 2.2 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model and `SubscriptionError` in `src/shared/`, the ports, tokens, `Clock` and `encodeAccountKey` in `src/internal/`, and `InMemorySubscriptionStore` and `FakeSubscriptionSource` in `src/testing/` exist.
- Task 2.1 is ✅ Done: the option types, defaults and `resolveOptions` exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §6.3, §6.4, §8.2 (SEC04, SEC05, SEC07)
- `src/core/options/subscription-options.types.ts`

TASK
Implement `validateOptions`, which collects every problem before throwing once.

DELIVERABLES

1. `validate-options.ts`: a list of small rule functions, each returning an option path or nothing, and `validateOptions` that runs them all and throws one `SubscriptionError` naming the collected paths in a stable order.

2. A table-driven spec: one row per rule with a valid and an invalid input, plus the multi-error case and the sentinel-leak assertions.

Constraints:
- The message is built from option paths only. Never interpolate a supplied value, even a non-secret one.
- A source that is not an object with the port's methods is refused by shape, without calling it.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core/options` — expected: pass at 100%
- `pnpm mutation --mutate "src/core/options/validate-options.ts"` — expected: score 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-02-module-and-options.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P2 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 2.2 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 2.3 — Contain the secrets in the resolved options

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.1

#### Description

Make sure no credential or webhook secret can leave through serialization, spread or inspection of a library object (SEC05, AC09 for library objects).

#### Acceptance criteria

- [ ] A helper wraps a secret so that it is read only through an explicit method, and `JSON.stringify`, object spread, `util.inspect` and `util.inspect` with `showHidden: true` all show nothing of it.
- [ ] The same paths applied to `ResolvedSubscriptionOptions` expose no secret.
- [ ] A deliberate read still returns the secret, and a wrapper supports two valid values at once for rotation (SEC09).
- [ ] The wrapper's `toJSON` and custom inspect output show a fixed placeholder, so the object does not look broken.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/internal/secret.ts`, `src/internal/secret.spec.ts`
- ✎ `src/internal/index.ts`
- ✎ `src/core/options/resolve-options.ts`, `src/core/options/resolve-options.spec.ts`
- ✚ `test/e2e/secret-containment.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P2 (module-and-options) — Task 2.3 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model and `SubscriptionError` in `src/shared/`, the ports, tokens, `Clock` and `encodeAccountKey` in `src/internal/`, and `InMemorySubscriptionStore` and `FakeSubscriptionSource` in `src/testing/` exist.
- Task 2.1 is ✅ Done.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §8.2 (SEC05, SEC09), §5.1 (AC09)
- `docs/tasks/README.md` §8 (the secret rule and the four paths)

TASK
Implement a `Secret` holder in `src/internal/` and use it for every secret the resolved options and the adapters will hold.

DELIVERABLES

1. `secret.ts`: a class holding its values in a `#private` field, with `reveal()` returning the current value, `candidates()` returning every valid value for verification during rotation, a `toJSON` and a `util.inspect.custom` method that return a placeholder. Exported from the internal bundle and from the root, so adapters and hosts share one class.

2. In `resolve-options.ts`: any secret-bearing option exposed through a non-enumerable getter on the resolved object.

3. `test/e2e/secret-containment.e2e-spec.ts`: boots a module with sentinel secrets and applies the four paths to the resolved options and to every provider the module exports. Later phases add their providers to this test.

Constraints:
- Never rely on TypeScript `private`: it is erased at run time and the property stays enumerable.
- Never redefine a property on an object the host passed in.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/internal/secret.spec.ts src/core/options` — expected: pass
- `pnpm test:e2e -t "secret containment"` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-02-module-and-options.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P2 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 2.3 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 2.4 — Implement the module with forRoot and forRootAsync

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 2.2, 2.3

#### Description

Write `SubscriptionModule`, which validates the options at boot and provides the source, the store, the clock, the cache and the observer under their tokens.

#### Acceptance criteria

- [ ] A NestJS application boots with `FakeSubscriptionSource` and `InMemorySubscriptionStore` through `forRoot` and through `forRootAsync` with an injected factory.
- [ ] An invalid configuration fails the boot with the aggregated error, in both forms.
- [ ] The module provides `SUBSCRIPTION_OPTIONS`, `SUBSCRIPTION_SOURCE`, `SUBSCRIPTION_STORE` and `SUBSCRIPTION_CLOCK`, and `SUBSCRIPTION_CACHE` and `SUBSCRIPTION_OBSERVER` only when configured.
- [ ] With `@bymax-one/nest-cache` and `@bymax-one/nest-core` absent from the module graph, the application boots and every test of the phase passes.
- [ ] Every provider uses explicit `@Inject` with a symbol token.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✚ `src/core/subscription.module.ts`, `src/core/subscription.module.spec.ts`
- ✚ `src/core/system-clock.ts`
- ✎ `src/core/index.ts`
- ✚ `test/e2e/module-boot.e2e-spec.ts`
- ✎ `test/e2e/secret-containment.e2e-spec.ts`

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P2 (module-and-options) — Task 2.4 of 5 (MIDDLE of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model and `SubscriptionError` in `src/shared/`, the ports, tokens, `Clock` and `encodeAccountKey` in `src/internal/`, and `InMemorySubscriptionStore` and `FakeSubscriptionSource` in `src/testing/` exist.
- Tasks 2.1 to 2.3 are ✅ Done: `resolveOptions`, `validateOptions` and `Secret` exist.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §6.2, §6.3, §8 (family rules)
- `bymaxone/nest-auth`: the file that defines its module and `forRootAsync` (read with `gh api`), for the provider pattern only

TASK
Implement `SubscriptionModule.forRoot` and `forRootAsync` in `src/core/`.

DELIVERABLES

1. `subscription.module.ts`: a dynamic module whose options provider runs `resolveOptions` once; providers for the tokens derived from it; `global` left to the host through an option.

2. `system-clock.ts`: the default `Clock`, replaceable through the options for tests.

3. The optional cache accepted as an object with `get`, `set` and `delete`, typed in this library, so `@bymax-one/nest-cache` is never imported at run time.

4. `test/e2e/module-boot.e2e-spec.ts`: boot in both forms, the failed boot, and the absent-optional-peer configuration.

Constraints:
- No dynamic `require` of an optional peer at module load. An integration is something the host passes in.
- Do not register services of later phases here; each phase adds its own providers to the module.
- Test first: write the failing test, watch it fail, then implement. Every requirement this task cites gets a test that fails without the implementation.
- TypeScript strict, no `any`. No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`, Stryker disable without a recorded reason).
- Every new source file opens with a header stating its purpose and layer; every export has a doc comment. Functions stay within 50 lines, files within 800.
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies. Do not add a package to `dependencies`; a new dev or peer dependency needs a stated reason in the pull request.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm test src/core && pnpm test:e2e -t "module boot"` — expected: pass
- `pnpm build && pnpm check:exports && pnpm check:runtime` — expected: pass

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-02-module-and-options.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P2 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 2.4 ✅ YYYY-MM-DD — <one-line summary>`
```

---

### Task 2.5 — Prove that an unused adapter loads no code

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 2.4

#### Description

Add the packaging proof for NFR05 and close the phase: with one adapter configured, the other adapter's module is absent from the loaded module graph.

#### Acceptance criteria

- [ ] A script loads the root and one adapter subpath from the packed tarball and asserts that no file of the other adapter's bundle was loaded, in ESM and in CommonJS.
- [ ] Loading the root alone loads neither adapter.
- [ ] A lint rule or a test fails when a file under `src/core/` imports from `src/revenuecat/` or `src/finance/`.
- [ ] Every Definition of Done item of P2 in `docs/plan.md` has a named test.
- [ ] All gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:cov:all`, `pnpm build`.

#### Files to create / modify

- ✎ `scripts/check-consumer-runtime.mjs` — add the adapter isolation cases
- ✎ `eslint.config.mjs` — restrict imports per directory, following `docs/tasks/README.md` §5
- ✚ `src/core/import-boundaries.spec.ts` (only if the lint rule cannot express it)

#### Agent prompt (EN)

```
You are a senior TypeScript and NestJS library engineer working on the @bymax-one/nest-subscription project.

PROJECT: @bymax-one/nest-subscription — a public npm library for NestJS that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter, and exposes it through a service, a guard and typed change notifications.
TypeScript (strict), NestJS 11, Node.js 26+, pnpm, Jest, Stryker, tsup (ESM + CommonJS). Zero direct dependencies.

CURRENT PHASE: P2 (module-and-options) — Task 2.5 of 5 (LAST of this phase)

PRECONDITIONS
- P1 is ✅ Done: the model and `SubscriptionError` in `src/shared/`, the ports, tokens, `Clock` and `encodeAccountKey` in `src/internal/`, and `InMemorySubscriptionStore` and `FakeSubscriptionSource` in `src/testing/` exist.
- Task 2.4 is ✅ Done: the module boots from the built package.

REQUIRED READING (only these — do not load more):
- `AGENTS.md` (whole file: repository rules and code review rules)
- `docs/tasks/README.md` (shared names, paths, commands and the Definition of Done every task meets)
- `docs/spec.md` §8.1 (NFR05), §6.2
- `docs/tasks/README.md` §5
- `scripts/check-consumer-runtime.mjs`

TASK
Prove NFR05 on the packed tarball and enforce the import boundaries that make it true.

DELIVERABLES

1. Runtime check cases that inspect the loaded module list (`require.cache` in CommonJS, a loader hook or `process.report` in ESM) after importing the root and one adapter.

2. Import boundaries enforced by ESLint for every directory of the layout table.

3. In the pull request body: the Definition of Done of P2, one line per item with its test.

Constraints:
- The adapters are still empty entry points; the proof must already hold and keep holding when P7 and P11 fill them.
- Read each file of the sibling repository before copying it, and keep only what serves any `@bymax-one` library.
- No gate, threshold, ignore list or baseline is weakened to make an empty package pass.
- No suppression of any kind (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `istanbul ignore`).
- English everywhere. Comments state constraints that still hold, never a phase, a task or a review round. No attribution to an AI tool in any file, commit or pull request.
- Zero direct dependencies: `dependencies` stays empty.
- Use the names and paths fixed in `docs/tasks/README.md`. If one has to change, change it there in the same pull request.
- Do not commit, push, publish or tag unless the person running this prompt asks for it.

Verification:
- `pnpm build && pnpm check:runtime` — expected: the isolation cases pass in both formats
- `pnpm lint` — expected: a temporary cross-directory import fails the lint, then is removed
- `pnpm test:cov:all && pnpm mutation` — expected: 100 and 100

Completion Protocol (after the work is reported done):
1. Update this task's status emoji to ✅ Done in `docs/tasks/phase-02-module-and-options.md`
2. Tick its acceptance-criteria checkboxes
3. Update its row in the task index table (status column)
4. Increment the phase progress counter at the top of that file (`N/5 tasks`)
5. Update the P2 row in the phase dashboard of `docs/plan.md` and its mirror row in the phase index of `docs/tasks/README.md` (status, progress `N/5`, last updated), and the tasks-done counter there
6. Recompute the overall progress line in `docs/plan.md` when the phase itself changes status
7. Append a completion log entry at the bottom of that file: `- 2.5 ✅ YYYY-MM-DD — <one-line summary>`
```

---

## Completion log

> Append-only. One line per task completion. Format: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

<!-- entries are added as tasks complete -->
