# @bymax-one/nest-subscription — Agent Quick Reference

> **Type:** npm public library (not an application) · **Runtime:** Node.js 26+, NestJS 11 · **Dependencies:** zero direct

This file points; it does not repeat. The rules are in [AGENTS.md](./AGENTS.md) (design principles, security specification, testing strategy, packaging invariants, pitfalls, code review rules), the product is in [docs/spec.md](./docs/spec.md), and the order of work is in [docs/plan.md](./docs/plan.md) and [docs/tasks/](./docs/tasks/README.md).

## Before any task

1. Read the task's required reading in its phase file, and `docs/tasks/README.md` for the names, paths and commands that are fixed.
2. Everything that reaches the repository or GitHub is English, with no attribution to an AI tool or model anywhere.
3. A statement that can be checked (a version, an endpoint, a field name, a provider behaviour) is checked at its source before it is written.

## Verification before completing a task

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:cov:all && pnpm build
```

Before a pull request is opened for a phase: `pnpm mutation`, `pnpm check:exports`, `pnpm check:runtime`, `pnpm check:api`, `pnpm check:docs`, `pnpm check:published` and `pnpm size`.

## Release

The first publish and every version bump need the maintainer's explicit instruction naming the number. Never infer a bump from an event, never tag, never publish. `README.md` and `CHANGELOG.md` ship in the package; a change a user would notice is recorded under the changelog's `Unreleased` section.
