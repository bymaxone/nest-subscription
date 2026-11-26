/**
 * @fileoverview The sentinel sweep checks itself: a leak planted in a log line, an observer
 * payload, a response body or an error message is found and named without repeating its value; a
 * sentinel a spec plants on purpose is not searched for; and what the sweep records while a spec
 * runs is what the library logged, sent and threw.
 * @layer e2e
 */
// The sweep is loaded first: it replaces the error constructor, and a class that extends `Error`
// binds the constructor it finds when it is defined, so the library must be loaded after it. Under
// the end-to-end configuration it is already loaded by `setupFilesAfterEnv`; under the combined
// configuration this import is what loads it.
import { recorded } from './setup/sentinel-sweep'
import { Logger } from '@nestjs/common'
import request from 'supertest'
import { validateOptions } from '@bymax-one/nest-subscription'

import { buildGuardedApp } from './fixtures/guarded-app'
import { declaredSentinels, emptyRecording, findLeaks } from './setup/sweep-core'

const LEAK = 'sentinel-planted-in-this-spec-9f2c'

describe('sentinel sweep', () => {
  it('finds a sentinel in a log line and names the place without repeating the value', () => {
    // Scenario: a log line with an identifier, planted among clean ones, is found by position.
    const recording = { ...emptyRecording(), lines: ['fine', `refreshed ${LEAK}`] }
    const leaks = findLeaks(recording, ['sentinel-other', LEAK])
    expect(leaks).toStrictEqual([{ place: 'log line', index: 1, sentinel: 1 }])
    expect(JSON.stringify(leaks)).not.toContain(LEAK)
  })

  it('finds a sentinel nested in an observer payload, in a response body and in an error message', () => {
    // Scenario: one planted value in each remaining kind of output is found in its own kind.
    const recording = {
      lines: [],
      payloads: [{ method: 'onRefresh', payload: { deep: [new Map([['k', LEAK]])] } }],
      bodies: ['{"ok":true}', `{"account":"${LEAK}"}`],
      errors: [`failed for ${LEAK}`]
    }
    expect(findLeaks(recording, [LEAK]).map((leak) => [leak.place, leak.index])).toStrictEqual([
      ['response body', 1],
      ['error message', 0],
      ['observer payload', 0]
    ])
  })

  it('finds nothing in a clean recording and refuses an empty sentinel', () => {
    // Scenario: a clean run passes, and an empty sentinel, which matches everything, is refused.
    const clean = { ...emptyRecording(), lines: ['a fixed sentence'], errors: ['a code'] }
    expect(findLeaks(clean, [LEAK])).toStrictEqual([])
    expect(() => findLeaks(clean, [''])).toThrow('may not be empty')
  })

  it('searches for every sentinel the specs declare and for none they plant on purpose', () => {
    // Scenario: the list is read from the specs and fixtures, so a new sentinel needs no list.
    const declared = declaredSentinels()
    expect(declared).toContain('sentinel-account-7f3a')
    expect(declared).toContain('sentinel-parity-api-key-1a2b')
    expect(declared).not.toContain('sentinel-planted')
    expect(declared).toStrictEqual([...new Set(declared)].sort())
  })

  it('records what the library logs, sends and throws while a spec runs', async () => {
    // Scenario: a framework log line, an HTTP response of a framework application and an error the
    // library's own code builds are all recorded, so the search at the end has something to read.
    const before = {
      lines: recorded().lines.length,
      bodies: recorded().bodies.length,
      errors: recorded().errors.length
    }
    new Logger('sweep').warn('a recorded line')
    const built = await buildGuardedApp()
    const response = await request(built.app.getHttpServer()).get('/premium')
    expect(response.status).toBe(401)
    await built.app.close()
    expect(() => validateOptions({})).toThrow()
    expect(recorded().lines.length).toBeGreaterThan(before.lines)
    expect(recorded().bodies.length).toBeGreaterThan(before.bodies)
    expect(recorded().errors.length).toBeGreaterThan(before.errors)
    expect(recorded().lines.some((line) => line.includes('a recorded line'))).toBe(true)
  })
})
