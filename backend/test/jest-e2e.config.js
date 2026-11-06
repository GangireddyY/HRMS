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
};
