/**
 * @fileoverview The one rule that says whether an account reference names a tenant, shared by the
 * service and by reconciliation so a multi-tenant configuration refuses the same references in both.
 * @layer core
 */

/** Whether a tenant identifier names a tenant: it is present and not blank. */
export function hasTenant(tenantId: string | undefined): boolean {
  return tenantId !== undefined && tenantId.trim().length > 0
}
