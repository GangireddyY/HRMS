/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { signIn, unique } from './helpers';

const { orgAdmin } = credentials();

test.describe('engagement', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('drafts and publishes a policy announcement that asks for acknowledgement', async ({ page }) => {
    const title = unique('Updated travel policy');
    await page.goto('/hr/engagement/announcements');
    await page.getByRole('button', { name: 'New announcement' }).click();
    const dialog = page.getByRole('dialog', { name: 'New announcement' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Policy' }).click();
    await dialog.getByLabel('Message').fill('Economy class for flights under six hours. Book through the travel desk.');
    await dialog.getByRole('checkbox', { name: /Ask everyone to acknowledge/ }).check();
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Announcement saved')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toContainText('Draft');
    await row.getByRole('button', { name: 'Publish' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
    await expect(row).toContainText('0 acknowledged');

    await row.getByRole('button', { name: `Responses to ${title}` }).click();
    await expect(page.getByRole('dialog', { name: `Responses · ${title}` })).toContainText('acknowledged');
    await page.getByRole('button', { name: 'Close dialog' }).click();

    await page.goto('/me/engagement');
    await page.getByRole('link', { name: title }).click();
    await expect(page).toHaveURL(/\/me\/engagement\/announcements\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });

  test('builds an anonymous survey, opens it and keeps results hidden below the threshold', async ({ page }) => {
    const title = unique('Quarterly pulse');
    await page.goto('/hr/engagement/surveys');
    await page.getByRole('button', { name: 'New survey' }).click();
    const dialog = page.getByRole('dialog', { name: 'New survey' });
    await dialog.getByLabel('Title').fill(title);
    await expect(dialog.getByLabel('Question 3', { exact: true })).toHaveValue('What one thing would make work better for you?');
    await dialog.getByRole('button', { name: 'Add question' }).click();
    await dialog.getByLabel('Question 4', { exact: true }).fill('Which benefit matters most to you?');
    await dialog.getByRole('combobox', { name: /^Question 4 type/ }).click();
    await page.getByRole('option', { name: 'Single choice' }).click();
    await dialog.getByRole('textbox', { name: 'Question 4 option 1' }).fill('Health insurance');
    await dialog.getByRole('textbox', { name: 'Question 4 option 2' }).fill('Flexible hours');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Survey saved')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toContainText('4 questions · anonymous');
    await row.getByRole('button', { name: 'Open' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open survey' }).click();
    await expect(page.getByText('Survey opened')).toBeVisible();
    await expect(row).toContainText('Open');

    await row.getByRole('button', { name: 'Results' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('Not enough responses yet')).toBeVisible();

    await page.getByRole('link', { name: 'Surveys' }).first().click();
    await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: `Close ${title}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close survey' }).click();
    await expect(page.getByText('Survey closed')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: title })).toContainText('Closed');
  });

  test('company hub and suggestion pages load', async ({ page }) => {
    await page.goto('/me/engagement');
    await expect(page.getByRole('heading', { level: 1, name: 'Company' })).toBeVisible();
    await page.getByRole('tab', { name: 'Recognition' }).click();
    await expect(page.getByText('This month')).toBeVisible();
    await page.getByRole('tab', { name: /^Surveys/ }).click();
    await expect(page.getByText('No open surveys')).toBeVisible();
    await page.goto('/me/engagement/suggestions');
    await expect(page.getByRole('heading', { level: 1, name: 'Suggestions' })).toBeVisible();
    await page.goto('/hr/engagement/suggestions');
    await expect(page.getByRole('table', { name: 'Suggestions' })).toBeVisible();
  });
});
