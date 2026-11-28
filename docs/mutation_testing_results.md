# Mutation Testing Results

Full, non-incremental mutation run of `@bymax-one/nest-subscription` over every file of `src/`, made on
the source of `1.0.1` (commit `a7c411a`) in a fresh worktree. It was started with `pnpm mutation:full`, which deletes the incremental file first, so
no result of an earlier run is reused.

## Run metadata

| Field             | Value                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- |
| Date              | 2026-11-28                                                                         |
| Command           | `pnpm mutation:full --concurrency 2`                                               |
| Runner            | Stryker `@stryker-mutator/core` 9 with the Jest runner and the TypeScript checker  |
| Coverage analysis | `perTest`                                                                          |
| Concurrency       | 2 workers; the run took about 42 minutes, on a machine that was running other work |
| Tests run         | the unit suite, 2413 tests, 38.04 tests per mutant on average                      |
| Thresholds        | high 100, low 100, **break 100**                                                   |
| Result            | **PASS**: the final score is 100.00 and the process exited with 0                  |

## Overall score

**100.00%**: 2291 killed and 15 timed out (both count as detected) of 2306 mutants that were run, 0 survived, 0 had no coverage.

| Status                                             |  Mutants |
| -------------------------------------------------- | -------: |
| Killed                                             |     2291 |
| Timed out (a mutant that hangs a test is detected) |       15 |
| Survived                                           |        0 |
| No coverage                                        |        0 |
| Did not compile or failed at start (not run)       |     2034 |
| Ignored (static mutants, and type-only code)       |      482 |
| **Generated in all**                               | **4822** |

The mutants that did not compile are the ones the TypeScript checker rejects (a mutation that breaks a type is not a behaviour change a test could see) and a few that fail on load; they are not counted in the score, as Stryker does not count them. The split between killed and timed out moves between runs with machine timing; the score does not.

## No mutant is ignored by a comment

There is no `// Stryker disable` directive in `src/`, so no mutant was excused by a reason. `pnpm check:mutants` passes: every directive that exists parses and carries its reason, and none exists. Nothing in `stryker.config.json` (thresholds, `mutate` globs, `ignoreStatic`) was changed for this run.

## Score by area

The same numbers by directory, from the run's JSON report. A directory is 100.00% when no mutant of it survived or lacked coverage.

| Area                      | Score   | Killed | Timeout | Survived | No coverage |
| ------------------------- | ------- | -----: | ------: | -------: | ----------: |
| `src/core`                | 100.00% |    190 |       0 |        0 |           0 |
| `src/core/cache`          | 100.00% |     55 |       0 |        0 |           0 |
| `src/core/guard`          | 100.00% |     73 |       0 |        0 |           0 |
| `src/core/logging`        | 100.00% |     20 |       0 |        0 |           0 |
| `src/core/management`     | 100.00% |    106 |       0 |        0 |           0 |
| `src/core/notifications`  | 100.00% |    193 |       0 |        0 |           0 |
| `src/core/observer`       | 100.00% |     20 |       0 |        0 |           0 |
| `src/core/options`        | 100.00% |    122 |       0 |        0 |           0 |
| `src/core/reconciliation` | 100.00% |     89 |      10 |        0 |           0 |
| `src/core/refresh`        | 100.00% |     28 |       0 |        0 |           0 |
| `src/core/webhook`        | 100.00% |    100 |       2 |        0 |           0 |
| `src/internal`            | 100.00% |     44 |       0 |        0 |           0 |
| `src/revenuecat`          | 100.00% |    651 |       1 |        0 |           0 |
| `src/shared`              | 100.00% |     77 |       1 |        0 |           0 |
| `src/testing`             | 100.00% |    523 |       1 |        0 |           0 |

## Reproducing it

```bash
pnpm install --frozen-lockfile
pnpm mutation:full
```

The run needs no network and no database. The incremental `pnpm mutation` that CI runs on each push reuses `reports/stryker-incremental.json`; a full run is what proves the number after a change that touches many files.
