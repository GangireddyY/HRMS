/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { credentials } from './env';
import { isoDaysFromNow, pickDate, signIn, unique } from './helpers';

const { orgAdmin } = credentials();

async function newEmployee(page: Page, first: string): Promise<string> {
  const last = unique('Perf');
  await page.goto('/hr/employees/new');
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Last name').fill(last);
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${first} ${last}` })).toBeVisible();
  return `${first} ${last}`;
}

test.describe('performance', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('creates and launches a review cycle, then assigns a reviewer', async ({ page }) => {
    test.setTimeout(120_000);
    const employee = await newEmployee(page, 'Meera');
    const reviewer = await newEmployee(page, 'Rohan');

    const name = unique('Annual review');
    await page.goto('/hr/performance/cycles');
    await page.getByRole('button', { name: 'New cycle' }).click();
    const dialog = page.getByRole('dialog', { name: 'New review cycle' });
    await dialog.getByLabel('Name').fill(name);
    // Suggested competencies are pre-filled; keep them with the default 70/30 split.
    await expect(dialog.getByRole('textbox', { name: 'Competency 1', exact: true })).toHaveValue('Job knowledge');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Review cycle created')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    await page.getByRole('button', { name: 'Launch' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Launch' }).click();
    await expect(page.getByText('Cycle launched')).toBeVisible();
    await expect(page.locator('#main').getByText('In progress').first()).toBeVisible();

    // The new joiner has no manager: assign a reviewer from their review.
    await page.getByLabel('Search reviews').fill(employee.split(' ')[1]!);
    const row = page.getByRole('row').filter({ hasText: employee });
    await expect(row).toContainText('Not assigned');
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: employee })).toBeVisible();
    await page.getByRole('button', { name: 'Assign reviewer' }).click();
    const assign = page.getByRole('dialog', { name: 'Assign reviewer' });
    await assign.getByRole('combobox', { name: 'Reviewer' }).click();
    await page.getByRole('combobox', { name: 'Search Reviewer' }).fill(reviewer.split(' ')[1]!);
    await page.getByRole('option', { name: new RegExp(reviewer) }).click();
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Reviewer assigned')).toBeVisible();
    await expect(page.locator('#main').getByText(reviewer).first()).toBeVisible();

    // Close the cycle so later runs start clean.
    await page.goto('/hr/performance/cycles');
    await page.getByRole('row').filter({ hasText: name }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close cycle' }).click();
    await expect(page.getByText('Cycle closed')).toBeVisible();
  });

  test('opens an improvement plan, records a check-in and closes it', async ({ page }) => {
    test.setTimeout(90_000);
    const employee = await newEmployee(page, 'Arun');
    await page.goto('/hr/performance/pips');
    await page.getByRole('button', { name: 'New plan' }).click();
    const dialog = page.getByRole('dialog', { name: 'New improvement plan' });
    await dialog.getByRole('combobox', { name: 'Employee' }).click();
    await page.getByRole('combobox', { name: 'Search Employee' }).fill(employee.split(' ')[1]!);
    await page.getByRole('option', { name: new RegExp(employee) }).click();
    await dialog.getByLabel('Why a plan is needed').fill('Sprint commitments missed three times in a row.');
    await dialog.getByRole('textbox', { name: 'Objective 1', exact: true }).fill('Meet sprint commitments');
    await dialog.getByRole('textbox', { name: 'Objective 1 measure' }).fill('3 of the next 4 sprints');
    await dialog.getByRole('button', { name: 'Open plan' }).click();
    await expect(page.getByText('Improvement plan opened')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: employee })).toBeVisible();

    await page.getByRole('button', { name: 'Add check-in' }).click();
    const checkIn = page.getByRole('dialog', { name: 'Add check-in' });
    await pickDate(page, checkIn, 'Date', isoDaysFromNow(0));
    await checkIn.getByLabel('Notes').fill('Two of three tickets delivered on time.');
    await checkIn.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();
    await expect(page.getByText('Two of three tickets delivered on time.')).toBeVisible();

    await page.getByRole('button', { name: 'Completed' }).click();
    const close = page.getByRole('dialog', { name: /completed successfully/ });
    await close.getByLabel('Summary').fill('Commitments met for four sprints running.');
    await close.getByRole('button', { name: 'Close plan' }).click();
    await expect(page.getByText('Plan closed')).toBeVisible();
    await expect(page.locator('#main').getByText('Completed successfully').first()).toBeVisible();
  });

  test('self-service and review pages load', async ({ page }) => {
    await page.goto('/me/performance');
    await expect(page.getByRole('heading', { name: 'Performance', exact: true })).toBeVisible();
    await page.goto('/hr/performance/reviews');
    await expect(page.getByRole('tab', { name: 'I review' })).toBeVisible();
  });
});
