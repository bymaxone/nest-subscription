# @bymax-one/nest-subscription

Subscription state library for NestJS 11: normalized entitlements across App Store, Google Play and web purchases, with pluggable source adapters (RevenueCat, Bymax Finance), verified webhooks, snapshot caching and route guards. Zero direct dependencies.

> [!IMPORTANT]
> This repository is at the specification stage. There is no source code and no published package yet. The library is being built from [`docs/spec.md`](docs/spec.md).

## What it will do

- Give a product backend one typed answer about an account's subscription: its level, its state, until when it is valid and where it was bought.
- Read that answer from a source through an adapter. A backend chooses one: RevenueCat, or Bymax Finance.
- Receive and verify the source's webhooks, and keep a cached copy of the state current.
- Protect routes with a guard and a decorator.
- Tell the host application when a subscription changes, so product rules stay in the product.

## What it will not do

- Charge anyone, hold card data, or talk to the App Store or Google Play on the device. Purchases happen in the app and in the billing platform.
- Decide what a subscription is worth in a product. Prices, benefits and limits belong to the host.

## Documentation

- [Specification](docs/spec.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)
