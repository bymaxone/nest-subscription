# nest-subscription — Repository Instructions

`@bymax-one/nest-subscription` is a public npm library for NestJS 11 that keeps one normalized subscription snapshot per account, fed by one billing source through an adapter (RevenueCat, later Bymax Finance), and exposes it through a service, a guard and typed change notifications. Access is granted only from a read of the source, never from a webhook payload. Runtime: Node 24+. Package manager: pnpm.

## Commands

```bash
pnpm install          # install dev dependencies and the Git hooks
pnpm typecheck        # tsc --noEmit over src, the build config and the e2e config
pnpm lint             # ESLint on src, scripts and test, the no-socket gate and the spec header check
pnpm test             # Jest unit tests
pnpm test:e2e         # Jest e2e tests, with coverage held at 100
pnpm test:cov:all     # unit and e2e together — 100% gate (pre-publish enforced)
pnpm mutation         # Stryker mutation tests — break: 100
pnpm build            # clean + tsup → dist/ (ESM + CJS + .d.ts + .d.cts for every subpath)
pnpm size             # brotli bundle-size budget per bundle
pnpm check:runtime    # loads the packed tarball in ESM and CJS under dependency denials
```

## Source layout

```
src/
  shared/      →  exported as "./shared"       (model, value sets, error codes; no runtime dependency)
  internal/    →  exported as "./internal"     (classes and tokens shared by entry points; not for hosts)
  core/        →  exported as "."              (module, service, guard, webhook processor)
  revenuecat/  →  exported as "./revenuecat"   (adapter)
  finance/     →  exported as "./finance"      (adapter)
  testing/     →  exported as "./testing"      (in-memory store, fake source, request builders)
```

## Non-negotiable rules

1. **`package.json → "dependencies"` must remain empty.** NestJS packages are peers; every other peer is optional.
2. **Access comes from the source's flag**, never from a status name. A webhook payload never writes state; it only triggers a read of the source.
3. **A secret never sits in an enumerable property**, an error message, a log line or an observer payload.
4. **Tenant and account go through one key encoder**, never through hand-built string concatenation.
5. **`core` never imports an adapter**, and an entry point reaches `internal` by package specifier, never by relative path.
6. **No environment reads.** The library reads no environment variable and no real clock outside the injected `Clock`.
7. **JSDoc on every export**, and a header on every source file naming its purpose and layer.
8. **Conventional Commits.** PR titles and commit messages must comply, in English, with no attribution to an AI tool.
