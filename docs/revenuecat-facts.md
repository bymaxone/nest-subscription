# RevenueCat facts

Every fact the RevenueCat adapter relies on, with the page it came from. All pages were read on
2026-11-25 unless a row says otherwise. A row marked **observed** was seen in a response from a
RevenueCat sandbox project the same day; a row marked **not stated** is a question the page leaves
open, and the adapter does not answer it by inference unless the row says so under "Adapter".

A fact that disagrees with `docs/spec.md` Appendix A is listed in section 8, and the specification
was corrected in the same change.

Pages:

- API v2 overview: https://www.revenuecat.com/docs/api-v2
- Customer: https://www.revenuecat.com/docs/api-v2/customer
- Customer resources: https://www.revenuecat.com/docs/api-v2/customer/resources
- Subscription: https://www.revenuecat.com/docs/api-v2/subscription
- Subscription data model: https://www.revenuecat.com/docs/api-v2/subscription-data-model
- Purchase: https://www.revenuecat.com/docs/api-v2/purchase
- Entitlement: https://www.revenuecat.com/docs/api-v2/entitlement
- Webhooks: https://www.revenuecat.com/docs/integrations/webhooks
- Event types and fields: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
- Sample events: https://www.revenuecat.com/docs/integrations/webhooks/sample-events
- Identifying customers: https://www.revenuecat.com/docs/customers/identifying-customers
- Restore behavior: https://www.revenuecat.com/docs/projects/restore-behavior
- Sandbox access: https://www.revenuecat.com/docs/projects/sandbox-access
- API v1, customers: https://www.revenuecat.com/docs/api-v1/customers

## 1. Transport and authentication

| Fact                              | Detail                                                                                                                                                                                                                                                            | Source                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Base URL                          | `https://api.revenuecat.com/v2`                                                                                                                                                                                                                                   | API v2 overview                     |
| Authentication                    | `Authorization: Bearer <v2 secret key>`. The `Bearer` prefix is required. A version 1 key is rejected                                                                                                                                                             | API v2 overview                     |
| Wrong key (observed)              | HTTP 401                                                                                                                                                                                                                                                          | observed                            |
| Project in the path               | Every path used here starts `/projects/{project_id}/`. A key that does not belong to the project is an authorization error                                                                                                                                        | API v2 overview                     |
| Customer identifier               | `customer_id` is a string of 1 to 1500 characters in the path. Whether it must be percent-encoded is **not stated**                                                                                                                                               | Customer                            |
| Rate limit                        | Customer information domain: 480 requests a minute, per API key; endpoints of a domain share the limit                                                                                                                                                            | API v2 overview                     |
| Rate-limit headers                | Successful responses carry `RevenueCat-Rate-Limit-Current-Usage` and `RevenueCat-Rate-Limit-Current-Limit` (observed)                                                                                                                                             | API v2 overview                     |
| Over the limit                    | HTTP 429 with a `Retry-After` header in seconds; the body has `type: rate_limit_error` and `backoff_ms`                                                                                                                                                           | API v2 overview                     |
| Pagination                        | Query `limit` (default 20) and `starting_after` (the id of the last item of the page). Forward only. A maximum `limit` is **not stated** for subscriptions or purchases; the aliases, entitlements and active-entitlements pages say values above 100 are clamped | API v2 overview, Customer resources |
| Next page (observed)              | `next_page` is an absolute URL on the same host and path with `starting_after` and `limit` in its query, or `null` on the last page. The overview page shows a relative path                                                                                      | observed                            |
| Error body                        | `type`, `message`, `retryable`, `doc_url`, and `object: "error"` (observed); the page lists `parameter_error`, `rate_limit_error`, `resource_missing`, `server_error` and `store_error` as types                                                                  | API v2 overview, observed           |
| Status codes                      | 200, 201, 202, 204; 400, 401, 403, 404, 409, 418, 422, 423, 429; 500, 502, 503, 504                                                                                                                                                                               | API v2 overview                     |
| Unknown customer                  | HTTP 404 with `type: resource_missing` and message `Could not find customer ID associated with this project`, from the customer endpoint and from each of its list endpoints (observed)                                                                           | Customer, observed                  |
| Key of another project (observed) | HTTP 403 with `type: authorization_error` and the message that the key does not belong to the project; it is not a 404, so a wrong project is never read as an unknown customer                                                                                   | observed                            |

Adapter: the customer identifier is percent-encoded into the path; `next_page` is never followed, the
next request is built from the configured base address and the last item's id, so a response cannot
send the adapter to another host.

## 2. Reads the adapter makes

| Endpoint                                                                  | Permission                                | Source             |
| ------------------------------------------------------------------------- | ----------------------------------------- | ------------------ |
| `GET /projects/{project_id}/customers/{customer_id}/subscriptions`        | `customer_information:subscriptions:read` | Customer resources |
| `GET /projects/{project_id}/customers/{customer_id}/purchases`            | `customer_information:purchases:read`     | Customer resources |
| `GET /projects/{project_id}/customers/{customer_id}/active_entitlements`  | `customer_information:customers:read`     | Customer resources |
| `GET /projects/{project_id}/subscriptions/{subscription_id}/entitlements` | `customer_information:subscriptions:read` | Subscription       |
| `GET /projects/{project_id}/purchases/{purchase_id}/entitlements`         | `customer_information:purchases:read`     | Purchase           |

All five take `starting_after` and `limit`. The two customer lists also take `environment`
(`sandbox` or `production`; omitted means both) and `expand`; the adapter sends neither, because it
filters sandbox itself (FR13).

## 3. The subscription object

Fields of an item of the subscriptions list (Subscription, Customer resources; every value below
was also seen in a response unless it says otherwise).

| Field                                   | Type and meaning                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                    | string, 1 to 255 characters. The subscription reference                                                                                                                                                |
| `customer_id`, `original_customer_id`   | string                                                                                                                                                                                                 |
| `product_id`                            | string or `null` (null for a promotional grant, observed)                                                                                                                                              |
| `starts_at`, `current_period_starts_at` | int64, milliseconds since the epoch                                                                                                                                                                    |
| `current_period_ends_at`                | int64 or `null`; `null` when paused with no end date                                                                                                                                                   |
| `ends_at`                               | int64 or `null`                                                                                                                                                                                        |
| `gives_access`                          | boolean. "Whether the customer should currently receive access to the subscription's associated entitlements". The data model page directs the reader to this field, not to `status`, to decide access |
| `pending_payment`                       | boolean                                                                                                                                                                                                |
| `status`                                | `trialing`, `active`, `expired`, `in_grace_period`, `in_billing_retry`, `paused`, `unknown`, `incomplete`                                                                                              |
| `auto_renewal_status`                   | `will_renew`, `will_not_renew`, `will_change_product`, `will_pause`, `requires_price_increase_consent`, `has_already_renewed`                                                                          |
| `store`                                 | `amazon`, `app_store`, `mac_app_store`, `play_store`, `promotional`, `stripe`, `rc_billing`, `external`, `roku`, `paddle`, `paypal`, `galaxy`, `test_store`                                            |
| `environment`                           | `production` or `sandbox` (the Customer resources page); the subscription page lists no values                                                                                                         |
| `ownership`                             | present; its values are **not stated**                                                                                                                                                                 |
| `entitlements`                          | a list object: `object: "list"`, `items`, `next_page` (string or null), `url`                                                                                                                          |
| `management_url`                        | string or `null`                                                                                                                                                                                       |
| `store_subscription_identifier`         | string                                                                                                                                                                                                 |
| `pending_changes`                       | object or `null`: the fields that will differ after the current period                                                                                                                                 |
| `country`                               | ISO alpha-2 code, an empty value, or `null` (observed)                                                                                                                                                 |

The status meanings are from the Subscription data model page: `in_grace_period` is "past its
expiry date after a billing issue, but still in an access-granting grace period"; `in_billing_retry`
is "billing failed and is being retried; access is suspended"; `paused` "should not provide access";
`unknown` means "check `gives_access`"; `incomplete` is incomplete, "for example due to billing
details or a future start date".

How states are represented (same page):

- A cancellation is `auto_renewal_status: will_not_renew`, and access continues until the period
  ends. There is no cancelled status.
- A scheduled pause is `auto_renewal_status: will_pause`. A paused subscription is `status: paused`.
- **Refund of a subscription: not stated.** The page has no refund marker or refund status. The
  Subscription page's refund action for a Web Billing subscription says it "refunds the most recent
  payment; access is lost immediately", and says nothing about how the object then looks.
- **The instant a grace period ends: not stated.** For `in_grace_period` the page says the
  subscription is past its expiry date and still gives access, and gives no field for the end of the
  grace period.
- A billing interval is **not stated** on the subscription object.
- A freshness field of the source (the snapshot's source-updated-at) is **not stated** on any
  object the adapter reads.

Observed response of a promotional grant (the customer, the subscription and the entitlement are
placeholders in the fixtures): `store: promotional`, `status: active`, `gives_access: true`,
`auto_renewal_status: will_not_renew`, `environment: production`, `ownership: purchased`,
`product_id: null`, `management_url: null`, and the entitlement list holding one entitlement with
both an internal `id` and a `lookup_key`.

## 4. The purchase object and non-renewing purchases

Purchase (Purchase, Customer resources):

| Field                       | Type and meaning                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | string. The purchase reference                                                                                                               |
| `product_id`                | string                                                                                                                                       |
| `purchased_at`              | int64, milliseconds                                                                                                                          |
| `quantity`                  | integer                                                                                                                                      |
| `status`                    | `owned` or `refunded`                                                                                                                        |
| `entitlements`              | a list object like the subscription's. A consumable has an empty list **(not stated; the adapter treats an empty list as granting nothing)** |
| `environment`               | `production` or `sandbox`                                                                                                                    |
| `store`                     | the same values as a subscription's                                                                                                          |
| `store_purchase_identifier` | string (the sample on the Purchase page shows a number, the schema says string)                                                              |

There is **no `gives_access`, no expiry and no refund instant** on a purchase. The refund marker is
`status: refunded`.

Active entitlement (Customer resources): `{ object: "customer.active_entitlement", entitlement_id,
expires_at }` with `expires_at` int64 or `null`. It names **no grantor**. The page does not say
whether `expires_at: null` means a lifetime grant, nor how an entitlement granted by two sources is
dated.

Entitlement (Entitlement): `id` (for example `entl...`), `lookup_key` ("a custom identifier of the
entitlement"), `display_name`, `state` (`active` or `inactive`), `project_id`, `created_at`. How
`lookup_key` relates to the webhook's `entitlement_ids` is **not stated**.

Adapter (the design the code follows, from the rows above):

- The name of an entitlement is its `lookup_key`, read from the nested `entitlements` list of the
  subscription or the purchase. The active-entitlements list carries only the internal `id`, so it
  can be matched to a name only through the nested list's `id`.
- The grantors of an entitlement (D40) are the subscriptions and purchases whose own nested list
  names it, never the active-entitlements list.
- A nested list with a `next_page` is completed from the per-subscription or per-purchase
  entitlements endpoint.
- A purchase gives access when its status is `owned` and an entitlement it grants is in the
  active-entitlements list, unless sandbox access is not allowed and a sandbox subscription giving
  access or an owned sandbox purchase of the customer also grants that entitlement: the list spans both environments and names
  no grantor, so it is no evidence for the production purchase. Its access-until is the
  latest `expires_at` of those entitlements (`null` when one has none). This is the adapter's equivalent of the access flag a purchase lacks; the
  documentation does not state it.
- A consumable, and any purchase whose nested list is empty, grants nothing and is not held (D31).
- The API states no refund instant for a purchase; the adapter uses the purchase instant as the refund instant so the value is the same on every read.
- An entitlement that both a subscription and a purchase grant has one `expires_at` in the active-entitlements list; the adapter gives it to the purchase as its end, which can read later than the purchase's own.

## 5. Webhooks

| Fact                 | Detail                                                                                                                                                                                                                                                                                                            | Source                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Body                 | `{ "api_version": "1.0", "event": { ... } }`. `api_version` is at the root; the event fields are in `event`                                                                                                                                                                                                       | Sample events         |
| Authorization header | Optional. Set in the dashboard; sent with each POST; "your server should verify it on every notification". The page says "an authorization header value"; it does not name the header or describe a scheme or prefix, so the adapter reads the header `Authorization` (Appendix A.1) and compares the whole value | Webhooks              |
| Signature header     | `X-RevenueCat-Webhook-Signature: t=<unix_timestamp>,v1=<hmac_sha256_hex>`. Enabled with the HMAC webhook signing toggle on each integration                                                                                                                                                                       | Webhooks              |
| Signed string        | HMAC-SHA256, keyed with the signing secret, over `<timestamp>.<raw_json_body>`, computed over the raw request bytes before parsing                                                                                                                                                                                | Webhooks              |
| Timestamp            | `t` is signed fresh on every attempt and is not the payload's `event_timestamp_ms`. The unit of `t` is "unix timestamp"; the page does not say seconds or milliseconds. The adapter reads it as seconds and refuses a value that is not a whole number of seconds                                                 | Webhooks              |
| Tolerance            | Optional. 5 minutes is the page's example. "Don't size it to cover the full retry window (about 80 minutes across all retries)"; it only needs to cover clock skew and POST latency                                                                                                                               | Webhooks              |
| Retries              | Up to 5 after a failure, exponential backoff, about 2.5, 5, 10, 20 and 40 minutes with jitter, about 80 minutes in all; a manual retry from the dashboard exists                                                                                                                                                  | Webhooks              |
| Timeout              | RevenueCat disconnects if the server has not finished responding in 60 seconds; the page recommends deferring work until after the response                                                                                                                                                                       | Webhooks              |
| Success              | HTTP 200. Any other status is a failure and is retried                                                                                                                                                                                                                                                            | Webhooks              |
| De-duplication       | The event `id`. Retries reuse the same `id` and `event_timestamp_ms`. Handling of `transaction_id` is not stated; two Stripe events can share one, so it identifies nothing                                                                                                                                       | Webhooks, Event types |
| Order                | **Not stated**                                                                                                                                                                                                                                                                                                    | Webhooks              |
| Environment filter   | The integration is configured for production, sandbox or both. The `environment` field comes from the store transaction type                                                                                                                                                                                      | Webhooks              |
| Secret rotation      | A "Rotate secret" button; the old secret is invalidated immediately; the secret is shown once. **No overlap of two valid secrets is offered**                                                                                                                                                                     | Webhooks              |
| IP allow list        | **Not stated**                                                                                                                                                                                                                                                                                                    | Webhooks              |

Adapter: both methods can be configured at once, and a request passes when it satisfies every method
that is configured. Because RevenueCat invalidates the old signing secret at once, a two-secret
window only helps the host when it rotates the secret in the dashboard and in its own configuration
in the order it chooses; the adapter accepts either of two configured values for each method.

## 6. Event kinds and fields

Event types (Event types and fields): `TEST`, `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`,
`UNCANCELLATION`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_PAUSED`, `EXPIRATION`, `BILLING_ISSUE`,
`PRODUCT_CHANGE`, `SUBSCRIPTION_EXTENDED`, `REFUND_REVERSED`, `INVOICE_ISSUANCE`, `TRANSFER`,
`TEMPORARY_ENTITLEMENT_GRANT`, `VIRTUAL_CURRENCY_TRANSACTION`, `EXPERIMENT_ENROLLMENT`,
`PURCHASE_REDEEMED`, `PRICE_INCREASE_CONSENT_REQUIRED`, `PRICE_INCREASE_CONSENT_APPROVED`, and the
deprecated `SUBSCRIBER_ALIAS` ("new projects don't receive it").

Semantics that matter (same page):

- `SUBSCRIPTION_PAUSED`: a pause is scheduled for the end of the current period (Google Play only);
  "Don't revoke access on this event"; revoke only on `EXPIRATION` with reason `SUBSCRIPTION_PAUSED`.
- `CANCELLATION`: a subscription or a non-renewing purchase was cancelled or refunded; for a
  subscription it fires only when the latest period is refunded; "auto-renewal may still be active
  after a refund".
- `BILLING_ISSUE`: a charge failed; the subscription has not necessarily expired.
- `PRODUCT_CHANGE`: the new product may not take effect immediately.
- `TRANSFER`: sent only to the destination user, with `transferred_from` and `transferred_to` arrays.
  It can accompany `PURCHASE_REDEEMED`.
- `TEMPORARY_ENTITLEMENT_GRANT`: a grant of at most 24 hours while the store cannot be validated.

Fields: `id`, `type`, `event_timestamp_ms`, `app_id`, `app_user_id` (last seen), `original_app_user_id`
(first), `aliases` (every identifier the subscriber has used; "search both `original_app_user_id`
and `aliases`"), `transferred_from`, `transferred_to`, `environment` (`SANDBOX` or `PRODUCTION`),
`store` (`AMAZON`, `APP_STORE`, `MAC_APP_STORE`, `PADDLE`, `PLAY_STORE`, `PROMOTIONAL`, `RC_BILLING`,
`ROKU`, `STRIPE`, `TEST_STORE`), `cancel_reason` (`UNSUBSCRIBE`, `BILLING_ERROR`,
`DEVELOPER_INITIATED`, `PRICE_INCREASE`, `CUSTOMER_SUPPORT`, `UNKNOWN`), `expiration_reason` (the same
plus `SUBSCRIPTION_PAUSED`), `entitlement_ids` (may be null), `product_id`, `transaction_id`,
`purchased_at_ms`, `expiration_at_ms`, `grace_period_expiration_at_ms`.

The event fields the adapter reads: `id`, `type`, `event_timestamp_ms`, `environment`,
`app_user_id`, `original_app_user_id`, `aliases`, `transferred_from`, `transferred_to`. No other field
of an event is read, and no state is taken from any of them.

## 7. Identity

From Identifying customers and Restore behavior:

- An App User ID is case-sensitive, scoped to a project, should not be longer than 100 characters,
  and an identifier containing `/` is blocked.
- An anonymous identifier starts with `$RCAnonymousID:`.
- After a merge `original_app_user_id` holds one identifier and the webhook's `aliases` lists the
  others; all merged identifiers return the same customer data through the API.
- The restore behaviour options are "Transfer to new App User ID" (the default), "Transfer if there
  are no active subscriptions", "Keep with original App User ID" and "Share between App User IDs
  (legacy)". Anonymous identifiers are aliased rather than transferred.

Sandbox access (Sandbox access): the project setting "Allow testing entitlements and in-app currency
for" has three values, "Anybody" (the default), "Allowed App User IDs only" and "Nobody". Under the
default every non-production purchase, a Test Store purchase included, grants access. How RevenueCat
tells a sandbox purchase from a production one is not stated.

## 8. Appendix A of the specification, row by row

Status: confirmed, changed, or not found, against the pages above.

| Row                                                              | Status                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.1 Authentication                                               | Confirmed: an optional authorization header, and the signature header with `t=` and `v1=`, HMAC-SHA256 over `<timestamp>.<raw body>`                                                                                                                                    |
| A.1 Signature per attempt                                        | Confirmed. The page also warns not to size the tolerance to the retry window; the five minutes of the specification is the page's example                                                                                                                               |
| A.1 Delivery                                                     | Confirmed at least once; order not stated                                                                                                                                                                                                                               |
| A.1 Retries                                                      | Confirmed: up to five, about 80 minutes                                                                                                                                                                                                                                 |
| A.1 Success                                                      | Confirmed: HTTP 200, any other status a failure                                                                                                                                                                                                                         |
| A.1 Time limit                                                   | Confirmed: disconnected after 60 seconds                                                                                                                                                                                                                                |
| A.1 De-duplication                                               | Confirmed: the event `id`, reused by retries                                                                                                                                                                                                                            |
| A.1 Recommended handling                                         | Not found on the pages read today as a statement; the adapter reads the source after every event regardless                                                                                                                                                             |
| A.1 Forward compatibility                                        | Not found as a sentence on the pages read today; the adapter tolerates unknown kinds and fields regardless                                                                                                                                                              |
| A.2 Event kinds                                                  | Confirmed: the twenty kinds and the deprecated alias event                                                                                                                                                                                                              |
| A.2 Pause, cancellation, billing issue, product change, transfer | Confirmed. `CANCELLATION` for a refund carries cancel reason `CUSTOMER_SUPPORT`: the cancel reason value exists on the page; that it marks a refund is the specification's statement and is **not stated** on the page. Transfer: only the destination user receives it |
| A.2 Environment                                                  | Confirmed: `SANDBOX` or `PRODUCTION`                                                                                                                                                                                                                                    |
| A.3 Status mapping                                               | Confirmed: the eight values of the subscription status                                                                                                                                                                                                                  |
| A.3 Renewal status                                               | Changed: the page lists two more values, `requires_price_increase_consent` and `has_already_renewed`; both map to `unknown` as "the others"                                                                                                                             |
| A.3 Store mapping                                                | Changed: the page lists `external`, `roku`, `galaxy` and `test_store` besides the stores of the table; they map to `other`, as the table says for every other value, and `paypal` is already in the table                                                               |
| A.4 What a server can do                                         | Not re-read in this phase; belongs to the management operations                                                                                                                                                                                                         |
| A.5 Identity                                                     | Confirmed. The limit of 100 characters is a "should not", and `/` is blocked                                                                                                                                                                                            |

Appendix A.6:

- **Version 1 deprecation**: resolved, no notice. The version 1 customers page carries no deprecation
  notice; the only deprecated item on it is the attribution endpoint (read 2026-11-25, API v1,
  customers).
- **A refund marker in version 2**: for a purchase, found: `status: refunded`. For a subscription:
  not found; the Subscription and data-model pages have none. Version 1 shows a `refunded_at` field
  only in sample responses, null, and does not define it.
- **How the customer endpoints report a non-renewing purchase**: resolved by section 4: through the
  purchases list and the active-entitlements list, with no access flag and no expiry on the purchase.
- **Delivery order**: not stated.

## 9. What the adapter does where a page is silent

Each item is a design decision of this library, not a RevenueCat fact, and is listed as an open
question in the specification where the owner may want another answer.

- The refund of a subscription is recognised when `gives_access` is false, `status` is `expired`,
  and `ends_at` is earlier than `current_period_ends_at`: access ended before the paid period did.
  The refund instant is `ends_at`. No fixture recorded from the sandbox shows it (the sandbox has no
  refundable purchase); the fixture is written from the documentation.
- A subscription whose flag says access is given, and whose period end has already passed, has an
  access-until of `null`: the end of a grace period is not stated. It is read again on every
  refresh, and the snapshot's age limit bounds how long it is trusted.
- The product reference is empty when `product_id` is null, and the billing interval is empty
  because the object has none.
- The source-updated-at is `null`: no object read carries a freshness field.
