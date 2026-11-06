/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { signIn, unique } from './helpers';

const { orgAdmin } = credentials();

test.describe('onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('starts onboarding for a new joiner from the standard checklist and completes a task', async ({ page }) => {
    await page.goto('/hr/onboarding/checklists');
    await expect(page.getByRole('heading', { name: 'Onboarding checklists' })).toBeVisible();
    const add = page.getByRole('button', { name: 'Add standard checklist' }).first();
    if (await add.isVisible()) {
      await add.click();
      await expect(page.getByText('Standard checklist added')).toBeVisible();
    }
    await expect(page.getByText('Standard onboarding')).toBeVisible();

    // A new joiner (joining today).
    const last = unique('Joiner');
    await page.goto('/hr/employees/new');
    await page.getByLabel('First name').fill('Neha');
    await page.getByLabel('Last name').fill(last);
    await page.getByRole('button', { name: 'Add employee' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Neha ${last}` })).toBeVisible();

    await page.goto('/hr/onboarding');
    const joiner = page.getByRole('listitem').filter({ hasText: `Neha ${last}` });
    await joiner.getByRole('button', { name: 'Start' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start onboarding' });
    await expect(dialog.getByRole('combobox', { name: 'Checklist' })).toContainText('Standard onboarding');
    await dialog.getByRole('button', { name: 'Start onboarding' }).click();
    await expect(page.getByText('Onboarding started')).toBeVisible();
    await expect(page).toHaveURL(/\/hr\/onboarding\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1, name: `Neha ${last}` })).toBeVisible();
    await expect(page.getByText('Before joining')).toBeVisible();

    const task = page.getByRole('listitem').filter({ hasText: 'Issue the appointment letter' });
    await task.getByRole('button', { name: 'Mark done' }).click();
    await expect(page.getByText('Task completed')).toBeVisible();
    await expect(task.getByText('Done', { exact: true })).toBeVisible();
    // Required tasks are still open, so onboarding cannot be completed yet.
    await expect(page.getByRole('button', { name: 'Complete onboarding' })).toBeDisabled();
  });

  test('probation and self-service pages load', async ({ page }) => {
    await page.goto('/hr/onboarding/probation');
    await expect(page.getByRole('heading', { name: 'Probation' })).toBeVisible();
    await page.goto('/me/onboarding');
    await expect(page.getByRole('heading', { name: 'Onboarding' })).toBeVisible();
  });
});
