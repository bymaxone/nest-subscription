/**
 * @fileoverview Pins what counts as a tenant: a present identifier that is not blank.
 * @layer core
 */
import { hasTenant } from './tenant'

describe('hasTenant', () => {
  it.each([
    ['a name', 'acme', true],
    ['a name with spaces around it', ' acme ', true],
    ['nothing', undefined, false],
    ['the empty string', '', false],
    ['blanks', ' \t\n', false]
  ])('answers for %s', (_name, tenantId, expected) => {
    // Scenario: each shape of tenant identifier a caller can pass.
    expect(hasTenant(tenantId)).toBe(expected)
  })
})
