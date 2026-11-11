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
  // Uploaded files never go to real storage from tests.
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || 'uploads-test';
  // No calls to the breached-password API; tests that need it stub the lookup.
  process.env.PASSWORD_BREACH_CHECK = 'false';
  process.env.METRICS_TOKEN = process.env.METRICS_TOKEN || 'test-metrics-token-0123456789';
  // Web Push is on in tests (the push service itself is stubbed); a throwaway key pair per run.
  if (!process.env.VAPID_PUBLIC_KEY) {
    const keys = require('web-push').generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  }
  // WhatsApp is on in tests with its sender stubbed (the log provider never calls out).
  process.env.WHATSAPP_PROVIDER = 'log';
  const dbName = process.env.DB_NAME || '';
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against non-test database "${dbName}"`);
  }
}

module.exports = { loadTestEnv };
