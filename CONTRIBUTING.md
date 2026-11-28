# Contributing to @bymax-one/nest-subscription

Thank you for your interest in contributing! This document describes the workflow and quality gates for this library. By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting security issues

**Do not open public issues for security vulnerabilities.** Follow the private reporting process described in [SECURITY.md](./SECURITY.md).

## Prerequisites

- Node.js >= 24
- pnpm 11 (`corepack enable`)

## Getting started

```bash
pnpm install
pnpm build
```

`pnpm install` also installs the Git hooks through the `prepare` script.

## Development workflow

This is a published npm library, not an application. Keep `dependencies` empty: everything ships as a peer dependency or a `node:` builtin. The specification is [docs/spec.md](./docs/spec.md), the order of work is [docs/plan.md](./docs/plan.md), and the rules are in [AGENTS.md](./AGENTS.md).

1. Create a branch from `main`.
2. Write the failing test first, then the code. Specs sit beside their source as `*.spec.ts`; end-to-end specs are `test/e2e/<topic>.e2e-spec.ts`. Coverage at 100% is a hard gate, not a target.
3. Run the verification below before opening a pull request.

## Verification — run before every pull request

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:cov:all && pnpm build
pnpm check:exports && pnpm check:runtime && pnpm check:api && pnpm check:docs && pnpm check:published && pnpm size
pnpm mutation
```

All of the following must pass:

- **Typecheck:** `tsc --noEmit` over the source, the build and the end-to-end projects (strict, zero errors).
- **Lint:** ESLint (no `any`, import order, security rules), the no-socket gate for unit specs and the spec header check.
- **Coverage:** 100% statements, branches, functions and lines, in the unit suite, in the end-to-end suite and in both together.
- **Build:** tsup produces ESM, CommonJS and both declaration formats for every subpath.
- **Packaging:** the packed tarball loads in ESM and CommonJS, resolves under the strict type-resolution profile, and stays within its size budget.
- **Mutation:** the score is 100.

No threshold, ignore list or baseline is loosened to make a gate pass, and no suppression comment is added.

## Commits — Conventional Commits

Commit messages are validated by commitlint through the `commit-msg` hook:

```
<type>(<scope>): <subject>
```

The header and each body line are at most 100 characters; keep the subject to 72. A message that names an AI tool as author or reviewer is rejected. The `pre-commit` hook runs lint-staged (ESLint and Prettier on staged files).

## Pull requests

- Changes reach `main` through a pull request, and the `CI passed` check must be green.
- Keep pull requests focused. Everything written for GitHub is in English.
- Record user-facing changes under the `Unreleased` section of `CHANGELOG.md`.

## Releases

A release is the owner's decision. Nobody bumps `version`, creates a tag or publishes without the owner's explicit instruction naming the version. A tag `vX.Y.Z` on a commit of `main` starts the release workflow, which builds, verifies and packs once, then publishes that exact file from the `npm-publish` environment after a reviewer approves it.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
