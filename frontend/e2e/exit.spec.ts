/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { linkAdmin, newEmployee, unlinkAdmin } from './as-employee';
import { credentials } from './env';
import { isoDaysFromNow, pickDate, signIn } from './helpers';

const { orgAdmin } = credentials();

test.describe('exits', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });
  test.afterEach(async () => {
    await unlinkAdmin();
  });

  test('an employee resigns and HR accepts it, clears and completes the exit', async ({ page }) => {
    test.setTimeout(150_000);
    const employee = await newEmployee(page, 'Nikhil');

    // The employee resigns, asking to leave today.
    await linkAdmin(employee.id);
    await page.goto('/me/exit');
    await page.getByRole('combobox', { name: /^Main reason/ }).click();
    await page.getByRole('option', { name: 'Career growth' }).click();
    await page.getByLabel("Anything you'd like to add").fill('Moving into product management.');
    await pickDate(page, page.locator('#main'), 'Preferred last working day', isoDaysFromNow(0));
    await page.getByRole('button', { name: 'Submit resignation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Resign' }).click();
    await expect(page.getByText('Resignation submitted')).toBeVisible();
    await expect(page.locator('#main').getByText('Waiting for acceptance')).toBeVisible();

    // HR accepts it with the requested last day.
    await unlinkAdmin();
    await page.goto('/hr/exits');
    await page.getByRole('row').filter({ hasText: employee.name }).click();
    await expect(page.getByRole('heading', { level: 1, name: employee.name })).toBeVisible();
    await page.getByRole('button', { name: 'Accept resignation' }).click();
    const accept = page.getByRole('dialog', { name: /^Accept/ });
    await expect(accept.getByText(/days would not be served/)).toBeVisible();
    await accept.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page.getByText('Resignation accepted')).toBeVisible();
    await expect(page.locator('#main').getByText('Serving notice').first()).toBeVisible();

    // Clearance, step by step.
    await page.getByRole('tab', { name: /^Clearance/ }).click();
    const updates = page.getByRole('button', { name: /^Update / });
    const count = await updates.count();
    expect(count).toBe(6);
    for (let i = 0; i < count; i++) {
      await updates.nth(i).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
    }
    await expect(page.getByText('6 of 6 done')).toBeVisible();

    await page.getByRole('button', { name: 'Complete exit' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Complete exit' }).click();
    await expect(page.getByText('Exit completed')).toBeVisible();
    await expect(page.locator('#main').getByText('Exited', { exact: true }).first()).toBeVisible();

    // No salary on record yet: the settlement says so.
    await page.getByRole('tab', { name: 'Full & final' }).click();
    await page.getByRole('button', { name: 'Work out settlement' }).click();
    await expect(page.getByText(/has no salary on record/)).toBeVisible();

    // The employee sees the completed exit.
    await linkAdmin(employee.id);
    await page.goto('/me/exit');
    await expect(page.locator('#main').getByText('Exited', { exact: true })).toBeVisible();
    await expect(page.getByText('6 of 6 done')).toBeVisible();
  });
});
