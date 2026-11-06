/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { signIn, unique } from './helpers';

const { orgAdmin } = credentials();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

test.describe('employee profile, documents, import and org chart', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('grade, education and a verified document on an employee; found in the org chart', async ({ page }, testInfo) => {
    const grade = unique('L3');
    await page.goto('/admin/structure');
    await page.getByRole('tab', { name: 'Grades' }).click();
    await page.getByRole('button', { name: 'New grade' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill(grade);
    await page.getByRole('dialog').getByRole('button', { name: 'Create grade' }).click();
    await expect(page.getByRole('cell', { name: grade, exact: true })).toBeVisible();

    const last = unique('Nair');
    await page.goto('/hr/employees/new');
    await page.getByLabel('First name').fill('Divya');
    await page.getByLabel('Last name').fill(last);
    await page.getByRole('combobox', { name: 'Grade' }).click();
    await page.getByRole('option', { name: grade, exact: true }).click();
    await page.getByRole('combobox', { name: 'Blood group' }).click();
    await page.getByRole('option', { name: 'O+', exact: true }).click();
    await page.getByRole('button', { name: 'Add employee' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Divya ${last}` })).toBeVisible();
    await expect(page.locator('#main').getByText(grade).first()).toBeVisible();

    // Education (Family & background tab).
    await page.getByRole('tab', { name: 'Family & background' }).click();
    await page.getByRole('button', { name: 'Add education' }).click();
    const edu = page.getByRole('dialog');
    await edu.getByRole('combobox', { name: 'Level' }).click();
    await page.getByRole('option', { name: "Bachelor's degree" }).click();
    await edu.getByLabel('Qualification').fill('B.Tech');
    await edu.getByLabel('Institution').fill('NIT Trichy');
    await edu.getByRole('spinbutton', { name: 'Year of completion' }).fill('2018');
    await edu.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('NIT Trichy')).toBeVisible();

    // Document upload by HR is verified immediately.
    await page.getByRole('tab', { name: 'Documents' }).click();
    await page.getByRole('button', { name: 'Upload' }).click();
    const upload = page.getByRole('dialog');
    await upload.locator('input[type=file]').setInputFiles({ name: 'offer-letter.pdf', mimeType: 'application/pdf', buffer: PDF });
    await upload.getByRole('combobox', { name: 'Category' }).click();
    await page.getByRole('option', { name: 'Offer letter' }).click();
    await upload.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Document uploaded')).toBeVisible();
    await expect(page.getByRole('button', { name: 'offer-letter', exact: true })).toBeVisible();
    await expect(page.locator('#main').getByText('Verified', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('documents.png'), fullPage: true });

    // Org chart opens at this employee.
    await page.locator('#main').getByRole('link', { name: 'Org chart' }).click();
    await expect(page.getByRole('heading', { name: 'Org chart' })).toBeVisible();
    await expect(page.getByRole('treeitem').filter({ hasText: `Divya ${last}` })).toBeVisible();
  });

  test('imports employees from CSV after checking the file', async ({ page }) => {
    const code = `IMP-${Date.now().toString(36).toUpperCase()}`;
    const csv = ['employee_code,first_name,last_name,date_of_joining,employment_type', `${code},Kavya,Imported,2024-04-01,FULL_TIME`, `${code}-2,Arjun,Imported,2024-05-01,INTERN`].join('\n');
    const bad = ['first_name,last_name,date_of_joining', 'Only,First,01/04/2024'].join('\n');

    await page.goto('/hr/employees');
    await page.getByRole('button', { name: 'Import' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
    await expect(dialog.getByText(/1 problem in 1 of 1 rows/)).toBeVisible();
    await expect(dialog.getByText('"01/04/2024" is not a date; use YYYY-MM-DD')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Import/ })).toBeDisabled();

    await dialog.locator('input[type=file]').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(dialog.getByText('2 employees ready to import')).toBeVisible();
    await dialog.getByRole('button', { name: 'Import 2 employees' }).click();
    await expect(page.getByText('2 employees imported')).toBeVisible();
    await page.getByLabel('Search employees').fill(code);
    await expect(page.getByRole('cell', { name: /Kavya Imported/ })).toBeVisible();
  });

  test('My employment page is available in My Workspace', async ({ page }) => {
    await page.goto('/me/employment');
    await expect(page.getByRole('heading', { name: 'My employment' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Documents' })).toBeVisible();
  });
});
