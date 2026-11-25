/**
 * @fileoverview Pins the test support the adapter's specs share: that it serves a fixture at the
 * paths the adapter reads and nowhere else, so a spec built on it cannot pass for a wrong path.
 * @layer revenuecat
 */
import { fixtureFetch, loadFixture, type FetchCall } from './revenuecat.fixture'

const BASE = 'http://127.0.0.1:9/v2/projects/p/customers/c'

describe('fixtureFetch', () => {
  it('serves the lists of a fixture at the customer paths and records each request', async () => {
    // Scenario: the three lists the adapter reads, each answered with 200 and the fixture's body.
    const calls: FetchCall[] = []
    const stub = fixtureFetch('lifetime-purchase', calls)
    for (const [segment, field] of [
      ['subscriptions', 'subscriptions'],
      ['purchases', 'purchases'],
      ['active_entitlements', 'activeEntitlements']
    ] as const) {
      const response = await stub(`${BASE}/${segment}`, { method: 'GET' })
      expect(response.status).toBe(200)
      expect(await response.json()).toStrictEqual(
        Reflect.get(loadFixture('lifetime-purchase'), field)
      )
    }
    expect(calls).toHaveLength(3)
  })

  it.each(['/other', '/subscriptions/s/entitlements', '/purchases/x'])(
    'answers 404 for the path %s, which no fixture serves',
    async (path) => {
      // Scenario: a request the fixture does not serve is not found, so a wrong path fails a spec.
      const response = await fixtureFetch('active-subscription')(`${BASE}${path}`, {
        method: 'GET'
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toStrictEqual({})
    }
  )

  it('answers 404 for a list the fixture does not hold', async () => {
    // Scenario: a fixture without a list is not found for it.
    const response = await fixtureFetch('appendix-a3')(`${BASE}/subscriptions`, { method: 'GET' })
    expect(response.status).toBe(404)
  })

  it('answers every list with the status and the error of a fixture that has one', async () => {
    // Scenario: the fixture of an unknown customer is a 404 with RevenueCat's error body.
    const response = await fixtureFetch('unknown-customer')(`${BASE}/purchases`, { method: 'GET' })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ type: 'resource_missing' })
  })
})
