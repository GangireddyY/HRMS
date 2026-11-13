/** Unit tests: colocated *.spec.ts files under src/. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  // Ratchet: set at the current level; raise as unit tests are added, never lower.
  coverageThreshold: { global: { statements: 19, branches: 8, functions: 10, lines: 19 } },
};
