/**
 * @fileoverview Pins that each published subpath resolves through its alias and exposes exactly
 * the names it should.
 * @layer e2e
 */
import * as core from '@bymax-one/nest-subscription'
import * as finance from '@bymax-one/nest-subscription/finance'
import * as internal from '@bymax-one/nest-subscription/internal'
import * as revenuecat from '@bymax-one/nest-subscription/revenuecat'
import * as shared from '@bymax-one/nest-subscription/shared'
import * as testing from '@bymax-one/nest-subscription/testing'

describe('entry points', () => {
  it('resolves each published subpath through its alias and exports no name', () => {
    // Scenario: a consumer imports the package root and each subpath; every alias must reach a
    // module of its own directory, and a name exported before its owning code exists would show
    // here and fail the case.
    for (const entry of [core, shared, internal, revenuecat, finance, testing]) {
      expect(Object.keys(entry)).toEqual([])
    }
  })
})
