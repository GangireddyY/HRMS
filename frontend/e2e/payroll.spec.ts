/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { credentials } from './env';
import { isoDaysFromNow, pickDate, signIn, unique } from './helpers';

const { orgAdmin } = credentials();

/** Runs left in progress by an earlier attempt would block a new run (one at a time) and lock salaries. */
async function cancelOpenRuns(page: Page) {
  await page.goto('/hr/payroll/runs');
  await expect(page.getByRole('heading', { name: 'Payroll runs' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  for (let i = 0; i < 3; i++) {
    const open = page.getByRole('row').filter({ hasText: /Draft|Awaiting approval/ }).first();
    if (!(await open.isVisible())) return;
    await open.click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel payroll' }).click();
    await expect(page.getByText('Payroll cancelled')).toBeVisible();
    await page.goto('/hr/payroll/runs');
    await page.waitForLoadState('networkidle');
  }
}

test.describe('payroll', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('sets up a structure and a salary, runs payroll with an adjustment and sends it for approval', async ({ page }) => {
    test.setTimeout(120_000);
    await cancelOpenRuns(page);

    await page.goto('/hr/payroll/setup');
    await page.waitForLoadState('networkidle');
    const standard = page.getByRole('button', { name: 'Add standard structure' });
    if (await standard.isVisible()) {
      await standard.click();
      await expect(page.getByText('Standard structure added')).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Standard', exact: true })).toBeVisible();
    await expect(page.getByText('50% of CTC', { exact: true })).toBeVisible();

    // A new joiner with a ₹6 lakh CTC.
    const last = unique('Payee');
    await page.goto('/hr/employees/new');
    await page.getByLabel('First name').fill('Kavya');
    await page.getByLabel('Last name').fill(last);
    await page.getByRole('button', { name: 'Add employee' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Kavya ${last}` })).toBeVisible();

    await page.goto('/hr/payroll/salaries');
    await page.getByLabel('Search employees').fill(last);
    await page.getByRole('row').filter({ hasText: `Kavya ${last}` }).getByRole('button', { name: 'Set salary' }).click();
    const dialog = page.getByRole('dialog', { name: `Set salary · Kavya ${last}` });
    await dialog.getByRole('combobox', { name: 'Salary structure' }).click();
    await page.getByRole('option', { name: /^Standard/ }).click();
    await dialog.getByRole('spinbutton', { name: 'Annual CTC (₹)' }).fill('600000');
    await pickDate(page, dialog, 'Effective from', isoDaysFromNow(0));
    // Basic 50% of ₹50,000 a month; employer PF on the ₹15,000 ceiling; the rest is the special allowance.
    await expect(dialog.getByRole('row', { name: /Basic salary/ })).toContainText('₹25,000');
    await expect(dialog.getByRole('row', { name: /Employer PF/ })).toContainText('₹1,800');
    await expect(dialog.getByRole('row', { name: /Special allowance/ })).toContainText('₹10,700');
    await dialog.getByRole('button', { name: 'Save salary' }).click();
    await expect(page.getByText('Salary saved')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `Kavya ${last}` })).toContainText('₹6,00,000');

    // Run this month's payroll.
    await page.goto('/hr/payroll/runs');
    await page.getByRole('button', { name: 'Run payroll' }).click();
    await page.getByRole('dialog', { name: 'Run payroll' }).getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(/\/hr\/payroll\/runs\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1, name: /^Payroll · / })).toBeVisible();

    await page.getByLabel('Search payslips').fill(last);
    await page.getByRole('row').filter({ hasText: `Kavya ${last}` }).click();
    const slip = page.getByRole('dialog', { name: new RegExp(`Kavya ${last}`) });
    await expect(slip.getByText('Basic salary').first()).toBeVisible();
    await expect(slip.getByText('Provident fund').first()).toBeVisible();
    await slip.getByLabel('Description').fill('Joining bonus');
    await slip.getByRole('spinbutton', { name: 'Amount (₹)' }).fill('5000');
    await slip.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Adjustment added')).toBeVisible();
    await expect(slip.getByRole('cell', { name: 'Joining bonus' })).toBeVisible();
    await slip.getByRole('button', { name: 'Close dialog' }).click();
    await expect(slip).toBeHidden();

    // Submitting recalculates and locks the run; whoever submits can't approve it.
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByText('Sent for approval')).toBeVisible();
    await expect(page.locator('#main').getByText('Awaiting approval').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel payroll' }).click();
    await expect(page.getByText('Payroll cancelled')).toBeVisible();
  });

  test('self-service and approval pages load', async ({ page }) => {
    await page.goto('/me/salary');
    await expect(page.getByRole('heading', { name: 'Salary & tax' })).toBeVisible();
    await page.goto('/me/payslips');
    await expect(page.getByRole('heading', { name: 'Payslips' })).toBeVisible();
    await page.goto('/me/reimbursements');
    await expect(page.getByRole('button', { name: 'New claim' })).toBeVisible();
    await page.goto('/hr/payroll/reimbursements');
    await expect(page.getByRole('heading', { name: 'Reimbursements' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'To approve' })).toBeVisible();
  });
});
