import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // A unit spec opens no socket: the resolver refuses `supertest` and the setup stops `listen`, for
  // a spec under `src/` only, whatever way the spec spells it.
  resolver: '<rootDir>/../scripts/jest-no-sockets.resolver.cjs',
  setupFilesAfterEnv: ['<rootDir>/../scripts/jest-no-sockets.setup.cjs'],
  // Mirror the subpath aliases declared in tsconfig.json "paths" so that tests
  // exercise the exact same import specifiers that consumers and the tsup
  // bundler use. Without this, tests would need relative imports while build
  // uses package specifiers — an easy source of drift.
  moduleNameMapper: {
    '^@bymax-one/nest-subscription$': '<rootDir>/core/index.ts',
    '^@bymax-one/nest-subscription/shared$': '<rootDir>/shared/index.ts',
    '^@bymax-one/nest-subscription/internal$': '<rootDir>/internal/index.ts',
    '^@bymax-one/nest-subscription/revenuecat$': '<rootDir>/revenuecat/index.ts',
    '^@bymax-one/nest-subscription/finance$': '<rootDir>/finance/index.ts',
    '^@bymax-one/nest-subscription/testing$': '<rootDir>/testing/index.ts'
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../tsconfig.jest.json'
      }
    ]
  },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/*.test.ts',
    '!**/__tests__/**',
    '!**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  coverageReporters: ['text', 'lcov', 'clover'],
  clearMocks: true,
  restoreMocks: true,
  // Only skip "no tests" error in local dev — CI must always have tests
  passWithNoTests: false
}

export default config
