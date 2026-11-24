import { defineConfig } from 'tsup'

// One bundle per published subpath, plus the internal bundle the others import by package
// specifier. Every entry shares the same output shape; only the entry file differs.
const common = {
  format: ['esm', 'cjs'] as ('esm' | 'cjs')[],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  outExtension: ({ format }: { format: string }): { js: string } => ({
    js: format === 'esm' ? '.mjs' : '.cjs'
  }),
  // Peers are never bundled: a bundled copy would be a second instance of the package the host
  // already loaded (a different injection token). The internal bundle is external for the same
  // reason: a class copied into two bundles is two injection tokens and two `instanceof` targets,
  // so every entry point reaches it by package specifier and resolves one instance. The `shared`
  // subpath is external to every other bundle for the same reason: it defines the error class.
  external: [
    /^@nestjs\//,
    /^@bymax-one\/nest-cache/,
    /^@bymax-one\/nest-core/,
    /^@bymax-one\/nest-subscription\/internal$/,
    /^@bymax-one\/nest-subscription\/shared$/,
    'reflect-metadata',
    'rxjs'
  ],
  target: 'node26' as const,
  clean: false,
  splitting: false,
  treeshake: true,
  sourcemap: false
}

export default defineConfig([
  { ...common, entry: { 'core/index': 'src/core/index.ts' } },
  { ...common, entry: { 'shared/index': 'src/shared/index.ts' } },
  { ...common, entry: { 'internal/index': 'src/internal/index.ts' } },
  { ...common, entry: { 'revenuecat/index': 'src/revenuecat/index.ts' } },
  { ...common, entry: { 'finance/index': 'src/finance/index.ts' } },
  { ...common, entry: { 'testing/index': 'src/testing/index.ts' } }
])
