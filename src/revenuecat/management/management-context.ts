/**
 * @fileoverview What the RevenueCat management operations need from the adapter, and the two small
 * rules every one of them shares: how a failed request is named, and what a record the source
 * cannot act on is answered with.
 * @layer revenuecat
 */
import type { ManagedRecord, OperationResult } from '@bymax-one/nest-subscription/internal'

import { unavailableIfUnknown } from '../read/read-context'
import type { RevenueCatHttp } from '../revenuecat-http'

/** The clients and the project the operations use. */
export interface RevenueCatManagementContext {
  /** The client of version 2 of the REST API. */
  readonly http: RevenueCatHttp
  /** The client of version 1, for the operations that exist only there. */
  readonly httpV1: RevenueCatHttp
  /** The RevenueCat project. */
  readonly projectId: string
}

/**
 * Runs one request of an operation. A failure is the source being unavailable: the customer is
 * known and the record came from the account's own snapshot, so a 404 is not an unknown account.
 * Nothing of the response or the request reaches the error.
 */
export async function attempt<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (error) {
    throw unavailableIfUnknown(error)
  }
}

/** The management reference a record carries: a subscription's, and none for a purchase. */
export function referenceOf(target: ManagedRecord): string | null {
  return target.kind === 'subscription' ? target.record.managementReference : null
}

/** The answer for a record a server cannot act on: the person does, at the management reference. */
export function personMustAct(target: ManagedRecord): OperationResult {
  return { outcome: 'customer_action_required', managementReference: referenceOf(target) }
}

/** What an operation answers once the source took its request. */
export const ACCEPTED: OperationResult = { outcome: 'accepted' }
