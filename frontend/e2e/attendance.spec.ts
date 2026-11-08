import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { signIn, unique } from './helpers';

const { orgAdmin } = credentials();

test.describe('attendance', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('links the admin to an employee record, then punches in and out', async ({ page }, testInfo) => {
    // Attendance needs an employee record linked to the signed-in account (created once per test database).
    await page.goto('/me/attendance');
    const notLinked = page.getByText('No employee record linked');
    const cardReady = notLinked.or(page.getByRole('button', { name: /^Punch (in|out)$/ })).or(page.getByText('Worked', { exact: true }));
    await expect(cardReady.first()).toBeVisible();
    if (await notLinked.isVisible()) {
      await page.goto('/hr/employees/new');
      await page.getByRole('combobox', { name: 'Linked user' }).click();
      await page.getByRole('option', { name: new RegExp(orgAdmin.email.replace(/[.+]/g, '\\$&')) }).click();
      await page.getByRole('button', { name: 'Add employee' }).click();
      await expect(page.getByText('Employee added')).toBeVisible();
      await page.goto('/me/attendance');
    }

    await expect(page.getByRole('heading', { name: 'My attendance' })).toBeVisible();
    const card = page.getByRole('region', { name: "Today's attendance" });
    const punchIn = card.getByRole('button', { name: 'Punch in' });
    const punchOut = card.getByRole('button', { name: 'Punch out' });
    await expect(punchIn.or(punchOut).or(card.getByText('Day complete'))).toBeVisible();
    if (await punchIn.isVisible()) {
      await punchIn.click();
      await expect(page.getByText('Punched in', { exact: true })).toBeVisible();
    }
    if (await punchOut.isVisible()) {
      await punchOut.click();
      await expect(page.getByText('Punched out', { exact: true })).toBeVisible();
    }
    // Today's record is complete (in, out and worked time).
    await expect(card.getByText('Day complete')).toBeVisible();
    await expect(card.getByText('Worked today')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Punch in' })).toHaveCount(0);
    await expect(page.getByRole('grid', { name: /Attendance for/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('my-attendance.png'), fullPage: true });
  });

  test('configures holidays and shifts, and shows the register and closing', async ({ page }, testInfo) => {
    const holiday = unique('Founders Day');
    await page.goto('/admin/holidays');
    await page.getByRole('button', { name: 'Add holiday' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add holiday' });
    await dialog.locator('button[aria-haspopup="dialog"]').filter({ hasText: /Select date/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose Date' });
    // A future month that differs between runs keeps holidays from clashing and away from attendance data.
    for (let i = 0; i < 12 + (Date.now() % 24); i++) await picker.getByRole('button', { name: 'Next month' }).click();
    await picker.getByRole('grid').getByRole('button').nth(14).click();
    await dialog.getByLabel('Name').fill(holiday);
    await dialog.getByRole('button', { name: 'Add holiday' }).click();
    // A clash with an earlier run's date is reported on the field; either way the page stays consistent.
    await expect(page.getByText('Holiday added').or(dialog.getByText('There is already a holiday on this date'))).toBeVisible();

    const shift = unique('Morning');
    await page.goto('/hr/attendance/shifts');
    await page.getByRole('button', { name: 'New shift' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill(shift);
    await page.getByRole('dialog').getByRole('button', { name: 'Sun' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create shift' }).click();
    await expect(page.getByText('Shift created')).toBeVisible();
    await expect(page.getByText(shift)).toBeVisible();

    await page.goto('/hr/attendance');
    await expect(page.getByRole('heading', { name: 'Attendance register' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Present/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('register.png'), fullPage: true });

    await page.goto('/hr/attendance/closing');
    await expect(page.getByRole('heading', { name: 'Monthly closing' })).toBeVisible();
    await expect(page.getByText('January', { exact: false }).first()).toBeVisible();
  });
});
