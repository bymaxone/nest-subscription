/**
 * @fileoverview Reads a RevenueCat list to its end. The next request is built from the base
 * address and a cursor, never from the `next_page` address the response carries, so a response
 * cannot send the adapter, and its credential, to another host. The cursor is the `starting_after`
 * value in the query string of `next_page`, which is what the API itself asks for next; only when
 * `next_page` carries none is it the cursor field of the last item. The number of
 * pages is bounded, and a list that cannot be read to its end is a failed read: an incomplete
 * list could hide a subscription that gives access.
 * @layer revenuecat
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import type { RevenueCatHttp } from '../revenuecat-http'
import { isRecord, parseList, readString } from './parse-customer'
import { unavailableIfUnknown } from './read-context'

/** How many items one request asks for. The API clamps the value to its own limit. */
export const PAGE_LIMIT = 100

/** The most pages read from one list; a customer with more than this many pages is refused. */
export const MAX_PAGES = 50

/** One page of a list; a page after the first that is not found is a source that cannot be read. */
async function getPage(
  http: RevenueCatHttp,
  path: string,
  query: Readonly<Record<string, string>>,
  page: number
): Promise<unknown> {
  try {
    return await http.get(path, query)
  } catch (error) {
    throw page === 0 ? error : unavailableIfUnknown(error)
  }
}

/**
 * Reads every item of a list. A page after the first that the source answers as not found is a
 * list that cannot be read to its end, not an unknown customer.
 *
 * @param http The client.
 * @param path The path of the list, with every identifier already encoded.
 * @param cursorKey The field of the last item whose value is the cursor of the next request when
 *   `next_page` carries no `starting_after`.
 * @throws SubscriptionError with the source-unavailable code when a response is not a list, an
 *   item that must give the cursor has none, or the list runs past {@link MAX_PAGES} pages; and
 *   whatever the client throws.
 */
export async function listAll(
  http: RevenueCatHttp,
  path: string,
  cursorKey: string
): Promise<readonly unknown[]> {
  const items: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: Record<string, string> = { limit: String(PAGE_LIMIT) }
    if (cursor !== null) query['starting_after'] = cursor
    const parsed = parseList(await getPage(http, path, query, page))
    if (parsed === null) break
    items.push(...parsed.items)
    if (!parsed.hasMore) return items
    const last: unknown = parsed.items.at(-1)
    cursor = parsed.nextCursor ?? (isRecord(last) ? readString(last, cursorKey) : null)
    if (cursor === null) break
  }
  throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
}
