/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { linkAdmin, newEmployee, unlinkAdmin } from './as-employee';
import { credentials } from './env';
import { signIn, unique } from './helpers';

const { orgAdmin } = credentials();

test.describe('compliance', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });
  test.afterEach(async () => {
    await unlinkAdmin();
  });

  test('HR publishes a policy and an employee reads and acknowledges it', async ({ page }) => {
    test.setTimeout(120_000);
    const title = unique('Acceptable use policy');
    const employee = await newEmployee(page, 'Rohan');

    await page.goto('/hr/compliance/policies');
    await page.getByRole('button', { name: 'New policy' }).click();
    const form = page.getByRole('dialog', { name: 'New policy' });
    await form.getByLabel('Title').fill(title);
    await form.getByRole('combobox', { name: /^Category/ }).click();
    await page.getByRole('option', { name: 'IT & security' }).click();
    await form.getByLabel('Policy text').fill('Company laptops are for work. Report lost devices to IT within 24 hours.');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Policy drafted')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Policy published')).toBeVisible();
    await expect(page.getByText('Version 1 (in force)')).toBeVisible();
    const policyUrl = page.url();

    await linkAdmin(employee.id);
    await page.goto('/me/policies');
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('Report lost devices to IT within 24 hours.')).toBeVisible();
    const acknowledge = page.getByRole('button', { name: 'Acknowledge' });
    await expect(acknowledge).toBeDisabled();
    await page.getByRole('checkbox', { name: new RegExp(`I have read and understood ${title}`) }).check();
    await acknowledge.click();
    await expect(page.getByText('your acknowledgement is recorded')).toBeVisible();
    await expect(page.getByText(/You acknowledged version 1 on/)).toBeVisible();

    await unlinkAdmin();
    await page.goto(policyUrl);
    await page.getByRole('tab', { name: 'Acknowledgements' }).click();
    await expect(page.getByRole('row').filter({ hasText: employee.name })).toContainText('Acknowledged');
  });

  test('HR adds the statutory calendar and records a filing', async ({ page }) => {
    await page.goto('/hr/compliance/calendar');
    await page.getByRole('button', { name: 'Add recommended' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(/obligations? added|already in the calendar/)).toBeVisible();
    await expect(page.getByText('PF contributions and ECR').first()).toBeVisible();

    const reference = unique('CH');
    await page.getByRole('button', { name: 'Mark filed' }).first().click();
    const dialog = page.getByRole('dialog', { name: /^Mark filed/ });
    await dialog.getByLabel('Reference').fill(reference);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Filing recorded')).toBeVisible();
    await expect(page.getByText(new RegExp(`ref ${reference}`))).toBeVisible();

    await page.getByRole('tab', { name: 'Obligations' }).click();
    await expect(page.getByText(/Income tax \(TDS\) · Income Tax Department · due/).first()).toBeVisible();
  });
});
