# RevenueCat fixtures

Every file here is JSON that a test reads; none holds a real identifier, token or secret. Every
identifier is an obvious placeholder (`customer_PLACEHOLDER_a`, `sub_PLACEHOLDER_1`,
`entl_PLACEHOLDER_premium`, `proj_PLACEHOLDER`, `user_PLACEHOLDER_a`). The check in
`src/revenuecat/fixtures-are-sanitized.spec.ts` fails on a real-looking identifier, an email, a
key, a signature, a UUID or an identifier of the sandbox project the recordings came from.

A **customer fixture** holds the customer's identifier and, as the version 2 API returned them, the
bodies of `subscriptions`, `purchases` and `activeEntitlements` (a list each). An unknown customer
holds the status and the error body instead. A **webhook fixture** is the body of one POST, with the
`api_version` and `event` keys, and the name `webhook-<kind>.json`.

## Recorded

Recorded on 2026-11-25 from a dedicated RevenueCat project connected to the Test Store only, with
a version 2 secret key held in the operator's keychain, then stripped of every identifier. The
base address is `https://api.revenuecat.com/v2` and `{p}` is the project.

| File                     | Requests that produced it                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `promotional-grant.json` | `POST /projects/{p}/customers`, then `POST /projects/{p}/customers/{c}/actions/grant_entitlement`, then `GET` of `/subscriptions`, `/purchases` and `/active_entitlements` of the customer |
| `two-subscriptions.json` | the same, with two grants of two entitlements to one customer                                                                                                                              |
| `empty-customer.json`    | `POST /projects/{p}/customers`, then `GET` of the three lists                                                                                                                              |
| `unknown-customer.json`  | `GET /projects/{p}/customers/{c}/subscriptions` for an identifier that was never created; the response is HTTP 404                                                                         |

The sandbox cannot make a store purchase through the API, so the recorded subscriptions are
promotional grants (`store: promotional`, which RevenueCat reports as `environment: production`).

## Written from the documentation

The states below cannot be produced in the sandbox. They follow the field list of
https://www.revenuecat.com/docs/api-v2/customer/resources and the status values of
https://www.revenuecat.com/docs/api-v2/subscription-data-model, read on 2026-11-25, with the
values of the state named by the file.

| File                                 | State                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active-subscription.json`           | `active`, `will_renew`, App Store                                                                                                                               |
| `trialing-subscription.json`         | `trialing`                                                                                                                                                      |
| `cancelled-active-subscription.json` | `active` with `will_not_renew`: cancelled, access until the period ends                                                                                         |
| `scheduled-pause.json`               | `active` with `will_pause`, Play Store: a pause is scheduled, access continues                                                                                  |
| `in-grace.json`                      | `in_grace_period`, access given, period end in the past                                                                                                         |
| `in-billing-retry.json`              | `in_billing_retry`, no access                                                                                                                                   |
| `paused.json`                        | `paused`, no access, no period end                                                                                                                              |
| `expired.json`                       | `expired`, no access                                                                                                                                            |
| `refunded-subscription.json`         | no access and `ends_at` earlier than `current_period_ends_at`. The page states no refund marker for a subscription; see the open question Q1 of `docs/spec.md`  |
| `sandbox-subscription.json`          | `environment: sandbox` with `gives_access: true`, which is what RevenueCat does under its default setting                                                       |
| `unknown-status.json`                | `incomplete` and `requires_price_increase_consent`, values outside the table                                                                                    |
| `lifetime-purchase.json`             | a purchase that grants an entitlement; the entitlement has `expires_at: null`                                                                                   |
| `non-renewing-purchase.json`         | a purchase whose entitlement has an `expires_at`                                                                                                                |
| `consumable-purchase.json`           | a purchase whose entitlement list is empty                                                                                                                      |
| `refunded-purchase.json`             | a purchase with `status: refunded`                                                                                                                              |
| `sandbox-purchase.json`              | a sandbox purchase reported as granting its entitlement                                                                                                         |
| `webhook-*.json`                     | one body per event kind the adapter distinguishes, in the shape of the Sample events page (https://www.revenuecat.com/docs/integrations/webhooks/sample-events) |
