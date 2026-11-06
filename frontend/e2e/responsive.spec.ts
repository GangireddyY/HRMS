import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { credentials } from './env';
import { expectNoHorizontalOverflow, primaryNav, signIn } from './helpers';

const { orgAdmin, superAdmin } = credentials();

const ORG_ADMIN_PAGES = [
  '/admin',
  '/admin/organization',
  '/admin/structure',
  '/admin/holidays',
  '/admin/users',
  '/admin/roles',
  '/admin/audit-logs',
  '/admin/login-history',
  '/hr',
  '/hr/employees',
  '/hr/employees/new',
  '/hr/attendance',
  '/hr/attendance/regularizations',
  '/hr/attendance/closing',
  '/hr/attendance/shifts',
  '/me',
  '/me/attendance',
  '/me/profile',
  '/me/security',
  '/me/appearance',
  '/me/notifications',
];

const PLATFORM_PAGES = ['/platform', '/platform/organizations', '/platform/plans', '/platform/audit-logs'];

/** Pages scroll inside <main>, so the viewport is grown temporarily to capture the whole page. */
async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const viewport = page.viewportSize()!;
  const height = await page.evaluate<number>("document.querySelector('#main')?.scrollHeight ?? document.documentElement.scrollHeight");
  await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(height + 80, viewport.height), 6000) });
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  await page.setViewportSize(viewport);
}

async function checkPage(page: Page, testInfo: TestInfo, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, path.replace(/\//g, '_').replace(/^_/, '') || 'root');
}

test.describe('responsive layout', () => {
  test('public pages fit the screen', async ({ page }, testInfo) => {
    for (const path of ['/login', '/forgot-password', '/register']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
      await capture(page, testInfo, path.slice(1));
    }
  });

  test('organization pages fit the screen', async ({ page }, testInfo) => {
    // Walks many pages in one session (one sign-in keeps the auth rate limit out of the picture).
    test.setTimeout(120_000);
    await signIn(page, orgAdmin.email, orgAdmin.password);
    for (const path of ORG_ADMIN_PAGES) await checkPage(page, testInfo, path);

    await page.goto('/admin/roles');
    await page.getByText('HR Manager', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'HR Manager' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, 'role-detail');
  });

  test('platform pages fit the screen', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await signIn(page, superAdmin.email, superAdmin.password);
    for (const path of PLATFORM_PAGES) await checkPage(page, testInfo, path);
  });

  test('dark mode with the dark sidebar fits the screen', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      localStorage.setItem('hrms.theme', 'dark');
      localStorage.setItem('hrms.sidebar', 'dark');
    });
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'dark');
    for (const path of ['/admin', '/admin/users', '/admin/organization', '/me/security']) {
      await checkPage(page, testInfo, path);
    }
  });

  test('navigation drawer opens, navigates and closes on small screens', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 1024, 'the sidebar is always visible on large screens');
    await signIn(page, orgAdmin.email, orgAdmin.password);

    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(nav).toBeHidden();
    await (await primaryNav(page)).getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(nav).toBeHidden();

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(nav).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
  });
});
