#!/usr/bin/env node
/**
 * @fileoverview Consumer runtime gate: packs the tarball, lays it out the way npm would, and loads
 * every public entry point from it in ESM and in CommonJS.
 * @layer scripts
 *
 * Every other gate reads the source or the type declarations. This one inspects the artifact a
 * consumer installs, because a defect in how the entry points are *bundled* is invisible to all of
 * them.
 *
 * What it proves, per module format:
 *
 * 1. `./shared` loads with NO `@nestjs/*`, `rxjs`, `reflect-metadata` or `@bymax-one/nest-*`
 *    package resolvable: the model is usable from plain Node. A resolution of any denied
 *    namespace is turned into a hard error by a resolve hook and recorded, so the gate fails on
 *    the first request rather than on a log line.
 * 2. `.`, `./revenuecat`, `./finance` and `./testing` load with the NestJS peers available and
 *    neither optional peer (`@bymax-one/nest-cache`, `@bymax-one/nest-core`) resolvable: the
 *    library runs without them.
 * 3. Every entry exports the names its subpath promises.
 * 4. Every file the `exports` map names, the internal bundle included, is in the tarball, and the
 *    tarball holds nothing but `dist/` and the package's own documents.
 * 5. A positive control: a probe that asks for a denied specifier must FAIL, which proves the
 *    resolve hook can see a load and that the denials above are not vacuous.
 *
 * 6. Isolation of the adapters (NFR05): a probe that loads the root, or the root and one adapter,
 *    reads back every file the resolver handed out and fails when a file of an adapter that was not
 *    loaded is among them, in both module formats. The same probe fails when the record holds no
 *    file of what it did load, so an empty record cannot pass for an absence.
 *
 * 7. One error class: `SubscriptionError` is the same value from the root, from `./internal` and
 *    from `./shared`, and an error thrown by the model (`./shared`) or by the in-memory store
 *    (`./testing`) is an instance of the root's class, in each module format. Entry points are
 *    separate bundles, so a module reached from two of them by a relative path is copied into
 *    each and a copied class is a different class; the entry points reach `shared` by package
 *    specifier so that one copy exists.
 *
 * It shells out to `npm pack` and `tar`, both of which have to be on PATH. That is deliberate:
 * packing through npm itself is what makes the gate inspect the same tarball a publish would
 * produce, rather than a directory that resembles it.
 *
 * Usage: `node scripts/check-consumer-runtime.mjs` (run after `pnpm build`).
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
// Read from the manifest rather than hard-coded: this gate exists to inspect
// the packed artifact, so a rename must not leave it silently checking a
// package that no longer exists.
const packageName = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).name

// The consumer lives inside the repository so Node walks up to the repo's own
// `node_modules` for the peer dependencies. Nothing is installed and nothing is
// fetched; only the package under test comes from the tarball.
const consumerDir = join(rootDir, '.consumer-runtime-check')

/** The peers a host may leave out: the library runs without them. */
const OPTIONAL_PEERS = ['@bymax-one/nest-cache', '@bymax-one/nest-core']

/** The packages a host of the NestJS module provides and the `shared` subpath must not need. */
const FRAMEWORK = ['@nestjs/', 'rxjs', 'reflect-metadata']

/** Every runtime name of the `testing` subpath. */
const TESTING_EXPORTS = [
  'FakeSubscriptionSource',
  'InMemorySubscriptionStore',
  'ManualClock',
  'storeConformanceCases'
]

/** Every runtime name of the root entry point. */
const ROOT_EXPORTS = [
  'SECRET_PLACEHOLDER',
  'SUBSCRIPTION_CACHE',
  'SUBSCRIPTION_CLOCK',
  'SUBSCRIPTION_ERROR_CODES',
  'SUBSCRIPTION_OBSERVER',
  'SUBSCRIPTION_OPTIONS',
  'SUBSCRIPTION_SOURCE',
  'SUBSCRIPTION_STORE',
  'Secret',
  'SubscriptionError',
  'SubscriptionModule',
  'SubscriptionService',
  'encodeAccountKey',
  'resolveOptions',
  'validateOptions'
]

/** Every runtime name of the `shared` subpath: the closed value sets, the error codes
 * and the pure functions of the model. */
const SHARED_EXPORTS = [
  'CHANGE_KINDS',
  'SUBSCRIPTION_ENVIRONMENTS',
  'SUBSCRIPTION_ERROR_CODES',
  'SUBSCRIPTION_ORIGINS',
  'SUBSCRIPTION_STATUSES',
  'SubscriptionError',
  'WILL_RENEW_VALUES',
  'createEmptySnapshot',
  'parseInstant',
  'resolveEntitlements'
]

/** The directories of the build, as they appear in a resolved file URL. */
const CORE_DIR = '/dist/core/'
const INTERNAL_DIR = '/dist/internal/'
const REVENUECAT_DIR = '/dist/revenuecat/'
const FINANCE_DIR = '/dist/finance/'

/**
 * The probes: which subpaths load together, which namespaces are denied and what is exported.
 * `expectDenied` marks a positive control: the probe must FAIL because the resolve hook fired,
 * which proves the denial can see a load.
 */
const PROBES = [
  {
    label: 'shared without NestJS, its companions or either optional peer',
    deny: [...FRAMEWORK, ...OPTIONAL_PEERS],
    entries: { './shared': SHARED_EXPORTS }
  },
  {
    label: 'root, adapters and testing without either optional peer',
    deny: OPTIONAL_PEERS,
    entries: {
      '.': ROOT_EXPORTS,
      './revenuecat': [],
      './finance': [],
      './testing': TESTING_EXPORTS
    },
    // The error class of the root is the one the internal bundle defines, so a class thrown by an
    // adapter that imports the bundle is an instance of the root's.
    same: [
      [
        ['.', 'SubscriptionError'],
        ['./internal', 'SubscriptionError']
      ]
    ]
  },
  {
    label: 'one error class across the root, internal, shared and testing',
    deny: OPTIONAL_PEERS,
    entries: { '.': ROOT_EXPORTS, './shared': SHARED_EXPORTS },
    same: [
      [
        ['.', 'SubscriptionError'],
        ['./shared', 'SubscriptionError']
      ],
      [
        ['./internal', 'SubscriptionError'],
        ['./shared', 'SubscriptionError']
      ]
    ],
    // Each thrower raises an error that must be an instance of the root's class.
    thrown: [
      ['shared resolveEntitlements', '.'],
      ['testing markEventProcessed', '.']
    ]
  },
  // NFR05: an adapter the host did not configure loads none of its code. Each probe loads the root
  // and at most one adapter, and reads back which files the resolver handed out.
  {
    label: 'root alone loads neither adapter',
    deny: OPTIONAL_PEERS,
    entries: { '.': ROOT_EXPORTS },
    loaded: [CORE_DIR, INTERNAL_DIR],
    notLoaded: [REVENUECAT_DIR, FINANCE_DIR]
  },
  {
    label: 'root and the RevenueCat adapter load no file of the Finance adapter',
    deny: OPTIONAL_PEERS,
    entries: { '.': ROOT_EXPORTS, './revenuecat': [] },
    loaded: [CORE_DIR, REVENUECAT_DIR],
    notLoaded: [FINANCE_DIR]
  },
  {
    label: 'root and the Finance adapter load no file of the RevenueCat adapter',
    deny: OPTIONAL_PEERS,
    entries: { '.': ROOT_EXPORTS, './finance': [] },
    loaded: [CORE_DIR, FINANCE_DIR],
    notLoaded: [REVENUECAT_DIR]
  },
  {
    label: 'positive control: a load of a denied specifier is seen',
    deny: [`${packageName}/shared`],
    entries: { './shared': SHARED_EXPORTS },
    expectDenied: true
  }
]

/** Resolve hook shared by both module formats (`registerHooks` covers `require` too). */
const denyHook = `import { registerHooks } from 'node:module'
const deny = JSON.parse(process.env.DENY_PREFIXES ?? '[]')
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (deny.some((prefix) => specifier.startsWith(prefix))) {
      const error = new Error('denied resolution of ' + specifier)
      error.code = 'ERR_DENIED_BY_RUNTIME_GATE'
      throw error
    }
    const resolved = nextResolve(specifier, context)
    ;(globalThis.__resolvedUrls ??= []).push(resolved.url)
    return resolved
  }
})
`

const probeBody = (format) => `
const ENTRIES = JSON.parse(process.env.PROBE_ENTRIES)
const load = (specifier) => ${format === 'ESM' ? 'import(specifier)' : 'Promise.resolve(require(specifier))'}
const specifierOf = (subpath) => '${packageName}' + subpath.slice(1)

// Each thrower makes one part of the library raise its error for an invalid instant.
const THROWERS = {
  'shared resolveEntitlements': async () => {
    const { resolveEntitlements } = await load(specifierOf('./shared'))
    resolveEntitlements([{ accessUntil: 'not a date' }], new Map())
  },
  'testing markEventProcessed': async () => {
    const { InMemorySubscriptionStore } = await load(specifierOf('./testing'))
    await new InMemorySubscriptionStore({ logger: () => undefined }).markEventProcessed('s', 'e', 'x')
  }
}

async function run() {
  const failures = []
  for (const [subpath, names] of Object.entries(ENTRIES)) {
    const loaded = await load(specifierOf(subpath))
    const present = Object.keys(loaded).filter((name) => name !== 'default' && name !== '__esModule')
    const absent = names.filter((name) => !present.includes(name))
    const extra = present.filter((name) => !names.includes(name))
    if (absent.length > 0) failures.push(subpath + ' does not export: ' + absent.join(', '))
    if (extra.length > 0) failures.push(subpath + ' exports more than it promises: ' + extra.join(', '))
  }
  // A name that two entry points both reach must be one value, or an instanceof check across them
  // would fail in a host that mixes them.
  for (const [[subpathA, nameA], [subpathB, nameB]] of JSON.parse(process.env.PROBE_SAME ?? '[]')) {
    const first = (await load(specifierOf(subpathA)))[nameA]
    const second = (await load(specifierOf(subpathB)))[nameB]
    if (first === undefined || first !== second) {
      failures.push(subpathA + ' ' + nameA + ' is not the same value as ' + subpathB + ' ' + nameB)
    }
  }
  // The files that were loaded, as the resolve hook saw them. A fragment that must be absent proves
  // an adapter the host did not configure loaded none of its code; a fragment that must be present
  // proves the record sees a load, so an empty record cannot pass for an absence.
  const loadedFiles = globalThis.__resolvedUrls ?? []
  for (const fragment of JSON.parse(process.env.PROBE_LOADED ?? '[]')) {
    if (!loadedFiles.some((url) => url.includes(fragment))) {
      failures.push('no file under ' + fragment + ' was loaded, so the record of loaded files proves nothing')
    }
  }
  for (const fragment of JSON.parse(process.env.PROBE_NOT_LOADED ?? '[]')) {
    const leaked = loadedFiles.filter((url) => url.includes(fragment))
    if (leaked.length > 0) failures.push('files under ' + fragment + ' were loaded: ' + leaked.join(', '))
  }
  for (const [thrower, subpath] of JSON.parse(process.env.PROBE_THROWN ?? '[]')) {
    const expected = (await load(specifierOf(subpath))).SubscriptionError
    let caught
    try {
      await THROWERS[thrower]()
    } catch (error) {
      caught = error
    }
    if (expected === undefined || !(caught instanceof expected)) {
      failures.push(thrower + ' does not raise an instance of the SubscriptionError of ' + subpath)
    }
  }
  return failures
}
`

const esmProbe = `${probeBody('ESM')}
try {
  const failures = await run()
  if (failures.length > 0) {
    for (const failure of failures) console.error('  ✗ ESM: ' + failure)
    process.exit(1)
  }
  console.log('  ✓ ESM: loaded, exports as expected')
} catch (error) {
  console.error('  ✗ ESM: ' + (error && error.code ? error.code + ' ' : '') + (error && error.message))
  process.exit(1)
}
`
// In CommonJS the loaded set is also read back from `require.cache`, so the proof does not rest
// on the resolve hook alone.
const cjsProbe = `${probeBody('CJS')}
run()
  .then((failures) => {
    const DENY = JSON.parse(process.env.DENY_PREFIXES ?? '[]')
    const leaked = Object.keys(require.cache).filter((file) =>
      DENY.some((prefix) => file.includes('node_modules/' + prefix))
    )
    if (leaked.length > 0) failures.push('require.cache holds denied modules: ' + leaked.join(', '))
    if (failures.length > 0) {
      for (const failure of failures) console.error('  ✗ CJS: ' + failure)
      process.exit(1)
    }
    console.log('  ✓ CJS: loaded, exports as expected')
  })
  .catch((error) => {
    console.error('  ✗ CJS: ' + (error && error.code ? error.code + ' ' : '') + (error && error.message))
    process.exit(1)
  })
`

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
}

function cleanup() {
  rmSync(consumerDir, { recursive: true, force: true })
}

/** The members a published tarball may hold: the build and the documents the manifest names. */
const ALLOWED_TARBALL_PATHS = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'dist/']

/** The members of `tarball`, without the `package/` prefix npm adds, that are not allowed. */
function unexpectedMembers(tarball) {
  return run('tar', ['-tzf', tarball])
    .split('\n')
    .map((line) => line.replace(/^package\//, '').trim())
    .filter((line) => line !== '' && line !== 'package')
    .filter(
      (line) =>
        !ALLOWED_TARBALL_PATHS.some((allowed) => line === allowed || line.startsWith(allowed))
    )
}

/** Every file path the `exports` map names, flattened from its nested conditions. */
function exportTargets(value) {
  if (typeof value === 'string') return [value]
  return Object.values(value).flatMap(exportTargets)
}

/** The files the manifest's `exports` map names that the unpacked package does not hold. */
function missingExportTargets(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  return exportTargets(manifest.exports).filter((target) => !existsSync(join(packageDir, target)))
}

/**
 * Loads `shared` from the tarball in a directory that holds nothing but the package: no NestJS, no
 * companion library and no `node_modules` above it. A file that imports only this subpath must
 * load there in both module formats. Returns whether it did.
 */
function standaloneSharedLoads(tarball) {
  const dir = mkdtempSync(join(tmpdir(), 'nest-subscription-standalone-'))
  console.log('  shared alone, in a directory with no @nestjs package')
  try {
    const packageDir = join(dir, 'node_modules', packageName)
    mkdirSync(packageDir, { recursive: true })
    run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])
    if (existsSync(join(dir, 'node_modules', '@nestjs'))) {
      console.error('  ✗ the scratch directory holds @nestjs')
      return false
    }
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'standalone-shared-check', private: true, version: '0.0.0', type: 'module' })}\n`
    )
    writeFileSync(join(dir, 'probe.mjs'), esmProbe)
    writeFileSync(join(dir, 'probe.cjs'), cjsProbe)
    for (const file of ['probe.mjs', 'probe.cjs']) {
      process.stdout.write(
        run('node', [file], {
          cwd: dir,
          env: { ...process.env, PROBE_ENTRIES: JSON.stringify({ './shared': SHARED_EXPORTS }) }
        })
      )
    }
    return true
  } catch (error) {
    process.stdout.write(error.stdout ?? '')
    process.stderr.write(String(error.stderr ?? error.message))
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The lines of a built `shared` file that import or require a module: there must be none. */
function runtimeImportsOf(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => /^\s*import\b|\brequire\(|^\s*export\b.*\bfrom\b/.test(line))
}

console.log('Consumer runtime gate')

// With `PACKAGE_TARBALL` the gate inspects that file, so a working tree without `dist/` is fine.
if (!process.env['PACKAGE_TARBALL'] && !existsSync(join(rootDir, 'dist'))) {
  console.error('✗ dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

cleanup()
const packDir = mkdtempSync(join(tmpdir(), 'nest-subscription-pack-'))
let failed = false

try {
  // `PACKAGE_TARBALL` names the tarball a release gate has already packed, so the file inspected
  // here is the file that is published. Without it the gate packs one itself.
  let tarball = process.env['PACKAGE_TARBALL']
  if (tarball === undefined || tarball === '') {
    // `--ignore-scripts` keeps `prepublishOnly` from rebuilding underneath the
    // artifact this gate is meant to inspect.
    // The tarball is located by reading the directory it was packed into, not by
    // parsing `npm pack`'s stdout: inside a publish, npm writes notices around the
    // filename. The directory is freshly created and holds exactly one archive.
    // `npm_config_dry_run` is cleared for the child: a `npm publish --dry-run`
    // pre-flight exports it, the nested pack inherits it, and a dry pack writes no file.
    const packEnv = { ...process.env }
    delete packEnv['npm_config_dry_run']
    // `cwd: rootDir`: the package to pack is this repository's, whatever directory
    // the script was invoked from.
    run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', packDir], {
      cwd: rootDir,
      env: packEnv
    })
    const packed = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
    if (packed.length !== 1) {
      throw new Error(`expected one tarball in ${packDir}, found ${packed.length}`)
    }
    tarball = join(packDir, packed[0])
  }

  const packageDir = join(consumerDir, 'node_modules', packageName)
  mkdirSync(packageDir, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])

  const unexpected = unexpectedMembers(tarball)
  if (unexpected.length > 0) {
    console.error(
      `  ✗ the tarball holds files outside dist/ and the documents: ${unexpected.join(', ')}`
    )
    failed = true
  } else {
    console.log('  ✓ the tarball holds only dist/ and the package documents')
  }

  const missing = missingExportTargets(packageDir)
  if (missing.length > 0) {
    console.error(`  ✗ the tarball lacks files the exports map names: ${missing.join(', ')}`)
    failed = true
  } else {
    console.log('  ✓ every file the exports map names is in the tarball')
  }

  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'consumer-runtime-check', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`
  )
  const sharedImports = ['index.mjs', 'index.cjs'].flatMap((name) =>
    runtimeImportsOf(join(packageDir, 'dist', 'shared', name))
  )
  if (sharedImports.length > 0) {
    console.error(`  ✗ the built shared files import a module: ${sharedImports.join(' | ')}`)
    failed = true
  } else {
    console.log('  ✓ the built shared files import nothing at run time')
  }
  if (!standaloneSharedLoads(tarball)) failed = true

  writeFileSync(join(consumerDir, 'deny.mjs'), denyHook)
  writeFileSync(join(consumerDir, 'probe.mjs'), esmProbe)
  writeFileSync(join(consumerDir, 'probe.cjs'), cjsProbe)

  for (const probe of PROBES) {
    console.log(`  ${probe.label}`)
    for (const file of ['probe.mjs', 'probe.cjs']) {
      try {
        const output = run('node', ['--import', './deny.mjs', file], {
          cwd: consumerDir,
          env: {
            ...process.env,
            DENY_PREFIXES: JSON.stringify(probe.deny),
            PROBE_ENTRIES: JSON.stringify(probe.entries),
            PROBE_SAME: JSON.stringify(probe.same ?? []),
            PROBE_THROWN: JSON.stringify(probe.thrown ?? []),
            PROBE_LOADED: JSON.stringify(probe.loaded ?? []),
            PROBE_NOT_LOADED: JSON.stringify(probe.notLoaded ?? [])
          }
        })
        if (probe.expectDenied) {
          console.error(`  ✗ ${file}: the positive control passed, so the denial cannot see a load`)
          failed = true
        } else {
          process.stdout.write(output)
        }
      } catch (error) {
        const stderr = String(error.stderr ?? '')
        if (probe.expectDenied && stderr.includes('ERR_DENIED_BY_RUNTIME_GATE')) {
          console.log(`  ✓ ${file}: the denial fired, as the control requires`)
          continue
        }
        process.stdout.write(error.stdout ?? '')
        process.stderr.write(stderr)
        failed = true
      }
    }
  }
} catch (error) {
  console.error(`✗ gate setup failed: ${error.message}`)
  if (error.stderr) process.stderr.write(error.stderr)
  failed = true
} finally {
  cleanup()
  rmSync(packDir, { recursive: true, force: true })
}

if (failed) {
  console.error('\n✗ The published artifact does not work for a consumer.')
  process.exit(1)
}

console.log('✓ Every entry point loads in ESM and CommonJS under its dependency denials.')
