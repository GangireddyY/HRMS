/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { linkAdmin, newEmployee, unlinkAdmin } from './as-employee';
import { credentials } from './env';
import { isoDaysFromNow, pickDate, signIn, unique } from './helpers';

const { orgAdmin } = credentials();

test.describe('benefits', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });
  test.afterEach(async () => {
    await unlinkAdmin();
  });

  test('HR sets up a health plan and an employee enrols with a dependant', async ({ page }) => {
    test.setTimeout(150_000);
    const name = unique('Group health');

    // HR: a plan with an open enrolment window and a family option.
    await page.goto('/hr/benefits/plans');
    await page.getByRole('button', { name: 'New plan' }).click();
    const form = page.getByRole('dialog', { name: 'New benefit plan' });
    await form.getByLabel('Plan name').fill(name);
    await form.getByLabel('Insurer / provider').fill('Star Health');
    await pickDate(page, form, 'Policy starts', isoDaysFromNow(0));
    await pickDate(page, form, 'Policy ends', isoDaysFromNow(60));
    await pickDate(page, form, 'Enrolment opens', isoDaysFromNow(0));
    await pickDate(page, form, 'Enrolment closes', isoDaysFromNow(14));
    const number = (label: string) => form.getByRole('spinbutton', { name: label, exact: true });
    await number('Children covered up to age').fill('25');
    await number('Option 1 sum insured (₹)').fill('300000');
    await number('Option 2 sum insured (₹)').fill('500000');
    await number('Option 2 employee pays / month (₹)').fill('750');
    await number('Option 2 employer pays / month (₹)').fill('1500');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Plan saved')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByText('Plan activated')).toBeVisible();
    const planUrl = page.url();

    // The employee records a spouse and enrols in the family option.
    const employee = await newEmployee(page, 'Meera');
    await linkAdmin(employee.id);
    await page.goto('/me/employment');
    await page.getByRole('tab', { name: 'Family & background' }).click();
    await page.getByRole('button', { name: 'Add family member' }).click();
    const member = page.getByRole('dialog');
    await member.getByLabel('Full name').fill('Arjun Nair');
    await member.getByRole('combobox', { name: /^Relationship/ }).click();
    await page.getByRole('option', { name: 'Spouse' }).click();
    await member.getByRole('checkbox', { name: /^Dependent/ }).check();
    await member.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Arjun Nair')).toBeVisible();

    await page.goto('/me/benefits');
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.getByText(/Open enrolment until/)).toBeVisible();
    await card.getByRole('button', { name: 'Enrol', exact: true }).click();
    const enrol = page.getByRole('dialog', { name: `Enrol in ${name}` });
    await enrol.getByRole('radio', { name: /Employee \+ family/ }).check();
    await enrol.getByRole('checkbox', { name: /Arjun Nair/ }).check();
    await enrol.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Enrolled', { exact: true })).toBeVisible();
    await expect(card.getByText('Arjun Nair')).toBeVisible();
    await expect(card.getByText(/₹750\/month from your salary/)).toBeVisible();

    // HR sees the enrolment and downloads the insurer census.
    await unlinkAdmin();
    await page.goto(planUrl);
    await expect(page.getByRole('row').filter({ hasText: employee.name })).toContainText('Covered');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Census' }).click();
    expect((await download).suggestedFilename()).toMatch(/census .*\.csv$/);
  });

  test('HR enrolment page loads', async ({ page }) => {
    await page.goto('/hr/benefits/enrollments');
    await expect(page.getByRole('heading', { level: 1, name: 'Benefit enrolments' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Benefit enrolments' })).toBeVisible();
  });
});
