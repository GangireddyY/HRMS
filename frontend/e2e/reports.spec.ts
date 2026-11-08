/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { newEmployee } from './as-employee';
import { credentials } from './env';
import { signIn } from './helpers';

const { orgAdmin } = credentials();

test.describe('reports', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('headcount reflects a new employee and exports as CSV', async ({ page }) => {
    await page.goto('/hr/reports/headcount');
    await page.waitForLoadState('networkidle');
    const before = Number(await page.getByRole('main').locator('.card').filter({ has: page.getByText('Headcount', { exact: true }) }).getByText(/^\d+$/).first().textContent());
    const employee = await newEmployee(page, 'Ishita');
    expect(employee.name).toContain('Ishita');

    await page.goto('/hr/reports');
    await expect(page.getByRole('link', { name: /Payroll cost/ })).toBeVisible();
    await page.getByRole('link', { name: /^Headcount/ }).click();
    await expect(page).toHaveURL(/\/hr\/reports\/headcount$/);
    await expect(page.getByText('Headcount at month end')).toBeVisible();
    await expect(page.getByRole('table', { name: 'By department' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Last 12 months' })).toBeVisible();
    await expect(page.locator('section, div').filter({ has: page.getByText('Joined in the last 30 days', { exact: true }) }).getByText(/^\d+$/).first()).not.toHaveText('0');
    const after = Number(await page.getByRole('main').locator('.card').filter({ has: page.getByText('Headcount', { exact: true }) }).getByText(/^\d+$/).first().textContent());
    expect(after).toBe(before + 1);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: /CSV/ }).click();
    expect((await download).suggestedFilename()).toMatch(/^headcount report .*\.csv$/);
  });

  test('attrition, leave, payroll cost and recruitment reports load, and the dashboard shows the headcount', async ({ page }) => {
    for (const [key, card, tableName] of [
      ['attrition', 'Attrition (annualized)', 'Leavers'],
      ['leave', 'Days taken', 'By leave type'],
      ['payroll-cost', 'Cost to company', null],
      ['recruitment', 'Median days to hire', null],
    ] as const) {
      await page.goto(`/hr/reports/${key}`);
      await expect(page.getByText(card, { exact: true }).first()).toBeVisible();
      if (tableName) await expect(page.getByText(tableName, { exact: true }).first()).toBeVisible();
    }
    await page.goto('/hr');
    await expect(page.getByRole('link', { name: /Headcount/ }).first()).toBeVisible();
  });
});
