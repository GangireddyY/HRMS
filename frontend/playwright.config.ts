import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';
import { loadApiTestEnv } from './e2e/env';

const apiEnv = loadApiTestEnv();
const webEnv = loadEnv('e2e', fileURLToPath(new URL('.', import.meta.url)), '');
const API_PORT = apiEnv.PORT ?? '3001';
const WEB_PORT = webEnv.DEV_SERVER_PORT ?? '5174';

/**
 * End-to-end tests against the real stack: built backend (NODE_ENV=test with backend/.env.test, test database)
 * + Vite dev server in `e2e` mode (frontend/.env.e2e). Prerequisite: `npm run build -w @hrms/backend`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Every spec runs at desktop, tablet and phone sizes (all Chromium, so CI installs a single browser).
  projects: [
    // Creates the Organization Admin through sign-up before any spec runs (organizations are not seeded).
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] }, dependencies: ['setup'] },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, dependencies: ['setup'] },
  ],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: { ...apiEnv, NODE_ENV: 'test' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npx vite --mode e2e',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
