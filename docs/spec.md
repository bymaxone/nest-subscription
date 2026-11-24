# Spec — @bymax-one/nest-subscription

> **Status:** ✅ Approved by the owner on 2026-11-24, with one open question (Q01, §10.2)
> **Owner:** Bymax One
> **Version:** 0.3 · **Last update:** 2026-11-24
> **Package:** `@bymax-one/nest-subscription`, a public npm library for NestJS 11
> **Workflow:** `/bymax-workflow:spec` → reviewed specification → `/bymax-workflow:roadmap` (`plan.md`) → `/bymax-workflow:phase-tasks` (`tasks/`)
> **Sibling precedents:** `bymaxone/nest-telemetry` (tooling, gates, packaging, release), `bymaxone/nest-auth` (module options, repositories, hooks, guards, controllers behind switches), `bymaxone/nest-notification` (provider adapters as optional peers)

## Document contract and reading guide

This is the single source of truth for what the library does. It is longer than the three-page default of the spec workflow on purpose: the library is built from this document by people and agents who were not in the conversation that produced it.

It says **what** the library does and **why**. File layout, phases and task breakdown belong to the roadmap and the task files.

**Identifiers.** They are stable and are cited by the roadmap and the task files.

| Prefix | Meaning |
|---|---|
| FR | Functional requirement |
| NFR | Non-functional requirement |
| SEC | Security requirement |
| AC | Acceptance criterion |
| R | Risk |
| D | Decision already taken by the owner, with its date |

**Evidence labels.** *Verified* means read in the provider's official documentation on 2026-11-24; the URL is in §12. *Planned contract* means read in the specification of a platform that is not released yet and can change. *Proposed* means a design recommendation the owner has not confirmed.

**Vocabulary.**

| Term | Meaning in this document |
|---|---|
| Host | The NestJS application that installs the library |
| Account | The host's own user or customer, named by an identifier the host chooses |
| Source | The system that knows the truth about subscriptions: a billing platform |
| Adapter | The code that speaks to one source |
| Origin | Where the person bought: App Store, Google Play, web, or a grant |
| Entitlement | A named access right, such as `premium`, that one or more products grant |
| Snapshot | The library's normalized record of one account's subscription state |

---

## 1. Goal

"My backend has paying users. Some subscribed on an iPhone, some on Android, some on our website. In every route that needs it I want to ask one question, *does this account have `premium`, until when, and where did they buy it*, and get one typed answer. I do not want to learn each billing platform's webhooks, retries, states and edge cases in every product I build, and I want to change billing platform without rewriting my product."

### 1.1 What the library is

A NestJS library that keeps, for each account, a normalized snapshot of its subscription, fed by one source through an adapter, and exposes it through a service, a guard and typed change notifications.

It ships two adapters. A host uses **one** of them:

- **RevenueCat**, for a host whose subscriptions are sold through the app stores, the web, or both, and tracked by RevenueCat.
- **Bymax Finance**, for a host whose subscriptions are sold and tracked by Bymax Finance, with no RevenueCat involved.

The two are independent. Neither requires the other, and the host's code is the same with either (D02).

### 1.2 What the library is not

- It does not charge, hold payment data, or render a purchase screen. Buying happens in the app or on the billing platform's page.
- It is not a billing platform, a product catalogue or a pricing engine.
- It does not decide what a subscription is worth in a product. Benefits, limits and prices are the host's.

---

## 2. Background

- Several Bymax products need the same thing: a backend that knows whether an account is subscribed. Without a library each one writes its own webhook receiver, signature check, retry handling, state mapping, cache and guard. That is the cross-cutting code the backend template must not hold.
- The mistakes in this area are expensive and silent: a forged webhook that grants access, a refund that never removes it, an out-of-order event that revives an expired subscription, a source outage that locks out every paying user, a sandbox purchase that unlocks production.
- A native mobile app cannot choose its billing: subscriptions sold inside the app go through the App Store and Google Play. A website can use any processor. A product that has both needs one answer across all three.
- The owner's billing platform, Bymax Finance, is specified and not built yet. Products need subscriptions before it exists, and must be able to move to it without rewriting product code. A port with adapters is what makes that possible (D01).

---

## 3. Scope

### 3.1 In the first release

- A normalized, typed model of an account's subscription state (§3.4).
- A source port, and two adapters: RevenueCat and Bymax Finance (§3.5 to §3.7).
- A webhook receiver that verifies, de-duplicates and processes notifications from the configured source (§3.8).
- A snapshot store port, with a refresh path and a reconciliation path (§3.9).
- A service to read state, a guard and a decorator to protect routes (§3.10).
- Typed change notifications to the host (§3.11).
- Two management operations: stop renewal, and get the place where the person manages the subscription (§3.12).
- A testing subpath with an in-memory store and a scriptable fake source (§3.13).

### 3.2 Out of scope

- Starting a purchase, a checkout or a refund. *Reason: these belong to the app and to the billing platform.*
- Talking directly to the App Store Server API or the Google Play Developer API. *Reason: the source does that. A direct store adapter is a different product.*
- One-time purchases and consumables, such as credit packs. *Reason: they are not subscription state. See §3.3.*
- A database schema or an ORM. *Reason: family rule; the host implements a small port.*
- A scheduler. *Reason: the library exposes reconciliation methods and the host calls them from its own job runner.*
- Product rules: trial eligibility, promotional prices, what to do on renewal, how long an offline client may trust a cached answer.
- A client or React package for purchase screens.

### 3.3 Future

- Non-renewing and one-time purchases as a separate record kind.
- A direct adapter for Stripe Billing.
- More management operations: resume, change product, extend, refund.
- An adapter that combines two sources for a host in transition between them.

### 3.4 The model

**FR01. Snapshot.** For one account the library holds one snapshot:

| Field | Meaning |
|---|---|
| Account identifier, and tenant identifier when the host is multi-tenant | Whose state this is |
| Entitlements | A list. Each has a name, whether it is active now, until when, and which subscription grants it |
| Subscriptions | A list, usually of one. Each is described in FR02 |
| Source and source customer reference | Which adapter produced this, and how the source names the account |
| Fetched at, and source updated at | When the library read it, and how fresh the source says it is |

**FR02. Subscription record.** Each subscription in a snapshot carries:

| Field | Values |
|---|---|
| Status | `trialing`, `active`, `in_grace`, `on_hold`, `paused`, `expired`, `unknown` |
| Gives access | Boolean, as the source reports it. The guard reads this, never the status name |
| Will renew | `yes`, `no`, `changes_product`, `pauses`, `unknown` |
| Origin | `app_store`, `play_store`, `web`, `promotional`, `other` |
| Environment | `production` or `sandbox` |
| Product reference and billing interval | As named by the source |
| Period | Current period start and end |
| Access until | The instant access ends if nothing else happens. Null for a lifetime grant |
| Billing issue since, cancelled at, refunded at | Null when not applicable |
| Management reference | Where the person manages it, when the source provides one |

**FR03. Status meanings.** These are fixed, so every adapter maps into the same words.

| Status | Meaning | Access |
|---|---|---|
| `trialing` | In a trial period | Yes |
| `active` | In a paid period. A subscription that will not renew stays `active` until its period ends, with will renew `no` | Yes |
| `in_grace` | A renewal payment failed and the source still grants access while it retries | Yes |
| `on_hold` | A renewal payment failed and access is suspended while the source retries | No |
| `paused` | Paused by the person or the platform | No |
| `expired` | Ended | No |
| `unknown` | The source reports a state the adapter does not recognise. The adapter passes the source's own access flag through | As the source says |

**FR04. No subscription is a value, not an error.** An account the source does not know has a snapshot with no entitlements and no subscriptions.

**FR05. Several subscriptions.** A snapshot can hold more than one subscription (for example one from a store and one from the web). An entitlement is active if any subscription that grants it gives access; its "until" is the latest among them. The library reports the overlap to the host (§3.11) and does not cancel anything by itself.

**FR06. Shared types.** The model, the status and origin values, the notification kinds and the error codes are exported from a subpath with no runtime dependency, so a web or mobile client can type a response with them.

### 3.5 The source port

**FR07.** One interface that every adapter implements. It can:

1. Read the current state of one account and return a snapshot.
2. Verify an incoming webhook request from its raw bytes and headers, and return either a refusal or a parsed notification: a unique event identifier, the accounts it concerns, the kind of change, the event time and the environment.
3. Declare its capabilities: which management operations it supports, per origin.
4. Perform the management operations it declares.

**FR08.** The host can register an adapter of its own that implements the port. The two shipped adapters use no private entry.

**FR09.** An adapter never returns a state it inferred from a webhook payload alone when it can read the source instead (§3.8, FR16).

### 3.6 RevenueCat adapter

*Verified* facts it is built on are in Appendix A.

**FR10. Read.** It reads a customer's subscriptions and active entitlements from version 2 of the RevenueCat REST API, which reports an explicit status, an access flag and a renewal status for each subscription, and maps them into the model. Version 1 is used only for the Google Play stop-renewal operation, which exists only there (D06).

**FR11. Identity.** The account identifier is the RevenueCat App User ID. The host must configure the RevenueCat SDKs with its own stable account identifier. An event that concerns an anonymous identifier, or an identifier the host does not know, is recorded and reported, never dropped silently. Aliases and transfers are followed: when RevenueCat moves purchases from one identifier to another, both accounts are refreshed.

**FR12. Webhook verification.** It supports both methods RevenueCat offers: the static authorization header, and the HMAC signature. With the signature it computes over the raw request bytes, checks the timestamp against a tolerance, and compares in constant time. The host chooses the method; using the header alone is allowed and reported at boot as the weaker option.

**FR13. Sandbox.** A subscription or event whose environment is sandbox never grants access unless the host turned that on explicitly (SEC07). RevenueCat grants entitlements for sandbox purchases by default, so the adapter filters by itself and does not rely on a dashboard setting.

**FR14. Mapping.** Appendix A has the table. Notable rules:

- A scheduled pause is not a pause. Access ends when the period ends.
- A cancellation keeps the subscription `active` with will renew `no`. A refund of the current period ends access at once and sets refunded at.
- A billing issue is `in_grace` or `on_hold` according to the source's own access flag.

### 3.7 Bymax Finance adapter

*Planned contract.* Bymax Finance is not released. This adapter is specified against its planned public API and is built when that API exists (D03). Appendix B lists what the adapter needs from it.

**FR15.** It reads a customer's subscription and entitlements through the Finance API with a tenant API key, verifies Finance's signed webhooks, and maps Finance's subscription states into the model. It has no dependency on RevenueCat and works for a host that sells only through Finance.

- **Identity.** Finance names a customer with its own identifier and stores the host's identifier as an external reference. The adapter keeps the pair in the snapshot's source customer reference from the first contact, and resolves it through a lookup by external reference once Finance offers one (D15).
- **Entitlement names.** Finance models plans and feature keys. The host maps plan identifiers to entitlement names in the module options (D07).
- **Hot path.** Finance asks its tenants not to call its API synchronously on a request path. The library's design already satisfies this: the guard reads the stored snapshot (§3.10).
- **Store purchases.** As specified today, Finance covers subscriptions it bills itself. A host that sells inside a native app through the app stores uses the RevenueCat adapter until Finance can report store purchases.

### 3.8 Webhooks

**FR16. A notification is a trigger, not the truth.** On a verified notification the library reads the account's current state from the source and stores that. It does not apply the payload's state. This is what RevenueCat recommends, it removes the dependence on delivery order, and it makes processing the same event twice harmless.

**FR17. Receiver.** The library offers the receiver in two forms:

- A controller the host can mount with one switch, off by default.
- A processor that takes raw bytes and headers and returns an outcome, for a host that owns its routing.

Both need the unparsed request body. The documentation says how to obtain it in NestJS, and the controller refuses to start without it.

**FR18. Outcomes.** Accepted and processed, accepted and already seen, accepted and ignored (an event kind that changes nothing), refused (verification failed), and failed (the source could not be read). The HTTP answer follows the source's contract: success for the first three so the source stops retrying, an authentication failure for a refusal, and a temporary failure for the last so the source retries.

**FR19. De-duplication.** Each event identifier is recorded when its processing starts, for a retention the host can set. A repeated identifier is answered as already seen without reading the source again. When an event ends in the failed outcome (FR18, FR21), its identifier is removed, so the source's retry of that event is processed (D16).

**FR20. Unknown event kinds and fields** are accepted and trigger a refresh. A new kind added by a source must never break the receiver.

**FR21. Deadline.** Processing fits inside the source's response time limit. If the read from the source is slow, the library answers with a temporary failure rather than holding the connection.

### 3.9 Storage, refresh and reconciliation

**FR22. Store port.** The host implements a small port to persist snapshots, with the changes of each that the host has not been told yet (FR33), and processed event identifiers. The library ships an in-memory implementation for tests and development, marked as not for production, and documents a reference implementation over a relational table. It imports no database client. It also ships a conformance suite the host runs against its own implementation (D11).

**FR23. Optional cache.** When the host provides a cache, the library reads through it in front of the store, with a short lifetime, and invalidates it on every change.

**FR24. Refresh on demand.** The service can force a read from the source for one account, for example right after the app reports a purchase, without waiting for the webhook. Concurrent refreshes of one account collapse into one source call.

**FR25. Staleness.** Every snapshot carries its age. The host sets a maximum age; the default is 24 hours (D12). A snapshot older than that is refreshed in the background on its next read, and the read returns the stored value meanwhile.

**FR26. Reconciliation.** The service exposes a method that refreshes the accounts whose snapshot is older than a threshold, in bounded batches, with a rate limit that respects the source's. The host calls it from its own scheduled job. This covers a lost webhook. The same run delivers the changes that are still marked as not delivered (FR33).

**FR27. Writes are ordered.** A stored snapshot is never replaced by one that the source reports as older.

### 3.10 Reading and guarding

**FR28. Service.** Read an account's snapshot. Ask whether an account has a named entitlement now. Both read the store, never the source, unless a refresh is requested.

**FR29. Guard and decorator.** A decorator marks a route as needing an entitlement by name, and a guard enforces it. The guard obtains the account from the request through a resolver the host supplies. A request with no account is refused as unauthenticated, not as unsubscribed.

**FR30. Refusal.** A refused request gets a stable error code and no detail about another account. The response distinguishes "no subscription" from "subscription exists and gives no access" (for example on hold), so a client can show the right screen.

**FR31. When the snapshot is missing or the store is down.** The policy is one explicit option with two values, and the default is to refuse (SEC04):

- **Refuse:** no snapshot or an unreadable store denies access.
- **Last known state:** a stored snapshot younger than a tolerance the host sets is trusted even when it cannot be refreshed. The default tolerance is 24 hours (D12).

### 3.11 Telling the host

**FR32. Change notifications.** After a snapshot changes and is stored, the library calls a hook the host supplies, with the previous snapshot, the new one and a typed list of what changed:

`started`, `renewed`, `trial_converted`, `will_not_renew`, `will_renew_again`, `entered_grace`, `put_on_hold`, `recovered`, `paused`, `resumed`, `product_changed`, `expired`, `refunded`, `transferred`, `overlap_detected`.

**FR33. Delivery.** At least once, after the store write, never inside the webhook's response deadline. The changes are stored with the snapshot, in the same write, marked as not delivered; the mark is cleared after the hook returns, and reconciliation delivers what is still marked (D17). Each notification carries a key that is stable for the same change (for a renewal, the subscription and the period), so the host can make its reaction idempotent. A hook that throws does not undo the stored state; the failure is logged and reported to the observer, and the changes stay marked.

**FR34. Observer.** An optional observer receives counters and timings: webhooks by outcome, refreshes, source errors, cache hits, guard decisions. No account identifier and no payload in it.

### 3.12 Management operations

**FR35. Capabilities first.** Before offering an action the host asks what is possible for a given subscription. The answer comes from the adapter and depends on the origin.

**FR36. Stop renewal.** Where the source allows a server to do it, the library asks the source to stop the renewal, then refreshes. Where it does not, the result is not an error: it says the person must do it themselves and gives the management reference.

| Origin | RevenueCat adapter | Bymax Finance adapter |
|---|---|---|
| App Store | Not possible from a server. Returns the management reference | Not applicable |
| Google Play | Possible | Not applicable |
| Web | Possible for RevenueCat's own web billing. For Stripe tracked by RevenueCat the host cancels in Stripe | Possible, at period end |

**FR37. Management reference.** Return the place where the person manages the subscription, when the source provides one.

**FR38. Honest results.** An operation reports what happened at the source, not what was asked. After "stop renewal" the returned snapshot is the one read back from the source.

### 3.13 Testing support

**FR39.** A testing subpath with the in-memory store, a fake source the test scripts (set a state, emit a notification, fail the next read), and builders for signed webhook requests of each shipped adapter, so a host can test its own wiring without a network.

---

## 4. User stories

1. **As a** backend developer, **I want** to protect a route with one decorator naming an entitlement, **so that** I do not write subscription checks by hand.
2. **As a** backend developer, **when** a person buys in the app, **I want** the account to have access within seconds, **so that** nobody pays and waits.
3. **As a** backend developer, **when** a renewal succeeds, **I am told once**, with a key I can use to make my reaction idempotent, **so that** I can grant what the product gives on renewal exactly once.
4. **As a** backend developer, **when** the billing platform is unreachable, **I want** paying users to keep access for a bounded time that I choose, **so that** an outage elsewhere is not my outage.
5. **As a** backend developer, **I want** to move from one billing platform to another by changing the module configuration, **so that** my routes and product rules do not change.
6. **As a** person who subscribed on an iPhone, **when** I ask to cancel in the app, **I am sent** to the place where I can do it, and the app never claims to have cancelled for me.
7. **As a** security reviewer, **I want** a forged, replayed or sandbox notification to grant nothing, **so that** access always traces to a verified read from the source.

---

## 5. Success criteria

### 5.1 Acceptance

| Id | Criterion | How it is verified |
|---|---|---|
| AC01 | A verified purchase notification results in an active entitlement readable through the service | End-to-end test with the fake source and with recorded provider payloads |
| AC02 | A notification with a wrong signature, a wrong authorization header, a stale timestamp or a body altered after signing is refused and changes nothing | Unit and end-to-end tests |
| AC03 | The same event delivered five times causes one source read and one host notification | End-to-end test |
| AC04 | Events delivered in reverse order leave the snapshot equal to the source's current state | End-to-end test |
| AC05 | A refund of the current period removes access on the next refresh and emits `refunded` | Test with recorded payloads |
| AC06 | A sandbox purchase grants nothing under the default configuration | Unit and end-to-end tests |
| AC07 | With the source down, the guard follows the configured policy exactly, in both values | End-to-end test |
| AC08 | Replacing the RevenueCat adapter with the fake or the Finance adapter requires no change in a host's routes or hook | The example application runs its suite against each |
| AC09 | No secret and no account identifier appears in any log line, error message, observer payload or serialized instance | Tests over the paths SEC05 names, and over captured logs |
| AC10 | Every state in Appendix A and Appendix B maps as its table says, and an unrecognised one maps to `unknown` | Table-driven tests generated from the appendices |

### 5.2 Quality gates

The family's gates, as in `nest-telemetry`: 100% statement, branch, function and line coverage in the unit suite, in the end-to-end suite and in both together; mutation testing at 100; zero suppression comments; packaging checks against the packed tarball in ESM and CommonJS; a bundle size budget; an API surface check.

---

## 6. Technical approach

### 6.1 Shape

```
              Host application
┌──────────────────────────────────────────────────┐
│  routes ──▶ guard ──▶ service ──▶ store port ──▶ host database
│                          │  ▲
│                          │  └── cache (optional)
│  webhook route ─▶ receiver ─▶ verify ─▶ de-duplicate
│                          │
│                          ▼
│                    source port ──▶ adapter ──▶ billing platform
│                          │
│                          ▼
│                    hook to the host (changes)
└──────────────────────────────────────────────────┘
```

Reads on a request path go to the store.

### 6.2 Package

- **Subpaths** (D08): the NestJS module and services at the root; `shared` for the types; `revenuecat` and `finance`, one per shipped adapter, so a host loads only the one it uses; `testing` for the testing support.
- **Zero direct dependencies.** NestJS packages are peers. Each adapter uses the platform's HTTP API through the runtime's own `fetch` and `node:crypto`, with no provider SDK.
- **Optional integration** with `@bymax-one/nest-cache` for the cache and with `@bymax-one/nest-core` for the error envelope, both as optional peers the library runs without.
- **Dual format**, ESM and CommonJS, with declarations for each, as the family's library standard requires.

### 6.3 Module

Configured with `forRoot` and `forRootAsync`, like the sibling libraries. The options name the adapter and its credentials, the store, the account resolver, the hook, the fail policy, the staleness limits, the sandbox switch and which controllers to mount. Invalid combinations are refused at boot with one aggregated message that names options and never values.

### 6.4 Errors

A closed catalogue of error codes with a stable prefix, exported from the shared subpath, covering: refused webhook, unknown account, entitlement required, subscription gives no access, source unavailable, operation not possible for this origin, and configuration errors.

---

## 7. Data the host stores

A sketch of the two records behind the store port. Names and columns are the host's.

| Record | Holds | Key |
|---|---|---|
| Snapshot | The normalized state of one account as a document, its source customer reference, fetched at, source updated at, and the changes not delivered to the host yet | Tenant and account |
| Processed event | Event identifier, source, received at | Source and event identifier |

The library keeps no other state. It stores no payment data, no price paid and no raw webhook payload (SEC06).

---

## 8. Constraints

- **Runtime:** Node.js 26 or newer, NestJS 11 (D09). A backend moves to Node.js 26 before it installs this library.
- **Family rules:** zero direct dependencies; every peer that is not NestJS itself is optional; injection tokens are symbols; explicit injection on every provider; one place reads the environment, and the library itself reads none.
- **Language:** everything in the repository and on GitHub is English.
- **Release:** the first publish and every version bump need the owner's explicit instruction. Breaking changes are announced in the changelog with a note on how a derived backend applies them.

### 8.1 Non-functional requirements

| Id | Requirement |
|---|---|
| NFR01 | A guard decision makes no network call to a billing platform |
| NFR02 | A webhook is answered within the source's time limit, with margin, or answered as a temporary failure |
| NFR03 | Concurrent refreshes of one account produce one source call |
| NFR04 | Reconciliation respects the source's rate limit and is bounded per run |
| NFR05 | An adapter that is not configured loads none of its code |

### 8.2 Security requirements

| Id | Requirement |
|---|---|
| SEC01 | No access is ever granted from a webhook payload. Access comes only from a read of the source, or from a stored snapshot that came from one |
| SEC02 | Signature verification runs over the raw request bytes, before parsing, with a timestamp tolerance and a constant-time comparison |
| SEC03 | A refused webhook answers without telling which check failed |
| SEC04 | The default on a missing snapshot, an unreadable store or an unreachable source is to refuse. Trusting a last known state is an explicit option with a bounded tolerance |
| SEC05 | Credentials and webhook secrets are held so that serialization, spread and inspection of a library object never expose them. They never appear in an error or a log |
| SEC06 | The library stores and logs no payment data and no raw payload. Account identifiers are absent from logs and observer payloads, or present only as a short hash |
| SEC07 | Sandbox purchases grant nothing unless the host enabled it explicitly, and enabling it in a production environment is refused at boot unless a second, separate option confirms it |
| SEC08 | One account can never read or change another's snapshot. In a multi-tenant host the tenant is part of every key and comes from the authenticated request, never from a request body |
| SEC09 | Secret rotation is supported without downtime where the source allows two valid secrets, and documented as a restart where it does not |
| SEC10 | A management operation acts only on a subscription that belongs to the authenticated account |

---

## 9. Risks

| Id | Risk | Level | Mitigation |
|---|---|---|---|
| R01 | Bymax Finance is not released, and its planned API does not report purchases made in the app stores | HIGH | The Finance adapter is built when the API exists (D03). Hosts with a native app use the RevenueCat adapter. The requirements in Appendix B are sent to the Finance project |
| R02 | The two sources disagree on what a state means (for example how long access lasts after a failed payment) | MEDIUM | The model carries the source's own access flag, and the guard reads that. Status names are descriptive only |
| R03 | A source changes its webhook or API | MEDIUM | Unknown kinds and fields are tolerated (FR20). Mapping tables are tested from recorded payloads, and a scheduled job checks the provider's changelog |
| R04 | A host's hook is slow or throws, and the product misses a renewal | MEDIUM | Changes stored as not delivered until the hook returns (D17), a stable key per change (FR33), and reconciliation, which delivers them again |
| R05 | The store port is implemented without the uniqueness the library relies on, and events are processed twice | MEDIUM | The reference implementation and a conformance test suite the host runs against its own store |
| R06 | Reading the source on every webhook hits its rate limit during a spike | MEDIUM | One read per account at a time (NFR03), de-duplication before the read (FR19), and a temporary failure answer that lets the source retry |
| R07 | The family's gates (100% coverage and mutation) make each mapping rule expensive | LOW | Mapping is pure and table-driven, which is the cheapest code to cover |

---

## 10. Decisions

### 10.1 Taken by the owner

| Id | Decision | Date |
|---|---|---|
| D01 | Subscription state is a library, not code in the backend template or in each product | 2026-11-24 |
| D02 | The library serves a host that uses RevenueCat and, independently, a host that uses Bymax Finance with no RevenueCat | 2026-11-24 |
| D03 | The Bymax Finance adapter is specified now and built when the Finance API exists | 2026-11-24 |
| D04 | The package is `@bymax-one/nest-subscription`, public, in the repository `bymaxone/nest-subscription` | 2026-11-24 |
| D05 | The repository, its documents and everything on GitHub are in English | 2026-11-24 |
| D06 | The RevenueCat adapter reads from version 2 of the REST API and uses version 1 only for the Google Play stop-renewal operation | 2026-11-24 |
| D07 | For Bymax Finance, the host maps plan identifiers to entitlement names in the module options, so product code uses the same names with either adapter | 2026-11-24 |
| D08 | Subpaths: the root, `shared`, `revenuecat`, `finance` and `testing` | 2026-11-24 |
| D09 | The library requires Node.js 26 or newer | 2026-11-24 |
| D10 | The first release ships both the webhook controller, off by default, and the processor | 2026-11-24 |
| D11 | The library ships the store port, an in-memory store for tests and a conformance suite; a store for a relational table is documented, not shipped | 2026-11-24 |
| D12 | The default staleness limit and the default tolerance for a last known state are both 24 hours | 2026-11-24 |
| D13 | The first release includes the stop-renewal operation | 2026-11-24 |
| D14 | The example repository is `nest-subscription-example` | 2026-11-24 |
| D15 | The Finance adapter stores the pair of host account identifier and Finance customer identifier at first contact, and uses a lookup by external reference once Finance offers one | 2026-11-24 |
| D16 | A webhook event identifier is recorded when processing starts and removed when the event ends in the failed outcome, so the source's retry is processed | 2026-11-24 |
| D17 | Changes are stored with the snapshot as not delivered, cleared after the host hook returns, and delivered again by reconciliation while they stay marked. This is how delivery is at least once across a process crash | 2026-11-24 |
| D18 | The RevenueCat adapter's test fixtures are recorded from a RevenueCat sandbox project, with identifiers and secrets replaced | 2026-11-24 |

### 10.2 Open

A new question is added here with a proposal and is never answered on the owner's behalf.

| Id | Question | Proposal |
|---|---|---|
| Q01 | FR32 gives the hook the previous snapshot. Under D17 only the undelivered changes are stored with the snapshot, so when reconciliation delivers a change again the previous snapshot no longer exists. What does the hook receive then? | The hook always receives the new snapshot and the change list with its keys. It receives the previous snapshot on the first delivery, and on a redelivery that field is absent and the call is marked as a redelivery. The alternative is to store the previous snapshot with the pending changes, which doubles what the host stores for every account that has a change pending |

---

## 11. First implementation phase must also deliver

Stated here because the repository starts with documents only.

- The scaffold of `nest-telemetry`: package metadata, TypeScript, lint, formatting, test, coverage, mutation and build configuration, the packaging and size checks, the release workflow and the security scans.
- The library's own sections of `AGENTS.md`, plus `CLAUDE.md`, `CONTRIBUTING.md` and the Copilot instruction files.
- The organisation's reusable CI in place of the specification-stage job, keeping the aggregate check named `CI passed`.
- The required status checks added to the repository ruleset.

---

## 12. References

RevenueCat, read on 2026-11-24:

- Webhooks: https://www.revenuecat.com/docs/integrations/webhooks
- Event types and fields: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
- REST API version 1, customers and transactions: https://www.revenuecat.com/docs/api-v1/customers, https://www.revenuecat.com/docs/api-v1/transactions
- REST API version 2, customer and subscription: https://www.revenuecat.com/docs/api-v2/customer, https://www.revenuecat.com/docs/api-v2/subscription, https://www.revenuecat.com/docs/api-v2/subscription-data-model
- Identifying customers and restore behaviour: https://www.revenuecat.com/docs/customers/identifying-customers, https://www.revenuecat.com/docs/projects/restore-behavior
- Sandbox access: https://www.revenuecat.com/docs/projects/sandbox-access
- Managing subscriptions and refunds: https://www.revenuecat.com/docs/subscription-guidance/managing-subscriptions, https://www.revenuecat.com/docs/subscription-guidance/refunds

Stores, read on 2026-11-24:

- Google Play subscription lifecycle: https://developer.android.com/google/play/billing/lifecycle/subscriptions
- Google Play cancel: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/cancel
- App Store, manage subscriptions sheet: https://developer.apple.com/documentation/storekit/appstore/showmanagesubscriptions(in:)
- App Store Server Notifications, types: https://developer.apple.com/documentation/appstoreservernotifications/notificationtype

---

## Appendix A — RevenueCat facts and mapping

*Verified* on 2026-11-24 unless marked. Re-read the linked page before relying on an exact wording.

### A.1 Webhooks

| Fact | Detail |
|---|---|
| Authentication | A static `Authorization` header value set in the dashboard. Optionally, an HMAC signature in `X-RevenueCat-Webhook-Signature`, of the form `t=<unix timestamp>,v1=<hex>`, computed with HMAC-SHA256 over `<timestamp>.<raw body>` |
| Signature per attempt | Each retry is signed again; a replay tolerance of about five minutes is suggested |
| Delivery | At least once. Nothing is stated about order |
| Retries | Up to five, with exponential backoff, over about 80 minutes |
| Success | HTTP 200. Any other status is a failure |
| Time limit | The connection is dropped after 60 seconds |
| De-duplication | The event `id`. A retry reuses the same `id` |
| Recommended handling | Call the REST API for the customer after receiving any webhook |
| Forward compatibility | New event types and fields can appear |

### A.2 Event kinds

`TEST`, `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `UNCANCELLATION`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_PAUSED`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`, `SUBSCRIPTION_EXTENDED`, `REFUND_REVERSED`, `INVOICE_ISSUANCE`, `TRANSFER`, `TEMPORARY_ENTITLEMENT_GRANT`, `VIRTUAL_CURRENCY_TRANSACTION`, `EXPERIMENT_ENROLLMENT`, `PURCHASE_REDEEMED`, `PRICE_INCREASE_CONSENT_REQUIRED`, `PRICE_INCREASE_CONSENT_APPROVED`, and the deprecated `SUBSCRIBER_ALIAS`.

Rules that are easy to get wrong:

- `SUBSCRIPTION_PAUSED` means a pause is scheduled for the end of the period. Access is not removed on it.
- `CANCELLATION` covers both "will not renew" and a refund. A refund carries the cancel reason `CUSTOMER_SUPPORT`.
- `BILLING_ISSUE` does not mean the subscription expired.
- `PRODUCT_CHANGE` does not mean the new product is in effect.
- `TRANSFER` names the identifiers that lost and gained the purchases.
- The event's `environment` is `SANDBOX` or `PRODUCTION`.

### A.3 Status mapping (REST API version 2)

| RevenueCat status | Library status |
|---|---|
| `trialing` | `trialing` |
| `active` | `active` |
| `in_grace_period` | `in_grace` |
| `in_billing_retry` | `on_hold` |
| `paused` | `paused` |
| `expired` | `expired` |
| `incomplete`, `unknown` | `unknown`, with the access flag passed through |

Renewal status maps to will renew: `will_renew` to `yes`, `will_not_renew` to `no`, `will_change_product` to `changes_product`, `will_pause` to `pauses`, the others to `unknown`.

Store maps to origin: `app_store` and `mac_app_store` to `app_store`; `play_store` to `play_store`; `stripe`, `rc_billing`, `paddle` and `paypal` to `web`; `promotional` to `promotional`; every other value to `other`.

### A.4 What a server can do

| Origin | Stop renewal from a server |
|---|---|
| Google Play | Yes, through the version 1 API. Access continues until the period ends |
| App Store | No. RevenueCat states that Apple does not allow developers to manage subscriptions on behalf of users |
| RevenueCat web billing | Yes, through the version 2 API |
| Stripe tracked by RevenueCat | Not through RevenueCat; through Stripe |

### A.5 Identity

- An App User ID is case-sensitive, at most 100 characters, and scoped to a project. A non-guessable identifier is recommended.
- An anonymous identifier starts with `$RCAnonymousID:` and cannot share status across platforms.
- Several identifiers can be aliases of one customer; reading any of them returns the same state.
- The project's restore behaviour decides whether a purchase restored under another identifier is transferred. The default transfers it.

### A.6 Not confirmed

- Whether version 1 of the REST API is deprecated. No notice was found.
- A refund marker in version 2 equivalent to version 1's refunded date.
- Any guidance about delivery order.

---

## Appendix B — What the Bymax Finance adapter needs

*Planned contract.* Bymax Finance is not released. This appendix states the adapter's requirements; it is not a description of a public API.

| Need | Why |
|---|---|
| A read of one customer's subscription with: state, plan and price reference, billing interval, current period start and end, whether it renews, cancelled at, and the instant access ends | To fill the subscription record (FR02) |
| A read of one customer's resolved entitlements | To fill the entitlements (FR01) |
| A lookup of a customer by the host's own account identifier | To find the customer at first contact (D15) |
| Signed webhooks with a timestamp, a unique event identifier and a documented signature scheme with rotation | Verification and de-duplication (FR15, FR19) |
| A list of past events with a stated retention | Reconciliation after a missed delivery (FR26) |
| A stop-renewal operation that keeps access until the period ends | FR36 |
| A reference to the place where the customer manages the subscription | FR37 |
| A marker that separates test data from live data | SEC07 |

State mapping, from the states in Finance's planned specification:

| Finance state | Library status | Access |
|---|---|---|
| Pending first payment | No subscription record | No |
| Trial | `trialing` | Yes |
| Active | `active` | Yes |
| Past due, inside the grace period | `in_grace` | Yes |
| Unpaid, after the grace period | `on_hold` | No |
| Suspended or paused | `paused` | No |
| Cancelled, before the period ends | `active` with will renew `no` | Yes, until the period ends |
| Expired | `expired` | No |

For a host with a native mobile app, Finance would also need to report subscriptions bought through the App Store and Google Play before it can replace the RevenueCat adapter there (R01).
