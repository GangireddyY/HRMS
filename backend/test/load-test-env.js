const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads backend/.env.test into process.env (overriding) and refuses to run against a database
 * whose name does not contain "test", so integration tests can never wipe a real database.
 * In CI the variables may be provided by the environment instead of a file.
 */
function loadTestEnv() {
  const file = path.join(__dirname, '..', '.env.test');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      process.env[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
    }
  }
  process.env.NODE_ENV = 'test';
  const dbName = process.env.DB_NAME || '';
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against non-test database "${dbName}"`);
  }
}

module.exports = { loadTestEnv };
