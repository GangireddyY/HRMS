require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_MIGRATION_USER || process.env.DB_USER, password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD, database: 'postgres' });
  await c.connect();
  const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = 'hrms_load'");
  if (exists.rowCount) {
    await c.query('DROP DATABASE hrms_load WITH (FORCE)');
    console.log('dropped old hrms_load');
  }
  await c.query('CREATE DATABASE hrms_load');
  console.log('created hrms_load');
  await c.end();
})().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
