/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { linkAdmin, newEmployee, unlinkAdmin } from './as-employee';
import { credentials } from './env';
import { signIn, unique } from './helpers';

const { orgAdmin } = credentials();

test.describe('grievances', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });
  test.afterEach(async () => {
    await unlinkAdmin();
  });

  test('an employee raises a grievance with evidence and HR investigates and resolves it', async ({ page }) => {
    test.setTimeout(120_000);
    const { id: employeeId } = await newEmployee(page);
    const subject = unique('Overtime not paid');
    await linkAdmin(employeeId);

    await page.goto('/me/grievances');
    await page.getByRole('button', { name: 'Raise a grievance' }).click();
    const form = page.getByRole('dialog', { name: 'Raise a grievance' });
    await form.getByRole('combobox', { name: /^What is it about\?/ }).click();
    await page.getByRole('option', { name: 'Pay & benefits' }).click();
    await form.getByLabel('Subject').fill(subject);
    await form.getByLabel('What happened?').fill('I worked 12 hours of approved overtime in October and it was not in my payslip.');
    await form.getByLabel('Evidence files').setInputFiles({ name: 'approval.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 overtime approval') });
    await expect(form.getByText('approval.pdf')).toBeVisible();
    await form.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/\/me\/grievances\/[0-9a-f-]+$/);
    const id = /\/me\/grievances\/([0-9a-f-]+)/.exec(page.url())![1]!;
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
    await expect(page.locator('#main').getByText(/^GRV-\d{4}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download approval.pdf' })).toBeVisible();
    await page.getByLabel('Message').fill('My manager approved it by email on 28 October.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Message sent')).toBeVisible();

    // Nobody handles their own case.
    await page.goto(`/hr/grievances/${id}`);
    await expect(page.getByText("You raised this case, so you can't handle it.")).toBeVisible();

    await unlinkAdmin();
    await page.goto('/hr/grievances');
    await page.getByRole('row').filter({ hasText: subject }).click();
    await expect(page).toHaveURL(new RegExp(`/hr/grievances/${id}$`));
    await expect(page.getByText(`Kavya`).first()).toBeVisible();
    await page.getByRole('combobox', { name: /^Handled by/ }).click();
    await page.getByRole('option', { name: /^Asha Admin/ }).click();
    await expect(page.getByText('Case assigned')).toBeVisible();
    await expect(page.locator('#main').getByText('In review', { exact: true }).first()).toBeVisible();

    await page.getByLabel('Add a message or note').fill('Payroll confirms the overtime was missed in the October run.');
    await page.getByRole('checkbox', { name: /Internal — hidden from the complainant/ }).check();
    await page.getByRole('button', { name: 'Add internal note' }).click();
    await expect(page.getByText('Internal note added')).toBeVisible();

    await page.getByRole('button', { name: 'Start investigation' }).click();
    await expect(page.getByText('Investigation started').first()).toBeVisible();
    await page.getByRole('button', { name: 'Resolve' }).click();
    const resolve = page.getByRole('dialog', { name: /^Resolve GRV-/ });
    await resolve.getByLabel('Findings and decision').fill('The overtime will be paid with the November payroll.');
    await resolve.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText('Case resolved')).toBeVisible();
    await expect(page.getByText('The overtime will be paid with the November payroll.')).toBeVisible();
    await expect(page.getByText(/The complainant can ask to reopen it until/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close case' })).toHaveCount(0);

    // Back as the complainant: no internal notes; accepting closes the case.
    await linkAdmin(employeeId);
    await page.goto(`/me/grievances/${id}`);
    await expect(page.getByText('The overtime will be paid with the November payroll.')).toBeVisible();
    await expect(page.getByText('Payroll confirms the overtime')).toHaveCount(0);
    await page.getByRole('button', { name: 'Accept and close' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Accept and close' }).click();
    await expect(page.getByText('Case closed')).toBeVisible();
    await expect(page.locator('#main').getByText('Closed', { exact: true }).first()).toBeVisible();
  });

  test('a POSH complaint goes only to the Internal Committee, not to HR', async ({ page }) => {
    const { id: employeeId } = await newEmployee(page);
    const subject = unique('Unwelcome remarks');
    await linkAdmin(employeeId);

    await page.goto('/me/grievances');
    await page.getByRole('button', { name: 'Raise a grievance' }).click();
    const form = page.getByRole('dialog', { name: 'Raise a grievance' });
    await form.getByRole('combobox', { name: /^What is it about\?/ }).click();
    await page.getByRole('option', { name: 'Sexual harassment (POSH)' }).click();
    await expect(form.getByText('Handled only by the Internal Committee')).toBeVisible();
    await expect(form.getByText(/No committee members have been set up yet/)).toBeVisible();
    await expect(form.getByLabel('Support during the inquiry')).toBeVisible();
    await form.getByLabel('Subject').fill(subject);
    await form.getByLabel('What happened?').fill('Repeated comments about my appearance during team meetings.');
    await form.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/\/me\/grievances\/[0-9a-f-]+$/);
    const id = /\/me\/grievances\/([0-9a-f-]+)/.exec(page.url())![1]!;
    await expect(page.locator('#main').getByText(/^POSH-\d{4}$/)).toBeVisible();

    // HR (here the Organization Admin, without Internal Committee access) can't find or open it.
    await unlinkAdmin();
    await page.goto('/hr/grievances');
    await expect(page.getByRole('tab', { name: 'POSH complaints' })).toHaveCount(0);
    await page.getByLabel('Search cases').fill(subject);
    await expect(page.getByText('No matches')).toBeVisible();
    await page.goto(`/hr/grievances/${id}`);
    await expect(page.getByRole('heading', { name: subject })).toHaveCount(0);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
  });
});
