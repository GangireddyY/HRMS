/** API integration tests: real HTTP stack + real PostgreSQL test database. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/setup-env.js'],
  globalSetup: '<rootDir>/global-setup.js',
  testTimeout: 60000,
  // Coverage of the application code exercised through the API (`npm run test:e2e:cov`), measured by V8 over the
  // files the app loads (it loads every module at start-up); instrumenting through ts-jest is far too slow.
  coverageProvider: 'v8',
  coveragePathIgnorePatterns: ['/node_modules/', '/test/', '/src/database/migrations/', '/src/database/demo-extras', '\\.spec\\.ts$'],
  coverageDirectory: '../coverage-e2e',
};
