# Autopilot Config — @bymax-one/nest-subscription

> Per-project parameters for `/bymax-workflow:autopilot`. Reviewed and approved by the operator before the first run. The planning docs own WHAT to build; this file owns HOW the chain runs.

## Identity

- **Project root**: the repository root, resolved with `git rev-parse --show-toplevel`. No absolute path is recorded here because the repository is public.
- **GitHub repo**: `bymaxone/nest-subscription` (visibility: public)
- **Default branch**: `main`
- **Product summary**: a public npm library for NestJS 11 that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter (RevenueCat, later Bymax Finance), and exposes it through a service, a guard and typed change notifications. TypeScript strict, Node.js 26+, pnpm, Jest, Stryker, tsup. The defining constraint: access is granted only from a read of the source, never from a webhook payload, and the package has zero direct dependencies.
- **Specification**: [`docs/spec.md`](spec.md)
- **Roadmap file**: [`docs/plan.md`](plan.md)
- **Tasks index**: [`docs/tasks/README.md`](tasks/README.md)
- **Phases**: 11 phases (P0 to P9 and P11) / 66 tasks (phase files `docs/tasks/phase-NN-*.md`)
- **One phase is one pull request**, branch `feat/pN-<phase-slug>` (`chore/p0-scaffold-and-governance` for P0, `docs/...` is never used by the chain).

## Chain boundary

The chain runs **P0 to P9**. It stops there, and the run is complete when P9 is ✅ Done.

| Phase               | Why the chain does not run it                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| P11 finance-adapter | Deferred by D30: outside the first release until the Bymax Finance public API exists (D03). The chain never attempts it. |

Its absence is not a failure of the run: when P9 is ✅ Done the chain reports completion of its boundary.

## External preconditions

Autopilot never polls an external event. A failed check is reported exactly and the phase is parked.

| Applies to        | Check (exit 0 = OK)                                                                                                                                                    | On failure                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| launch            | `node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 26 ? 0 : 1)"`                                                                                    | STOP — the operator installs Node.js 26 (D09). The gates of every phase run on it                                                                                |
| launch            | `pnpm --version`                                                                                                                                                       | STOP — the operator installs pnpm                                                                                                                                |
| launch            | `gh api repos/bymaxone/nest-telemetry --jq .full_name`                                                                                                                 | STOP — the scaffold source is unreachable                                                                                                                        |
| launch            | `python3 ~/.claude/bymax-review/review_flow.py codex-check`                                                                                                            | STOP — the second reviewer of every phase cannot run; the operator runs `/bymax-quality:codex-setup`                                                             |
| launch            | `git diff --quiet origin/main -- docs/plan.md docs/tasks docs/spec.md docs/AUTOPILOT.md`                                                                               | STOP — the planning documents the chain reads are not on `main` yet                                                                                              |
| phase 0, task 0.7 | the operator's standing confirmation, recorded in the launch message, that the chain may add `CI passed` to the repository ruleset `nest-subscription-pr-and-ci-gates` | The chain finishes P0 without the ruleset change, lists it as owed in the pull request, and marks P0 🟡 Partial. It never changes a ruleset on its own authority |
| phase 7           | `test -n "$REVENUECAT_SANDBOX_API_KEY" && test -n "$REVENUECAT_SANDBOX_PROJECT_ID"`                                                                                    | Mark P7 ⛔ blocked on the RevenueCat sandbox credentials (D18) and park it. P8 and P9 depend on P7, so the chain then stops                                      |
| phase 9           | none beyond launch                                                                                                                                                     | —                                                                                                                                                                |
| phase 11          | the Bymax Finance public API is released                                                                                                                               | Outside the chain boundary; deferred (D30), not attempted                                                                                                        |

The RevenueCat variables live in the orchestrator's environment only. They are never written to a file, a fixture, a commit, a pull request or a log.

## Model policy

`inherit` is the orchestrator's model, the strong tier. A fix sub-agent escalates to `inherit` whenever a phase stalls on review or CI findings.

| Phase | Model   | Rationale                                                                                                                            |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | inherit | Not a mechanical copy: every script and baseline of `nest-telemetry` is triaged, and a gate brought in weakened is the failure mode  |
| 1     | inherit | Defines the model and both ports that every later phase builds on, plus the tenant and account key (SEC08) and the conformance suite |
| 2     | inherit | Security-sensitive: secret containment (SEC05) and the sandbox boot refusal (SEC07)                                                  |
| 3     | sonnet  | Service work on established wiring, fully specified: single flight, ordered writes, staleness, cache, reconciliation                 |
| 4     | inherit | Security-sensitive: the guard, the refusal codes and the fail policy (SEC04)                                                         |
| 5     | sonnet  | A pure comparison of two snapshots and a dispatcher on a decided contract (D17)                                                      |
| 6     | inherit | Security-sensitive: webhook verification order, the single refusal answer, de-duplication (SEC01 to SEC03, D16)                      |
| 7     | inherit | First contact with an external API: invented RevenueCat endpoints and fields are the failure mode                                    |
| 8     | inherit | Changes state at the source and enforces ownership (SEC10); a second contact with the RevenueCat API                                 |
| 9     | inherit | Final hardening: public claims, the whole-package sweep and the full mutation run                                                    |

**Heavy phases** (silent-death watch widened to about 120 minutes): 0 (first install and every gate brought up), 1, 3, 6, 7 and 9. Every phase runs Stryker at a threshold of 100 before its pull request; these are the ones where that run is long.

## Gates

The commands exist from P0 on (they are what P0 delivers). Before P0 is merged the only CI is the documents job.

| Gate (local command)                                                                                    | Active from                                                    |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm typecheck && pnpm lint`                                                                           | phase 0                                                        |
| `pnpm test` (unit suite, 100% coverage, no sockets)                                                     | phase 0                                                        |
| `pnpm test:e2e` (end-to-end suite, 100% coverage on its own)                                            | phase 0                                                        |
| `pnpm test:cov:all` (both suites together, 100%)                                                        | phase 0                                                        |
| `pnpm build && pnpm check:exports && pnpm check:runtime` (packed tarball, ESM and CommonJS)             | phase 0                                                        |
| `pnpm check:api && pnpm size`                                                                           | phase 0                                                        |
| `pnpm check:file-length && pnpm check:function-length && pnpm check:spec-headers && pnpm check:mutants` | phase 0                                                        |
| `pnpm mutation` (Stryker, thresholds 100)                                                               | phase 0, on the files the phase touched                        |
| `pnpm check:docs && pnpm check:published`                                                               | phase 0; meaningful from phase 9, when the README has snippets |
| `pnpm mutation:full`                                                                                    | phase 9                                                        |
| `npm publish --dry-run`                                                                                 | phase 9                                                        |

**Required CI check**: `CI passed`, the aggregate job. Its name is contractual: the ruleset references it by literal name.

**Other checks on every pull request**: `attribution / No AI attribution`, `Socket Security: Pull Request Alerts`, `Socket Security: Project Report`.

**Expected-skip CI checks**: none. The repository is public, so no workflow is gated on visibility.

**One test suite at a time.** The chain never runs two suites or two Stryker runs concurrently.

## Invariant greps

Each command must print nothing. They run in every implementer's phase-wide gate run from the phase named.

```bash
# from phase 1: the library reads no environment variable
grep -rn "process\.env" src/ --include='*.ts'

# from phase 0: no suppression of any kind in source or tests
grep -rnE "eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|istanbul ignore|as unknown as" src/ test/ --include='*.ts'

# from phase 0: no console output from the library
grep -rnE "console\.(log|warn|error|debug|info)" src/ --include='*.ts' --exclude='*.spec.ts'

# from phase 2: the core never imports an adapter (NFR05)
grep -rnE "from .*/(revenuecat|finance)(/|.;?$)" src/core/ --include='*.ts'

# from phase 1: the shared subpath has no import outside itself
grep -rnE "^import .* from .(@|node:|\.\./)" src/shared/ --include='*.ts' --exclude='*.spec.ts'

# from phase 1: the internal bundle is reached by package specifier, never by relative path
grep -rnE "from .(\.\./)+internal" src/core/ src/revenuecat/ src/finance/ src/testing/ --include='*.ts'

# from phase 0: no dependency sneaks into the package
node -e "const d=require('./package.json').dependencies||{};if(Object.keys(d).length){console.log(Object.keys(d).join(' '))}"

# from phase 0: nothing brought from the sibling still names its domain
grep -rniE "opentelemetry|otel" src/ scripts/ test/ .github/workflows/ 2>/dev/null
```

## Security invariants & review focus

The numbered ones are from the specification §8.2. Each is an auditable statement that `/bymax-quality:code-review` and `/security-review` check on every phase that touches the code it names.

- **SEC01.** No code path writes a snapshot from webhook payload content. Access comes only from a read of the source, or from a stored snapshot that came from one.
- **SEC02.** Webhook verification runs over the raw request bytes, before parsing, with a timestamp tolerance and `crypto.timingSafeEqual`. A body is never decoded and re-encoded before it is hashed.
- **SEC03.** Every refused webhook gets one identical answer. Nothing tells the caller which check failed.
- **SEC04.** A missing snapshot, an unreadable store and an unreachable source refuse by default. Trusting a last known state is one explicit option with a bounded tolerance, and no other path grants access under failure.
- **SEC05.** No credential or webhook secret sits in an enumerable property. `JSON.stringify`, spread, `util.inspect` and `util.inspect` with `showHidden` expose none, on the resolved options, on every provider and on every adapter object.
- **SEC06.** No payment data and no raw payload is stored or logged. No account or tenant identifier appears in a log line, an error message or an observer payload, except as a short hash.
- **SEC07.** Sandbox purchases grant nothing by default. Enabling them in production needs a second, separate option or the boot fails. The RevenueCat adapter filters sandbox by itself.
- **SEC08.** Tenant and account are joined only by `encodeAccountKey`, whose construction keeps the boundary between the two fields. The tenant comes from the authenticated request, never from a body.
- **SEC09.** Two valid webhook secrets are accepted at once where the source allows rotation.
- **SEC10.** A management operation finds the subscription inside the authenticated account's own snapshot, through the one ownership check, and never by an identifier taken on trust.
- **Access from the flag.** No function maps a status name to access. The guard reads the entitlement's active flag, which comes from the source's "gives access" flag.
- **Honest results.** A management operation reports the snapshot read back from the source, never the request having succeeded.
- **Provider facts.** Every RevenueCat endpoint, field and value in code traces to `docs/revenuecat-facts.md` and the page it cites.

**Per-phase focus** for the phases the model policy runs on `inherit`:

| Phase | Focus                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | A gate, threshold, ignore glob or baseline weaker than the sibling's. `agents-sync.yml` pinned to a release commit; every third-party action pinned by SHA  |
| 1     | Injectivity of `encodeAccountKey`; the conformance suite failing each broken store; pending changes stored in the same write as the snapshot (D17)          |
| 2     | SEC05 on the four paths; a validation message that contains a supplied value; a property redefined on an object the host owns                               |
| 4     | SEC04 boundary at the tolerance; an error path that allows; an identifier read from a body, query or header by the guard itself                             |
| 6     | SEC01 to SEC03; a verification exception treated as "failed" instead of "refused"; the identifier of a failed event not removed (D16); a timer left pending |
| 7     | SEC02 and SEC07; a field or endpoint not in the facts file; a fixture holding a real identifier or secret; the sandbox credentials reaching any file        |
| 8     | SEC10; a result derived from an HTTP status instead of the read-back                                                                                        |
| 9     | A documented guarantee without its limit; a security control claimed that the repository does not run; a badge with an unmeasured number                    |

## Review bot

- **Reviewer**: `chatgpt-codex-connector[bot]` (Codex). It reviews a pull request automatically when it is opened or marked ready, and is not requested with `--add-reviewer`. After a correction push, a new review is requested with the pull request comment `@codex review`.
- **What counts as its review**: a review or review comments from that bot whose reviewed commit is the current head, or its summary comment reporting that head with no findings.
- **Review-bot timeout**: 15 minutes from the pull request opening or from the latest `@codex review` comment, whichever is later. Past that with no review of the current head, the bot is treated as unresponsive: one factual pull request comment records it, and the gate proceeds on CI and on the dual review the orchestrator completed before the pull request opened. There is no pending review request to remove.
- **Every thread is settled before merge**: verified against the code, answered with what was measured, and resolved. An outdated thread still counts as open. Threads are checked through the GraphQL `reviewThreads` field after each push, immediately before the merge and once after it.

## Merge policy

- **Method**: squash, and the branch is deleted on merge, locally and on the remote.
- **Grace window**: 5 minutes since the last push.
- **Review-bot timeout**: 15 minutes (see Review bot above).
- **Stall limit**: 3 full fix cycles on the same phase without progress → 🟡 or ⛔ with the failing gate named, a notification, STOP.
- **Review budget**: six frozen candidates per phase branch, under `review_flow.py start --autonomous`. A spent budget with a triggered blocker open parks the phase; the chain never extends it on its own authority.
- **Never**: publish to npm, change the `version` field, create a tag, or push to `main` outside a merged pull request. Dashboard commits go through a pull request like any other change, because the organisation ruleset protects `main`.

## Custom conventions

- **Language.** Everything in the repository and on GitHub is English: files, commits, branch names, pull request titles and bodies, review replies.
- **No attribution to an AI tool anywhere.** A commit subject never names a review bot: `fix: address review findings — <summary>`, never the bot's login. The organisation's attribution check reads every commit message of the pull request and rejects it.
- **Shared names.** The names, paths and commands in `docs/tasks/README.md` are fixed. A task that needs a different one changes that file in the same pull request.
- **Never edit the shared block of `AGENTS.md`** (between the `shared` markers): the `agents-sync` workflow replaces it wholesale.
- **Open questions belong to the owner.** A task that finds the specification ambiguous or contradictory adds the question, with a proposal, to `docs/spec.md` §10.2 and parks what depends on it. It never answers on the owner's behalf.
- **Provider facts are re-read at their source** before code relies on them, and the pull request cites the page.
- **Outward actions need the owner.** Changing a ruleset, creating a repository, creating a GitHub environment or a secret are listed for the owner in the pull request and not performed, except where the launch message gives a standing confirmation (see External preconditions, task 0.7).
- **Dashboards.** The status legend is the roadmap's: 📋 ToDo · 🔄 In Progress · 👀 Review · ✅ Done · ⛔ Blocked · 🟡 Partial. The roadmap's update protocol is followed as written, and the phase index in `docs/tasks/README.md` mirrors the roadmap's dashboard.
