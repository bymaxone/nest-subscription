# nest-subscription: repository orientation

This folder holds the working documentation of the repository: the specification, the roadmap and the phase task files. The root `README.md` is the public document of the package.

- Everything here is written in English.
- [`spec.md`](spec.md) is the specification the library is built from.
- [`plan.md`](plan.md) is the roadmap: the phases the specification is built in, and their status.
- [`tasks/`](tasks/README.md) holds one task file per phase, and the names, paths and commands they share.
- [`raw-body.md`](raw-body.md) shows how to keep the raw request body for the webhook route in NestJS, on Express and on Fastify, and what the library does without it.
- [`reference-store.md`](reference-store.md) is a reference implementation of the store port over PostgreSQL, with the guarantees each statement provides.
- [`acceptance.md`](acceptance.md) maps every acceptance criterion of the specification to the named test that proves it, and lists what the Finance phase still owns.
- [`mutation_testing_results.md`](mutation_testing_results.md) records the full mutation run of the first release.
- [`revenuecat-facts.md`](revenuecat-facts.md) holds the RevenueCat facts the adapter is built on, each with its page and the date it was read.
- Normative rules for contributors and agents live in [`../AGENTS.md`](../AGENTS.md), with the short entry points in [`../CLAUDE.md`](../CLAUDE.md) and [`../CONTRIBUTING.md`](../CONTRIBUTING.md).
- The package's release notes are in [`../CHANGELOG.md`](../CHANGELOG.md); its `Unreleased` section holds what the first release will describe.
- [`AUTOPILOT.md`](AUTOPILOT.md) holds the parameters of the autonomous phase-by-phase execution: preconditions, gates, model policy and merge policy.
