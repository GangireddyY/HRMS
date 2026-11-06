const { execSync } = require('node:child_process');
const path = require('node:path');
const { loadTestEnv } = require('./load-test-env');

/** Applies migrations to the test database once before the integration suite. */
module.exports = async () => {
  loadTestEnv();
  execSync('npx ts-node --transpile-only src/database/migrate.ts up', {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
};
