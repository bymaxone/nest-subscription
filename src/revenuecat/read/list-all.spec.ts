/**
 * @fileoverview Tests of the list reader: where the cursor of the next request comes from, that
 * the `next_page` address is never requested, and that a list that cannot be read to its end is a
 * failed read.
 * @layer revenuecat
 */
import { Secret } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { RevenueCatHttp } from '../revenuecat-http'

import { MAX_PAGES, PAGE_LIMIT, listAll } from './list-all'

/** A client over a stub that answers each call with the next page of the script. */
function scripted(pages: readonly unknown[]): {
  readonly http: RevenueCatHttp
  readonly urls: string[]
} {
  const urls: string[] = []
  const http = new RevenueCatHttp({
    baseUrl: 'http://127.0.0.1:9/v2',
    apiKey: new Secret('k'),
    timeoutMs: 1000,
    fetch: (url) => {
      urls.push(url)
      return Promise.resolve(new Response(JSON.stringify(pages[urls.length - 1])))
    }
  })
  return { http, urls }
}

/** The `starting_after` of a requested address, or `null`. */
function cursorOf(url: string | undefined): string | null {
  return new URL(url ?? '').searchParams.get('starting_after')
}

describe('listAll', () => {
  it('takes the cursor from the query of next_page, not from the last item', async () => {
    // Scenario: the page names its own cursor, which differs from the item's field; it wins, and
    // the next request is built from the base address, not from the next_page address.
    const { http, urls } = scripted([
      {
        items: [{ entitlement_id: 'item-field' }],
        next_page: 'https://elsewhere.invalid/v2/x?starting_after=from-next-page&limit=1'
      },
      { items: [{ entitlement_id: 'last' }], next_page: null }
    ])
    expect(await listAll(http, '/path', 'entitlement_id')).toHaveLength(2)
    expect(urls).toStrictEqual([
      `http://127.0.0.1:9/v2/path?limit=${PAGE_LIMIT}`,
      `http://127.0.0.1:9/v2/path?limit=${PAGE_LIMIT}&starting_after=from-next-page`
    ])
  })

  it('falls back to the cursor field of the last item when next_page has no cursor', async () => {
    // Scenario: a next_page with no query still lets the list continue from the last item.
    const { http, urls } = scripted([
      { items: [{ id: 'a' }, { id: 'b' }], next_page: 'https://elsewhere.invalid/v2/x' },
      { items: [], next_page: null }
    ])
    await listAll(http, '/path', 'id')
    expect(cursorOf(urls[1])).toBe('b')
  })

  it('continues from next_page when the page has no items', async () => {
    // Scenario: an empty page that still names a next page carries its cursor in the address.
    const { http, urls } = scripted([
      { items: [], next_page: '/v2/x?starting_after=resume' },
      { items: [{ id: 'z' }], next_page: null }
    ])
    expect(await listAll(http, '/path', 'id')).toStrictEqual([{ id: 'z' }])
    expect(cursorOf(urls[1])).toBe('resume')
  })

  it('fails as unavailable when no cursor can be found for a further page', async () => {
    // Scenario: next_page has no cursor and the last item lacks the cursor field.
    const { http } = scripted([{ items: [{ other: 1 }], next_page: '/v2/x' }])
    await expect(listAll(http, '/path', 'id')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
  })

  it('fails as unavailable when a later page is not a list', async () => {
    // Scenario: an answer that is no list envelope ends the read as a failure.
    const { http } = scripted([{ items: [{ id: 'a' }], next_page: '/v2/x?starting_after=a' }, 'no'])
    await expect(listAll(http, '/path', 'id')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
  })

  it('fails as unavailable when the list runs past the page bound', async () => {
    // Scenario: a list that never ends is refused rather than read without limit.
    const page = { items: [{ id: 'a' }], next_page: '/v2/x?starting_after=a' }
    const { http, urls } = scripted(Array.from({ length: MAX_PAGES + 1 }, () => page))
    await expect(listAll(http, '/path', 'id')).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(urls).toHaveLength(MAX_PAGES)
  })
})
