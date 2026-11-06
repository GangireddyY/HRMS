/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { pickDate, signIn } from './helpers';

const { orgAdmin } = credentials();

/** A Monday 2–4 weeks ahead that varies between runs (keeps repeated runs from overlapping). */
function futureMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14 + (Math.floor(Date.now() / 60_000) % 3) * 7);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('leave', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('sets up leave types, applies for leave with a live preview and cancels it', async ({ page }) => {
    // Leave types (HR operations → Leave types).
    await page.goto('/hr/leave/types');
    await expect(page.getByRole('heading', { name: 'Leave types' })).toBeVisible();
    const addRecommended = page.getByRole('button', { name: /Add recommended/ }).first();
    if (await addRecommended.isVisible()) {
      await addRecommended.click();
      await expect(page.getByText(/leave types? added/)).toBeVisible();
    }
    await expect(page.getByRole('cell', { name: /^Casual leave CL/ })).toBeVisible();

    // The admin needs an employee record to apply.
    await page.goto('/me/leave');
    await expect(page.getByRole('heading', { name: 'Leave', exact: true })).toBeVisible();
    if (await page.getByText(/Employee record linked to your account not found/).isVisible()) {
      await page.goto('/admin/users');
      await page.getByLabel('Search users').fill(orgAdmin.email);
      await page.getByRole('cell', { name: new RegExp(orgAdmin.email) }).click();
      await page.getByRole('button', { name: 'Create employee record' }).click();
      await expect(page).toHaveURL(/\/hr\/employees\/.+\/edit$/);
      await page.goto('/me/leave');
    }
    await expect(page.getByText('Casual leave').first()).toBeVisible();

    // Apply: the preview counts working days and shows the balance left.
    const monday = futureMonday();
    const tuesday = new Date(`${monday}T00:00:00`);
    tuesday.setDate(tuesday.getDate() + 1);
    const tuesdayIso = `${tuesday.getFullYear()}-${String(tuesday.getMonth() + 1).padStart(2, '0')}-${String(tuesday.getDate()).padStart(2, '0')}`;
    await page.getByRole('button', { name: 'Apply for leave', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Apply for leave' });
    await dialog.getByRole('combobox', { name: 'Leave type' }).click();
    await page.getByRole('option', { name: /Casual leave/ }).click();
    await pickDate(page, dialog, 'From', monday);
    await pickDate(page, dialog, 'To', tuesdayIso);
    await expect(dialog.getByText('2 days of leave')).toBeVisible();
    await expect(dialog.getByText(/days? left/)).toBeVisible();
    await dialog.getByLabel('Reason').fill('Family function');
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText('Leave requested')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'Family function' }).filter({ hasText: 'Pending' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel leave' }).click();
    await expect(page.getByText('Leave cancelled')).toBeVisible();
  });

  test('HR pages for requests, team calendar and balances load', async ({ page }) => {
    await page.goto('/hr/leave/requests');
    await expect(page.getByRole('heading', { name: 'Leave requests' })).toBeVisible();
    await page.goto('/hr/leave/calendar');
    await expect(page.getByRole('heading', { name: 'Team leave calendar' })).toBeVisible();
    await page.goto('/hr/leave/balances');
    await expect(page.getByRole('heading', { name: 'Leave balances' })).toBeVisible();
    await page.getByRole('button', { name: 'Bring accruals up to date' }).click();
    await expect(page.getByText('Accruals are up to date')).toBeVisible();
  });
});
