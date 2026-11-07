// Desktop screenshots of key screens on the running dev app (demo data), for reviewing the UI.
// Usage: node scripts/ui-snapshots.mjs <outDir> [baseUrl]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'ui-snapshots';
const base = process.argv[3] ?? 'http://localhost:5173';
const pages = {
  'hr.manager@acme.test': ['/hr', '/hr/employees', '/hr/employees/:first', '/hr/leave/requests', '/hr/recruitment/jobs', '/hr/payroll/runs', '/hr/performance/cycles', '/hr/reports/headcount'],
  'employee@acme.test': ['/me', '/me/leave', '/me/attendance', '/me/payslips'],
  'admin@acme.test': ['/admin', '/admin/users', '/admin/roles'],
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [email, paths] of Object.entries(pages)) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Demo@Hrms2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  for (let path of paths) {
    if (path.includes(':first')) {
      await page.goto(`${base}/hr/employees`);
      await page.waitForLoadState('networkidle');
      await page.locator('#main table tbody tr').first().click();
      await page.waitForLoadState('networkidle');
      path = new URL(page.url()).pathname;
    } else {
      await page.goto(`${base}${path}`);
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(400);
    const name = `${email.split('@')[0]}${path.replace(/[/:]/g, '_')}`.replace(/_[0-9a-f-]{36}/, '_detail');
    await page.screenshot({ path: join(out, `${name}.png`) });
  }
  await context.close();
}
await browser.close();
console.log(`saved to ${out}`);
