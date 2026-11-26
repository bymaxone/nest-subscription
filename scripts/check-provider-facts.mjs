#!/usr/bin/env node
/**
 * @fileoverview Provider watch: fetches the RevenueCat pages `docs/revenuecat-facts.md` cites and
 * compares what can be compared mechanically with what the facts file records, so a change on the
 * provider's side shows up as a report and not as a failure in production.
 * @layer scripts
 *
 * What is compared:
 *
 * - Every cited page still answers. A page that moved or went away is a change.
 * - The event types of the webhook page equal the event types the facts file lists.
 * - The statuses of the subscription data model equal the statuses the facts file lists.
 * - The stores of the webhook page equal the stores the facts file lists.
 *
 * What is not: prose. The facts file also records sentences about behaviour (retry timing, what a
 * header is called, which operation exists for which store) that no script can compare. A report
 * from this script is a prompt to re-read the pages, not a verdict, and a clean run is not proof
 * that nothing else moved.
 *
 * A page that answers but no longer has the shape the comparison reads (no event types found, no
 * status enumeration) is a change too: a comparison that finds nothing to compare must not pass.
 *
 * The script sends plain unauthenticated GET requests to public documentation pages. It sends no
 * credential, no repository detail, no account identifier and no cookie, and it follows no link
 * but the cited pages.
 *
 * Usage: `node scripts/check-provider-facts.mjs` prints what it found and exits 1 when something
 * moved, 2 when it could not run.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** How long one page may take. */
const TIMEOUT_MS = 20_000

/** The pages whose content is compared, by the name the facts file gives them. */
const EVENT_PAGE = 'Event types and fields'
const MODEL_PAGE = 'Subscription data model'

/**
 * The pages the facts file cites, each with its name and address.
 *
 * @param {string} facts - The text of `docs/revenuecat-facts.md`.
 * @returns {{ name: string, url: string }[]} The cited pages, in the order of the file.
 */
export function citedPages(facts) {
  const section = /\nPages:\n\n([\s\S]*?)\n\n/.exec(facts)
  if (section === null) throw new Error('The facts file has no list of pages.')
  return [...section[1].matchAll(/^- (.+?): (https:\/\/\S+)$/gm)].map((match) => ({
    name: match[1],
    url: match[2]
  }))
}

/** The backticked tokens of a text that match a pattern, in order, without repeats. */
function tokens(text, pattern) {
  const found = [...text.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((t) => pattern.test(t))
  return [...new Set(found)]
}

/**
 * The event types, statuses and stores the facts file records.
 *
 * @param {string} facts - The text of `docs/revenuecat-facts.md`.
 */
export function recordedFacts(facts) {
  const events = /\nEvent types \([^)]*\):([\s\S]*?)\n\n/.exec(facts)
  const status = /^\| `status` +\| (`trialing`[^|]*)\|/m.exec(facts)
  const stores = /\(`AMAZON`[^)]*`TEST_STORE`\)/.exec(facts)
  return {
    events: events === null ? [] : tokens(events[1], /^[A-Z][A-Z_]+$/),
    statuses: status === null ? [] : tokens(status[1], /^[a-z][a-z_]+$/),
    stores: stores === null ? [] : tokens(stores[0], /^[A-Z][A-Z_]+$/)
  }
}

/** The event types a webhook page lists, from its bullet list of bold backticked names. */
export function pageEventTypes(page) {
  return [...new Set([...page.matchAll(/^- \*\*`([A-Z][A-Z_]+)`\*\*/gm)].map((match) => match[1]))]
}

/** The statuses a data model page lists, from the first enumeration of `status`. */
export function pageStatuses(page) {
  const line = /^- `status` \(required\): string Enum: ([^\n]*?) —/m.exec(page)
  return line === null ? [] : [...line[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1])
}

/** The stores a webhook page lists, from the row that describes the `store` field. */
export function pageStores(page) {
  const row = /^\| `store` +\| String +\| ([^|]*)\|/m.exec(page)
  return row === null ? [] : tokens(row[1], /^[A-Z][A-Z_]+$/)
}

/** What differs between the recorded values and the page's, as sentences. */
function differences(label, recorded, onPage) {
  if (onPage.length === 0) {
    return [
      `${label}: the page no longer has the shape the comparison reads, so nothing was compared.`
    ]
  }
  const added = onPage.filter((value) => !recorded.includes(value))
  const removed = recorded.filter((value) => !onPage.includes(value))
  return [
    ...(added.length === 0
      ? []
      : [`${label}: on the page and not in the facts file: ${added.join(', ')}.`]),
    ...(removed.length === 0
      ? []
      : [`${label}: in the facts file and not on the page: ${removed.join(', ')}.`])
  ]
}

/** One page as text, asking for the Markdown form the site offers; `null` with why it failed. */
async function readPage(fetchPage, url) {
  try {
    const response = await fetchPage(url, {
      headers: {
        accept: 'text/markdown, text/html;q=0.5',
        'user-agent': 'nest-subscription-provider-watch'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow'
    })
    if (!response.ok) return { failure: `answered HTTP ${String(response.status)}` }
    return { text: await response.text() }
  } catch {
    return { failure: 'could not be fetched' }
  }
}

/**
 * Runs the whole comparison.
 *
 * @param {string} facts - The text of `docs/revenuecat-facts.md`.
 * @param {typeof fetch} fetchPage - The `fetch` to call; a test passes a stub.
 * @returns {Promise<{ problems: string[], pages: number }>} Every difference found.
 */
export async function compareWithProvider(facts, fetchPage) {
  const pages = citedPages(facts)
  const recorded = recordedFacts(facts)
  const problems = []
  const texts = new Map()
  for (const page of pages) {
    const read = await readPage(fetchPage, page.url)
    if (read.failure === undefined) texts.set(page.name, read.text)
    else problems.push(`${page.name} (${page.url}) ${read.failure}.`)
  }
  const events = texts.get(EVENT_PAGE)
  if (events !== undefined) {
    problems.push(...differences('Event types', recorded.events, pageEventTypes(events)))
    problems.push(...differences('Stores of the webhook', recorded.stores, pageStores(events)))
  }
  const model = texts.get(MODEL_PAGE)
  if (model !== undefined) {
    problems.push(...differences('Subscription statuses', recorded.statuses, pageStatuses(model)))
  }
  return { problems, pages: pages.length }
}

/** Reads the facts file, compares it with the provider and reports. */
async function main() {
  const facts = readFileSync(join(ROOT, 'docs', 'revenuecat-facts.md'), 'utf8')
  const { problems, pages } = await compareWithProvider(facts, fetch)
  if (problems.length === 0) {
    console.log(
      `Provider facts: ${String(pages)} cited pages read; event types, statuses and stores match.`
    )
    return 0
  }
  console.log(`Provider facts moved (${String(problems.length)}):`)
  for (const problem of problems) console.log(`- ${problem}`)
  console.log('Re-read the pages named above and update docs/revenuecat-facts.md and the adapter.')
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main().catch(() => 2))
}
