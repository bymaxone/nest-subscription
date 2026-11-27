/**
 * @fileoverview Tests the environment the API surface check gives its nested `npm pack`: a
 * `npm publish --dry-run` exports `npm_config_dry_run`, and a pack that inherits it writes no file.
 * @layer scripts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { packEnvironment } from './check-api-surface.mjs'

test('the nested pack does not inherit the dry run of a publish', () => {
  const env = { npm_config_dry_run: 'true', PATH: '/usr/bin' }
  const packed = packEnvironment(env)
  assert.equal('npm_config_dry_run' in packed, false)
  assert.equal(packed['PATH'], '/usr/bin')
})

test('the environment it is given is left as it was', () => {
  const env = { npm_config_dry_run: 'true' }
  packEnvironment(env)
  assert.deepEqual(env, { npm_config_dry_run: 'true' })
})
