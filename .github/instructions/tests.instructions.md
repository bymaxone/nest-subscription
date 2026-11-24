---
applyTo: '**/*.spec.ts,**/*.e2e-spec.ts'
---

# Testing standards

## Coverage gate

`pnpm test:cov:all` enforces **100% statements, branches, functions, and lines** over the unit and e2e suites together, and `pnpm test:cov` and `pnpm test:e2e` hold each suite alone to the same 100. `passWithNoTests` is off. Any PR that drops coverage on a touched source file must not be approved.

## Mutation testing threshold

Break gate: **100%** (`thresholds.break: 100`). A mutant no test can kill carries a `// Stryker disable next-line <Mutator>: <reason>` on its line, validated by `pnpm check:mutants`. Flag tests that use generic matchers (`toBeDefined()`, `toBeTruthy()`) where a value assertion is possible — they survive mutants.

A closed `as const` table is evaluated at module load, which Stryker does not mutate. `scripts/mutate-const-tables.mjs` removes one entry at a time and expects a test to fail, so a table needs a test that pins each member.

## Test structure

Every `it()` carries a comment stating the scenario it covers, and a title that states only what its assertions establish. Avoid `it('works')`. Every spec opens with a header naming its purpose and layer.

## Unit and e2e split

A unit spec (`src/**/*.spec.ts`) opens no socket and starts no server; `pnpm check:socket-gate` enforces both. A case that needs a local stand-in for a provider or a real NestJS application belongs in `test/e2e/` (`*.e2e-spec.ts`).

## Time and provider data

Time comes from the injected `Clock`; no test waits on a real timer. Recorded provider payloads sit under `test/fixtures/<source>/` with every identifier and secret replaced. A mapping from a provider value is table-driven, one row per value.

## Scope: public API only

Test through exported interfaces. Never reach private members or unexported internals; if behaviour is only verifiable through one, the design needs refactoring.

## Mutation-aware assertions

1. Assert the value, not existence: `expect(result.status).toBe('active')`, not `toBeDefined()`.
2. Test both sides of every `||` / `&&`: a test with only one operand true kills the `&&` → `||` mutant.
3. Assert each field and each message independently.

## Secrets

A class that owns a secret is tested against `JSON.stringify`, spread, `util.inspect` and `util.inspect` with `showHidden`. Restore mocks in `afterEach` so nothing bleeds across files.
