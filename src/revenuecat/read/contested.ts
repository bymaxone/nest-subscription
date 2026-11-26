/**
 * @fileoverview The entitlements that sandbox activity of a customer also grants. The customer's
 * active-entitlements list spans both environments and names no grantor, so while sandbox access
 * is not allowed an entitlement a sandbox subscription or purchase also grants cannot be told
 * apart from the same entitlement granted in production, and is no evidence for a production
 * purchase. A grantor is matched by the entitlement's identifier, and by its name when the grantor
 * gives no identifier.
 * @layer revenuecat
 */
import type { ParsedEntitlement } from './parse-customer'

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
 * What the entitlements of sandbox subscriptions and purchases contest.
 *
 * @param sandboxEntitlements The entitlements every sandbox subscription and purchase of the
 *   customer grants, whatever its status or access flag.
 */
export function contestedBy(sandboxEntitlements: readonly ParsedEntitlement[]): Contested {
  return {
    ids: new Set(sandboxEntitlements.flatMap(({ id }) => (id === null ? [] : [id]))),
    names: new Set(sandboxEntitlements.flatMap(({ id, name }) => (id === null ? [name] : [])))
  }
}

/** Whether a sandbox grantor also grants the entitlement. */
export function isContested(contested: Contested, entitlement: ParsedEntitlement): boolean {
  return (
    (entitlement.id !== null && contested.ids.has(entitlement.id)) ||
    contested.names.has(entitlement.name)
  )
}
