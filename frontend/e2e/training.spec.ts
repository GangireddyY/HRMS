/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { isoDaysFromNow, pickDate, signIn, unique } from './helpers';

const { orgAdmin } = credentials();
const code = () => `T${Date.now().toString(36).toUpperCase().slice(-7)}`;

test.describe('training', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('builds a self-paced course with an assessment and publishes it', async ({ page }) => {
    const title = unique('Information security basics');
    await page.goto('/hr/training/courses');
    await page.getByRole('button', { name: 'New course' }).click();
    const dialog = page.getByRole('dialog', { name: 'New course' });
    await dialog.getByLabel('Code').fill(code());
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('checkbox', { name: /Assessment/ }).check();
    await dialog.getByRole('spinbutton', { name: 'Certificate valid for (months)' }).fill('12');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Course created')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('Add the assessment questions')).toBeVisible();

    await page.getByRole('button', { name: /Assessment questions/ }).click();
    const quiz = page.getByRole('dialog', { name: /^Assessment/ });
    await quiz.getByLabel('Question 1', { exact: true }).fill('What should you do with a suspicious email?');
    await quiz.getByRole('textbox', { name: 'Question 1 option 1' }).fill('Open the attachment');
    await quiz.getByRole('textbox', { name: 'Question 1 option 2' }).fill('Report it to IT security');
    await quiz.getByRole('radio', { name: 'Option 2 is correct' }).check();
    await quiz.getByRole('button', { name: 'Save 1 question' }).click();
    await expect(page.getByText('Assessment saved')).toBeVisible();

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Course published')).toBeVisible();
    await expect(page.locator('#main').getByText('Published').first()).toBeVisible();
  });

  test('schedules a classroom session and assigns the course with a due date', async ({ page }) => {
    test.setTimeout(90_000);
    const last = unique('Learner');
    await page.goto('/hr/employees/new');
    await page.getByLabel('First name').fill('Divya');
    await page.getByLabel('Last name').fill(last);
    await page.getByRole('button', { name: 'Add employee' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Divya ${last}` })).toBeVisible();

    const title = unique('Presentation skills');
    await page.goto('/hr/training/courses');
    await page.getByRole('button', { name: 'New course' }).click();
    const dialog = page.getByRole('dialog', { name: 'New course' });
    await dialog.getByLabel('Code').fill(code());
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('combobox', { name: 'Delivery' }).click();
    await page.getByRole('option', { name: 'Classroom' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    await page.getByRole('button', { name: 'Schedule' }).click();
    const session = page.getByRole('dialog', { name: 'Schedule a session' });
    await pickDate(page, session, 'Date', isoDaysFromNow(7));
    await session.getByLabel('Room / venue').fill('Training room 2');
    await session.getByRole('spinbutton', { name: 'Seats' }).fill('12');
    await session.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Session scheduled')).toBeVisible();
    await expect(page.getByText('Training room 2')).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Course published')).toBeVisible();

    await page.getByRole('button', { name: 'Assign' }).click();
    const assign = page.getByRole('dialog', { name: `Assign ${title}` });
    await assign.getByRole('combobox', { name: 'People' }).click();
    await page.getByRole('combobox', { name: 'Search People' }).fill(last);
    await page.getByRole('option', { name: new RegExp(`Divya ${last}`) }).click();
    await pickDate(page, assign, 'Complete by', isoDaysFromNow(20));
    await assign.getByRole('combobox', { name: 'Session' }).click();
    await page.getByRole('option', { name: /12 seats left/ }).click();
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Assigned to 1 person')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: `Divya ${last}` });
    await expect(row).toContainText('Not started');
    await expect(row).toContainText('assigned');

    await page.goto('/hr/training/team');
    await expect(page.getByRole('row').filter({ hasText: `Divya ${last}` })).toContainText(title);
  });

  test('learner pages load', async ({ page }) => {
    await page.goto('/me/training');
    await expect(page.getByRole('heading', { name: 'My learning' })).toBeVisible();
    await page.goto('/me/training/catalog');
    await expect(page.getByRole('heading', { name: 'Course catalog' })).toBeVisible();
    await page.goto('/hr/training/team');
    await expect(page.getByRole('tab', { name: 'Certifications expiring' })).toBeVisible();
  });
});
