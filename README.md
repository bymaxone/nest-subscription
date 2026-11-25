# @bymax-one/nest-subscription

Subscription state library for NestJS 11: normalized entitlements across App Store, Google Play and web purchases, with pluggable source adapters (RevenueCat first, Bymax Finance planned), verified webhooks, snapshot caching and route guards. Zero direct dependencies.

> [!IMPORTANT]
> This repository is scaffolded. The build, the quality gates and the CI are in place, and the entry points export almost nothing: the library's behaviour is written phase by phase from [`docs/plan.md`](docs/plan.md), against [`docs/spec.md`](docs/spec.md). Nothing is published to npm yet.

## What it will do

- Give a product backend one typed answer about an account's subscription: its level, its state, until when it is valid and where it was bought.
- Read that answer from a source through an adapter. A backend chooses one: RevenueCat now, Bymax Finance when it is released.
- Receive and verify the source's webhooks, and keep a cached copy of the state current.
- Protect routes with a guard and a decorator.
- Tell the host application when a subscription changes, so product rules stay in the product.

## What it will not do

- Charge anyone, hold card data, or talk to the App Store or Google Play on the device. Purchases happen in the app and in the billing platform.
- Decide what a subscription is worth in a product. Prices, benefits and limits belong to the host.

## The shared model

The model's types and closed value sets live in the `shared` subpath, which needs no NestJS package. The first of them is the set of environments a subscription can come from:

```ts
import { SUBSCRIPTION_ENVIRONMENTS } from '@bymax-one/nest-subscription/shared'

const environments: readonly string[] = SUBSCRIPTION_ENVIRONMENTS
```

## Documentation

- [Specification](docs/spec.md)
- [Roadmap](docs/plan.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)
