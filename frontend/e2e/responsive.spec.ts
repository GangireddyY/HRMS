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
  '/hr/attendance/regularizations?tab=wfh',
  '/hr/attendance/regularizations?tab=overtime',
  '/hr/attendance/roster',
  '/hr/attendance/devices',
  '/hr/org-chart',
  '/hr/documents/expiring',
  '/hr/recruitment/requisitions',
  '/hr/recruitment/jobs',
  '/hr/recruitment/candidates',
  '/hr/onboarding',
  '/hr/onboarding/probation',
  '/hr/onboarding/checklists',
  '/hr/leave/requests',
  '/hr/leave/calendar',
  '/hr/leave/balances',
  '/hr/leave/types',
  '/hr/payroll/runs',
  '/hr/payroll/salaries',
  '/hr/payroll/reimbursements',
  '/hr/payroll/loans',
  '/hr/payroll/setup',
  '/hr/performance/reviews',
  '/hr/performance/cycles',
  '/hr/performance/pips',
  '/hr/training/courses',
  '/hr/training/team',
  '/hr/training/skills',
  '/hr/engagement/announcements',
  '/hr/engagement/surveys',
  '/hr/engagement/suggestions',
  '/hr/grievances',
  '/hr/benefits/plans',
  '/hr/benefits/enrollments',
  '/hr/compliance/policies',
  '/hr/compliance/calendar',
  '/hr/exits',
  '/hr/alumni',
  '/hr/reports',
  '/hr/reports/headcount',
  '/hr/reports/attrition',
  '/hr/reports/leave',
  '/hr/reports/payroll-cost',
  '/hr/reports/recruitment',
  '/me',
  '/me/attendance',
  '/me/leave',
  '/me/onboarding',
  '/me/interviews',
  '/me/payslips',
  '/me/salary',
  '/me/reimbursements',
  '/me/loans',
  '/me/performance',
  '/me/training',
  '/me/skills',
  '/me/training/catalog',
  '/me/engagement',
  '/me/engagement/suggestions',
  '/me/grievances',
  '/me/benefits',
  '/me/policies',
  '/me/exit',
  '/me/employment',
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

async function checkCurrent(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalOverflow(page);
  await capture(page, testInfo, name);
}

async function checkPage(page: Page, testInfo: TestInfo, path: string): Promise<void> {
  await page.goto(path);
  await checkCurrent(page, testInfo, path.replace(/[/?=&]/g, '_').replace(/^_/, '') || 'root');
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
    test.setTimeout(300_000);
    await signIn(page, orgAdmin.email, orgAdmin.password);
    for (const path of ORG_ADMIN_PAGES) await test.step(path, () => checkPage(page, testInfo, path));

    await page.goto('/admin/roles');
    await page.getByText('HR Manager', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'HR Manager' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, 'role-detail');
  });

  test('recruitment detail and careers pages fit the screen', async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/recruitment/jobs');
    const careers = await page.getByRole('link', { name: 'Careers page' }).getAttribute('href');
    const job = page.getByRole('row').filter({ hasText: 'Open' }).first();
    test.skip(!(await job.isVisible().catch(() => false)), 'needs an open job (created by recruitment.spec.ts)');
    await job.click();
    await expect(page).toHaveURL(/\/hr\/recruitment\/jobs\/[0-9a-f-]+$/);
    await checkCurrent(page, testInfo, 'recruitment-job');
    const card = page.locator('#main section li button').first();
    if (await card.isVisible()) {
      await card.click();
      await expect(page).toHaveURL(/\/hr\/recruitment\/applications\//);
      await checkCurrent(page, testInfo, 'recruitment-application');
    }
    await page.goto('/hr/recruitment/candidates');
    await page.getByRole('row').nth(1).click();
    await expect(page).toHaveURL(/\/hr\/recruitment\/candidates\/[0-9a-f-]+$/);
    await checkCurrent(page, testInfo, 'recruitment-candidate');

    const visitor = await browser.newPage({ viewport: page.viewportSize()! });
    await visitor.goto(careers!);
    await checkCurrent(visitor, testInfo, 'careers');
    await visitor.getByRole('link').first().click();
    await expect(visitor.getByRole('button', { name: 'Send application' })).toBeVisible();
    await checkCurrent(visitor, testInfo, 'careers-job');
    await visitor.close();
  });

  test('payroll run page fits the screen', async ({ page }, testInfo) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/payroll/runs');
    await page.waitForLoadState('networkidle');
    const run = page.getByRole('row').nth(1);
    test.skip(!(await run.isVisible().catch(() => false)) || (await run.textContent())?.includes('No payroll runs'), 'needs a payroll run (created by payroll.spec.ts)');
    await run.click();
    await expect(page).toHaveURL(/\/hr\/payroll\/runs\/[0-9a-f-]+$/);
    await checkCurrent(page, testInfo, 'payroll-run');
  });

  test('performance detail pages fit the screen', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/performance/cycles');
    await page.waitForLoadState('networkidle');
    const cycle = page.getByRole('row').filter({ hasText: /Closed|In progress/ }).first();
    test.skip(!(await cycle.isVisible().catch(() => false)), 'needs a launched cycle (created by performance.spec.ts)');
    await cycle.click();
    await expect(page).toHaveURL(/\/hr\/performance\/cycles\/[0-9a-f-]+$/);
    await expect(page.getByText('Rating distribution')).toBeVisible();
    await checkCurrent(page, testInfo, 'performance-cycle');
    const cycleUrl = page.url();
    await page.goto(`${cycleUrl}/hikes`);
    await expect(page.getByRole('heading', { name: 'Salary increases' })).toBeVisible();
    await checkCurrent(page, testInfo, 'performance-hikes');
    await page.getByRole('button', { name: 'Guidelines' }).click();
    await expect(page.getByRole('dialog', { name: 'Merit guidelines' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await capture(page, testInfo, 'performance-hike-guidelines');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.goto(cycleUrl);
    const review = page.locator('#main table tbody tr').first();
    if (await review.isVisible()) {
      await review.click();
      await expect(page).toHaveURL(/\/hr\/performance\/reviews\//);
      await checkCurrent(page, testInfo, 'performance-review');
    }
    await page.goto('/hr/performance/pips');
    await page.getByRole('combobox', { name: 'Filter by status' }).click();
    await page.getByRole('option', { name: 'Completed successfully' }).click();
    const pip = page.locator('#main table tbody tr').first();
    if (await pip.isVisible()) {
      await pip.click();
      await expect(page).toHaveURL(/\/hr\/performance\/pips\//);
      await checkCurrent(page, testInfo, 'performance-pip');
    }
  });

  test('training course page fits the screen', async ({ page }, testInfo) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/training/courses');
    await page.waitForLoadState('networkidle');
    const course = page.getByRole('row').filter({ hasText: 'Classroom' }).first();
    test.skip(!(await course.isVisible().catch(() => false)), 'needs a classroom course (created by training.spec.ts)');
    await course.click();
    await expect(page).toHaveURL(/\/hr\/training\/courses\/[0-9a-f-]+$/);
    await expect(page.getByText('Roster')).toBeVisible();
    await checkCurrent(page, testInfo, 'training-course');
  });

  test('survey builder and results fit the screen', async ({ page }, testInfo) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/engagement/surveys');
    await page.getByRole('button', { name: 'New survey' }).click();
    await expect(page.getByRole('dialog', { name: 'New survey' }).getByLabel('Question 1', { exact: true })).toBeVisible();
    await checkCurrent(page, testInfo, 'survey-builder');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForLoadState('networkidle');
    const results = page.getByRole('button', { name: 'Results' }).first();
    test.skip(!(await results.isVisible().catch(() => false)), 'needs an opened survey (created by engagement.spec.ts)');
    await results.click();
    await expect(page).toHaveURL(/\/hr\/engagement\/surveys\/[0-9a-f-]+$/);
    await expect(page.getByText('Response rate')).toBeVisible();
    await checkCurrent(page, testInfo, 'survey-results');
  });

  test('grievance form and case page fit the screen', async ({ page }, testInfo) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/me/grievances');
    await page.getByRole('button', { name: 'Raise a grievance' }).click();
    await expect(page.getByRole('dialog', { name: 'Raise a grievance' }).getByLabel('What happened?')).toBeVisible();
    await checkCurrent(page, testInfo, 'grievance-form');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.goto('/hr/grievances');
    await page.getByRole('combobox', { name: /^Filter by status/ }).click();
    await page.getByRole('option', { name: 'Closed', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: /GRV-\d{4}/ }).first();
    const found = await row.waitFor({ state: 'visible', timeout: 8000 }).then(
      () => true,
      () => false,
    );
    test.skip(!found, 'needs a closed grievance (created by grievance.spec.ts)');
    await row.click();
    await expect(page).toHaveURL(/\/hr\/grievances\/[0-9a-f-]+$/);
    await expect(page.getByText('Timeline')).toBeVisible();
    await checkCurrent(page, testInfo, 'grievance-case');
  });

  test('benefit plan form and plan page fit the screen', async ({ page }, testInfo) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/benefits/plans');
    await page.getByRole('button', { name: 'New plan' }).click();
    await expect(page.getByRole('dialog', { name: 'New benefit plan' }).getByLabel('Plan name')).toBeVisible();
    await checkCurrent(page, testInfo, 'benefit-plan-form');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: 'Group health' }).first();
    const found = await row.waitFor({ state: 'visible', timeout: 8000 }).then(
      () => true,
      () => false,
    );
    test.skip(!found, 'needs a plan (created by benefits.spec.ts)');
    await row.click();
    await expect(page).toHaveURL(/\/hr\/benefits\/plans\/[0-9a-f-]+$/);
    await expect(page.getByText('Coverage options')).toBeVisible();
    await checkCurrent(page, testInfo, 'benefit-plan');
  });

  test('policy page fits the screen', async ({ page }, testInfo) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/compliance/policies');
    const row = page.getByRole('row').filter({ hasText: 'Acceptable use policy' }).first();
    const found = await row.waitFor({ state: 'visible', timeout: 8000 }).then(
      () => true,
      () => false,
    );
    test.skip(!found, 'needs a policy (created by compliance.spec.ts)');
    await row.click();
    await expect(page).toHaveURL(/\/hr\/compliance\/policies\/[0-9a-f-]+$/);
    await expect(page.getByText(/Version \d+ \(in force\)/)).toBeVisible();
    await checkCurrent(page, testInfo, 'policy');
    await page.getByRole('tab', { name: 'Acknowledgements' }).click();
    await expect(page.getByRole('table', { name: 'Acknowledgements' })).toBeVisible();
    await checkCurrent(page, testInfo, 'policy-acknowledgements');
  });

  test('exit case page fits the screen', async ({ page }, testInfo) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/hr/exits');
    await page.getByRole('tab', { name: 'All exits' }).click();
    const row = page.getByRole('row').filter({ hasText: 'Nikhil' }).first();
    const found = await row.waitFor({ state: 'visible', timeout: 8000 }).then(
      () => true,
      () => false,
    );
    test.skip(!found, 'needs an exit (created by exit.spec.ts)');
    await row.click();
    await expect(page).toHaveURL(/\/hr\/exits\/[0-9a-f-]+$/);
    await expect(page.getByText('Separation')).toBeVisible();
    await checkCurrent(page, testInfo, 'exit-case');
    await page.getByRole('tab', { name: 'Full & final' }).click();
    await expect(page.getByText('Work out the settlement')).toBeVisible();
    await checkCurrent(page, testInfo, 'exit-settlement');
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

  test('tab bar and More menu navigate on small screens', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 1024, 'the sidebar is always visible on large screens');
    await signIn(page, orgAdmin.email, orgAdmin.password);

    const tabs = page.getByRole('navigation', { name: 'Tabs' });
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(tabs).toBeVisible();
    await expect(nav).toBeHidden();

    await tabs.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(tabs.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');

    await (await primaryNav(page)).getByRole('link', { name: 'Holidays' }).click();
    await expect(page).toHaveURL(/\/admin\/holidays$/);
    await expect(nav).toBeHidden();
    await expect(page.getByRole('button', { name: 'Back' })).toBeHidden();

    await primaryNav(page);
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();

    // Forms opened as pages hide the tab bar; inner pages get Back in the top bar.
    await page.goto('/admin/users?invite=1');
    await expect(page.getByRole('dialog', { name: 'Invite user' })).toBeVisible();
    await expect(tabs).toBeHidden();
    await page.goto('/admin/users');
    await page.locator('#main table tbody tr').first().click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
  });
});
