import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { primaryNav, signIn, unique } from './helpers';

const { orgAdmin } = credentials();

test.describe('organization structure and employees', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('sets up structure, adds an employee and records a promotion', async ({ page }, testInfo) => {
    const dept = unique('Engineering');
    const junior = unique('Engineer');
    const senior = unique('Senior Engineer');

    // Structure (Administration → Structure).
    await page.goto('/admin/structure');
    await expect(page.getByRole('heading', { name: 'Organization structure' })).toBeVisible();
    await expect((await primaryNav(page)).getByRole('link', { name: 'Structure' })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New department' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill(dept);
    await page.getByRole('dialog').getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByRole('cell', { name: dept, exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Designations' }).click();
    for (const name of [junior, senior]) {
      await page.getByRole('button', { name: 'New designation' }).click();
      await page.getByRole('dialog').getByLabel('Name').fill(name);
      await page.getByRole('dialog').getByRole('button', { name: 'Create designation' }).click();
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    }

    // Employee (HR operations → Employees → Add employee).
    const last = unique('Rao');
    await page.goto('/hr/employees');
    await page.getByRole('link', { name: 'Add employee' }).click();
    await page.getByLabel('First name').fill('Asha');
    await page.getByLabel('Last name').fill(last);
    await page.getByRole('combobox', { name: 'Department' }).click();
    await page.getByRole('option', { name: dept, exact: true }).click();
    await page.getByRole('combobox', { name: 'Designation' }).click();
    await page.getByRole('option', { name: junior, exact: true }).click();
    await page.getByLabel('Work email').fill(`asha.${Date.now()}@example.test`);
    await page.getByRole('button', { name: 'Add employee' }).click();

    await expect(page.getByRole('heading', { level: 1, name: `Asha ${last}` })).toBeVisible();
    await expect(page.getByText(`${junior} · ${dept}`)).toBeVisible();
    await expect(page.getByText('Joined', { exact: true })).toBeVisible();

    // Lifecycle: promotion.
    await page.getByRole('button', { name: 'Lifecycle action' }).click();
    await page.getByRole('menuitem', { name: 'Promotion / designation change' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'New designation' }).click();
    await page.getByRole('option', { name: senior, exact: true }).click();
    await dialog.getByLabel('Note').fill('Annual review');
    await dialog.getByRole('button', { name: 'Record promotion' }).click();
    await expect(page.getByText('Promotion recorded')).toBeVisible();
    await expect(page.getByText(`${senior} · ${dept}`)).toBeVisible();
    await expect(page.getByText('“Annual review”')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('employee.png'), fullPage: true });

    // Directory search finds the employee.
    await page.goto('/hr/employees');
    await page.getByLabel('Search employees').fill(last);
    await expect(page.getByRole('cell', { name: new RegExp(`Asha ${last}`) })).toBeVisible();
  });

  test('creates employee records for existing users', async ({ page }) => {
    const invite = async (first: string, last: string) => {
      const email = `${first.toLowerCase()}.${Date.now()}@example.test`;
      await page.goto('/admin/users');
      await page.getByRole('button', { name: 'Invite user' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Work email').fill(email);
      await dialog.getByLabel('First name').fill(first);
      await dialog.getByLabel('Last name').fill(last);
      await dialog.getByRole('button', { name: 'Send invitation' }).click();
      await expect(page.getByText('Invitation sent')).toBeVisible();
      return email;
    };

    // From the user detail page.
    const lastA = unique('Menon');
    const emailA = await invite('Kiran', lastA);
    await page.getByLabel('Search users').fill(emailA);
    await page.getByRole('cell', { name: new RegExp(emailA) }).click();
    await page.getByRole('button', { name: 'Create employee record' }).click();
    await expect(page).toHaveURL(/\/hr\/employees\/[0-9a-f-]+\/edit$/);
    await expect(page.getByLabel('Last name')).toHaveValue(lastA);

    // From the Employees page, in bulk.
    const lastB = unique('Iyer');
    await invite('Divya', lastB);
    await page.goto('/hr/employees');
    await expect(page.getByText(/no employee record yet/)).toBeVisible();
    await page.getByRole('button', { name: 'Create employee records' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /Select all/ }).uncheck();
    await dialog.getByRole('checkbox', { name: `Divya ${lastB}` }).check();
    await dialog.getByRole('button', { name: 'Create 1 employee record' }).click();
    await expect(page.getByText('1 employee record created')).toBeVisible();
    await page.getByLabel('Search employees').fill(lastB);
    await expect(page.getByRole('cell', { name: new RegExp(`Divya ${lastB}`) })).toBeVisible();
  });

  test('shows the employment card on My profile', async ({ page }) => {
    await page.goto('/me/profile');
    await expect(page.getByRole('heading', { name: 'Employment' })).toBeVisible();
  });
});
