# Changelog

All notable changes to `@bymax-one/nest-subscription` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The package scaffold: the build, the quality gates and the CI for the root, `shared`,
  `revenuecat`, `finance` and `testing` subpaths and the internal bundle.
- `SUBSCRIPTION_ENVIRONMENTS` and `SubscriptionEnvironment` in the `shared` subpath.
- The normalized model in the `shared` subpath: `SubscriptionSnapshot`, `SubscriptionRecord`,
  `EntitlementState`, `SourceCustomerReference` and `SubscriptionChange`, with the closed value
  sets `SUBSCRIPTION_STATUSES`, `WILL_RENEW_VALUES`, `SUBSCRIPTION_ORIGINS` and `CHANGE_KINDS` and
  their union types.
- The closed error-code catalogue `SUBSCRIPTION_ERROR_CODES` and `SubscriptionErrorCode` in the
  `shared` subpath, and `SubscriptionError` with the catalogue exported from the root.
- `createEmptySnapshot`, `resolveEntitlements` and `SubscriptionInputError` in the `shared` subpath:
  the snapshot of an unknown account and the rule that resolves entitlements across subscriptions.
- `encodeAccountKey`, the one function that joins a tenant and an account identifier into a key,
  exported from the root.
- The source port `SubscriptionSource`, the store port `SubscriptionStore`, `Clock`, the injection
  tokens `SUBSCRIPTION_OPTIONS`, `SUBSCRIPTION_SOURCE`, `SUBSCRIPTION_STORE`, `SUBSCRIPTION_CLOCK`,
  `SUBSCRIPTION_CACHE` and `SUBSCRIPTION_OBSERVER`, and every type that crosses a port, exported from
  the root.
- `InMemorySubscriptionStore` and `storeConformanceCases` in the `testing` subpath: an in-memory
  store for tests and development, not for production, and the conformance cases a host runs
  against its own store.
