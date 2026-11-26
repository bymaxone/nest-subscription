/**
 * @fileoverview Tests of the provider watch with pages made from the facts file itself, so the
 * recorded values are the ones compared: a page that matches reports nothing, and each kind of
 * change (an added or removed value, a page that went away, a page whose shape changed) is
 * reported, never passed over.
 * @layer scripts
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  citedPages,
  compareWithProvider,
  pageEventTypes,
  pageStatuses,
  pageStores,
  recordedFacts
} from './check-provider-facts.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FACTS = readFileSync(join(ROOT, 'docs', 'revenuecat-facts.md'), 'utf8')
const RECORDED = recordedFacts(FACTS)
const EVENT_URL = citedPages(FACTS).find((page) => page.name === 'Event types and fields')?.url
const MODEL_URL = citedPages(FACTS).find((page) => page.name === 'Subscription data model')?.url

/** The webhook page as the site writes it, for the given event types and stores. */
function eventPage(events, stores) {
  const bullets = events.map((type) => `- **\`${type}\`** — what it means.`).join('\n')
  const row = `| \`store\` | String | Store the purchase belongs to: ${stores.map((s) => `\`${s}\``).join(', ')} | Sometimes |`
  return `${bullets}\n\n${row}\n`
}

/** The data model page for the given statuses. */
function modelPage(statuses) {
  const list = statuses.map((status) => `"${status}"`).join(' ')
  return `- \`status\` (required): string Enum: ${list} — The status of a subscription.\n`
}

/** A `fetch` that answers each cited page with the text given for its address, or a status. */
function pages(overrides = {}) {
  const answers = new Map([
    [EVENT_URL, eventPage(RECORDED.events, RECORDED.stores)],
    [MODEL_URL, modelPage(RECORDED.statuses)],
    ...Object.entries(overrides)
  ])
  return (url) => {
    const answer = answers.get(url) ?? 'a page the comparison does not read'
    if (answer instanceof Error) return Promise.reject(answer)
    if (typeof answer === 'number') return Promise.resolve(new Response('', { status: answer }))
    return Promise.resolve(new Response(answer))
  }
}

describe('the facts file', () => {
  it('lists its pages, and the event types, statuses and stores it records', () => {
    // Scenario: the parsers read the real file, so a change to its layout fails here first.
    assert.ok(citedPages(FACTS).length >= 15)
    assert.ok(RECORDED.events.includes('INITIAL_PURCHASE') && RECORDED.events.length >= 20)
    assert.ok(RECORDED.statuses.includes('in_grace_period') && RECORDED.statuses.length === 8)
    assert.ok(RECORDED.stores.includes('PLAY_STORE') && RECORDED.stores.length === 10)
  })

  it('refuses a file with no list of pages', () => {
    // Scenario: a facts file the script cannot read is an error and never an empty pass.
    assert.throws(() => citedPages('# nothing'), /no list of pages/)
  })
})

describe('the page readers', () => {
  it('read nothing from text of another shape', () => {
    // Scenario: HTML, or a page rewritten, gives empty lists, which the comparison reports.
    assert.deepEqual(pageEventTypes('<html>INITIAL_PURCHASE</html>'), [])
    assert.deepEqual(pageStatuses('<html>"active"</html>'), [])
    assert.deepEqual(pageStores('<html>`APP_STORE`</html>'), [])
  })
})

describe('the comparison with the provider', () => {
  it('reports nothing when every page answers and every list matches', async () => {
    // Scenario: the provider says what the facts file says.
    const result = await compareWithProvider(FACTS, pages())
    assert.deepEqual(result.problems, [])
    assert.equal(result.pages, citedPages(FACTS).length)
  })

  it('reports an event type that is new, and one that is gone', async () => {
    // Scenario: one type added on the page and one dropped from it.
    const events = [...RECORDED.events.slice(1), 'BRAND_NEW_EVENT']
    const { problems } = await compareWithProvider(
      FACTS,
      pages({ [EVENT_URL]: eventPage(events, RECORDED.stores) })
    )
    assert.deepEqual(problems, [
      'Event types: on the page and not in the facts file: BRAND_NEW_EVENT.',
      `Event types: in the facts file and not on the page: ${RECORDED.events[0]}.`
    ])
  })

  it('reports a status and a store that changed', async () => {
    // Scenario: a status removed and a store added.
    const { problems } = await compareWithProvider(
      FACTS,
      pages({
        [EVENT_URL]: eventPage(RECORDED.events, [...RECORDED.stores, 'NEW_STORE']),
        [MODEL_URL]: modelPage(RECORDED.statuses.slice(1))
      })
    )
    assert.deepEqual(problems, [
      'Stores of the webhook: on the page and not in the facts file: NEW_STORE.',
      `Subscription statuses: in the facts file and not on the page: ${RECORDED.statuses[0]}.`
    ])
  })

  it('reports an HTTP failure as a change, and a page with no answer apart from it', async () => {
    // Scenario: one page is gone (404), one fails to connect, and the rest still compare.
    const urls = citedPages(FACTS).map((page) => page.url)
    const { problems, unreachable } = await compareWithProvider(
      FACTS,
      pages({ [urls[0]]: 404, [urls[2]]: new Error('connection refused') })
    )
    assert.equal(problems.length, 1)
    assert.match(problems[0], /answered HTTP 404\.$/)
    assert.equal(unreachable.length, 1)
    assert.ok(!(problems.join(' ') + unreachable.join(' ')).includes('connection refused'))
  })

  it('reports a page whose shape changed instead of passing it', async () => {
    // Scenario: both compared pages answer, but with nothing the readers can find.
    const { problems } = await compareWithProvider(
      FACTS,
      pages({ [EVENT_URL]: '<html>new design</html>', [MODEL_URL]: '<html>new design</html>' })
    )
    assert.equal(problems.length, 3)
    for (const problem of problems) assert.match(problem, /no longer has the shape/)
  })
})

describe('the exit code of the script', () => {
  /** Runs the script with `fetch` replaced by the given source text, and returns its status. */
  function exitCodeWith(fetchSource) {
    const preload = `data:text/javascript,${encodeURIComponent(`globalThis.fetch = ${fetchSource}`)}`
    const run = spawnSync(
      process.execPath,
      ['--import', preload, join(ROOT, 'scripts', 'check-provider-facts.mjs')],
      { encoding: 'utf8' }
    )
    return run.status
  }

  it('is 2, never 1, when a page cannot be reached at all', () => {
    // Scenario: the network is down. Nothing was compared, so the run must not report that the
    // facts moved (exit 1 opens an issue); it reports that it could not compare (exit 2).
    assert.equal(exitCodeWith("() => Promise.reject(new TypeError('offline'))"), 2)
  })

  it('stays 1 when a page answers with a failing HTTP status', () => {
    // Scenario: the provider answered, and what it answered is a change (a page that went away).
    assert.equal(exitCodeWith("() => Promise.resolve(new Response('', { status: 404 }))"), 1)
  })
})
