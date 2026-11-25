/**
 * @fileoverview A billing source built the way an adapter factory builds one: the fake source
 * with a credential held in a `Secret` on a public, enumerable field. Sweeping an object that
 * holds this source therefore reaches the secret, so a sweep that finds no sentinel is not vacuous.
 * @layer e2e
 */
import { Secret } from '@bymax-one/nest-subscription'
import { FakeSubscriptionSource } from '@bymax-one/nest-subscription/testing'

import { ROTATED_SENTINEL, WEBHOOK_SENTINEL } from './sentinel-sweep'

/** The fake source with a rotation pair held in `credential`. */
export function credentialedSource(): FakeSubscriptionSource & { readonly credential: Secret } {
  return Object.assign(new FakeSubscriptionSource(), {
    credential: new Secret(WEBHOOK_SENTINEL, ROTATED_SENTINEL)
  })
}
