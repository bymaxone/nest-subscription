/**
 * @fileoverview The entitlements that sandbox activity of a customer also grants. The customer's
 * active-entitlements list spans both environments and names no grantor, so while sandbox access
 * is not allowed an entitlement that a sandbox subscription giving access or an owned sandbox
 * purchase also grants cannot be told apart from the same entitlement granted in production, and
 * is no evidence for a production purchase. A sandbox grantor that gives no access, a
 * subscription whose flag is false or a purchase that is refunded, grants nothing and contests
 * nothing. A grantor is matched by the entitlement's identifier, and by its name when the grantor
 * gives no identifier.
 * @layer revenuecat
 */
import type { SubscriptionEnvironment } from '@bymax-one/nest-subscription/shared'

import type { ParsedEntitlement } from './parse-customer'

/** A subscription or purchase of the customer, as the contest sees it. */
export interface Grantor {
  /** Where it was bought; a value the source did not state is read as sandbox. */
  readonly environment: SubscriptionEnvironment
  /** Whether the source says it gives access: a subscription's flag, a purchase being owned. */
  readonly givesAccess: boolean
  /** The entitlements it grants, complete. */
  readonly entitlements: readonly ParsedEntitlement[]
}

/** The identifiers and the names of the entitlements that sandbox activity grants. */
export interface Contested {
  /** The identifiers of the entitlements a sandbox grantor names. */
  readonly ids: ReadonlySet<string>
  /** The names of the entitlements a sandbox grantor names without an identifier. */
  readonly names: ReadonlySet<string>
}

/** Nothing is contested: sandbox access is allowed, or no sandbox grantor exists. */
export const NOTHING_CONTESTED: Contested = { ids: new Set(), names: new Set() }

/**
 * What sandbox activity of the customer contests: the entitlements of the grantors that are in the
 * sandbox and give access.
 *
 * @param grantors Every subscription and purchase of the customer.
 */
export function contestedBy(grantors: readonly Grantor[]): Contested {
  const granted = grantors
    .filter((grantor) => grantor.environment === 'sandbox' && grantor.givesAccess)
    .flatMap((grantor) => grantor.entitlements)
  return {
    ids: new Set(granted.flatMap(({ id }) => (id === null ? [] : [id]))),
    names: new Set(granted.flatMap(({ id, name }) => (id === null ? [name] : [])))
  }
}

/** Whether a sandbox grantor also grants the entitlement. */
export function isContested(contested: Contested, entitlement: ParsedEntitlement): boolean {
  return (
    (entitlement.id !== null && contested.ids.has(entitlement.id)) ||
    contested.names.has(entitlement.name)
  )
}
