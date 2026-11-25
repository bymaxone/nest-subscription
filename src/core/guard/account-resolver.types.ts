/**
 * @fileoverview The contract of the resolver a host supplies so the guard knows which account a
 * request belongs to. The guard takes the account from this contract alone, never from a request
 * body, a query string or a header it reads itself.
 * @layer core
 */
import type { ExecutionContext } from '@nestjs/common'

/** The account a request belongs to, as the host's resolver names it. */
export interface ResolvedAccount {
  /** The account identifier. */
  readonly accountId: string
  /** The tenant of the account; absent when the host is not multi-tenant. */
  readonly tenantId?: string | undefined
}

/**
 * Gives the guard the account of a request. It returns `null` for a request that carries no
 * account, which the guard refuses as unauthenticated. It may answer synchronously or with a
 * promise. A resolver that throws never grants access, and neither does one that returns anything
 * other than a {@link ResolvedAccount} with a non-blank identifier.
 */
export type AccountResolver = (
  context: ExecutionContext
) => ResolvedAccount | null | Promise<ResolvedAccount | null>
