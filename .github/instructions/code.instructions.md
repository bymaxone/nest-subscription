---
applyTo: 'src/**/*.ts'
---

# TypeScript source code standards

## TypeScript compiler flags — practical implications

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`. Review impact:

- **`noUncheckedIndexedAccess`**: `array[0]` is `T | undefined`. Every index access must be guarded.
- **`exactOptionalPropertyTypes`**: `{ prop?: string }` ≠ `{ prop: string | undefined }`. Flag conflation.
- **`noImplicitOverride`**: a member that overrides a parent must say `override`.
- **`noImplicitReturns`**: every code path must return.

## ESLint rules enforced as errors

- `no-explicit-any` — no `any` in source.
- `no-non-null-assertion` — never `!`. Narrow the type instead.
- `consistent-type-imports` — type-only imports use `import type { ... }`.
- `explicit-function-return-type` and `explicit-module-boundary-types`.
- `import/no-cycle` — circular imports are forbidden.
- `max-lines-per-function` — a function is at most 50 lines; inline configuration is off for source files.

## Layers and entry points

- `src/shared/` imports nothing and needs no NestJS package.
- `src/core/` never imports an adapter. The host imports an adapter's factory from its subpath and passes it in the module options.
- An entry point reaches `src/internal/` by package specifier (`@bymax-one/nest-subscription/internal`), never by relative path: a relative import copies the class into each bundle, and a copied class is a second injection token.
- The library reads no environment variable. Time comes from the injected `Clock`.

## NestJS patterns

- DI only — no `new ServiceClass()` outside tests.
- **Injection tokens use `Symbol()`**, never string literals, and every provider carries an explicit `@Inject(TOKEN)` because tsup drops decorator metadata.
- Lifecycle hooks carry `override` where they override a parent.

## Import ordering

`node:*` → external → internal (`@bymax-one/nest-subscription`) → parent/sibling → index. Alphabetical within each group (enforced by `import/order`).

## Security

- Access is read from the source's `givesAccess` flag. Flag any code that decides access from a status name.
- A webhook payload, or anything parsed from it, never writes a snapshot.
- Never put a token, secret or credential in an enumerable property, a log line or an error message. Compare secrets and digests with `crypto.timingSafeEqual`, never `===`.
- A key built from more than one field encodes each field so no content moves the boundary between them.

An equivalent mutant is suppressed on its own line with `// Stryker disable next-line <Mutator>: <reason>`, and the reason goes after the colon on that one line. `pnpm check:mutants` enforces the grammar. Prefer a test that kills the mutant; add a directive only when no test can.
