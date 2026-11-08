import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { passwordField, primaryNav, signIn, signOut } from './helpers';

const { orgAdmin } = credentials();

test.describe('authentication', () => {
  test('rejects invalid credentials with a clear message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Work email').fill(orgAdmin.email);
    await passwordField(page).fill('Definitely-Wrong-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the sign-in page maps everything HRMS covers', async ({ page }, testInfo) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'the mind map is shown on large screens only');
    await page.goto('/login');
    const map = page.getByRole('region', { name: 'What HRMS covers' });
    await expect(map.getByText('Requisitions, job openings, candidates, interviews and offers.')).toBeVisible();

    await map.getByRole('button', { name: /^Payroll:/ }).click();
    await expect(map.getByText('Salary structures, statutory rules, payroll runs and payslips.')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(map.getByText('Benefit plans, eligibility, enrollment and renewals.')).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: testInfo.outputPath('mind-map.png') });
  });

  test('explains missing or malformed credentials before calling the server', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your work email')).toBeVisible();
    await expect(page.getByText('Enter your password')).toBeVisible();
    await page.getByLabel('Work email').fill('not-an-email');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated visitors to sign-in and back after login', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)admin(%2F|\/)users/);
    await page.getByLabel('Work email').fill(orgAdmin.email);
    await passwordField(page).fill(orgAdmin.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  });

  test('org admin lands on the administration dashboard and can sign out', async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Acme Technologies' })).toBeVisible();
    const nav = await primaryNav(page);
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Roles & permissions' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Organizations' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await signOut(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('keeps the session across a page reload via the refresh cookie', async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.reload();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Acme Technologies' })).toBeVisible();
  });

  test('a new organization owner signs up and becomes its Organization Admin', async ({ page }) => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const organization = `Signup Co ${stamp}`;
    await page.goto('/register');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter your organization name (at least 2 characters)')).toBeVisible();
    await page.getByLabel('Organization name').fill(organization);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: /Your account/ })).toHaveAttribute('aria-current', 'step');
    await page.getByLabel('First name').fill('Ravi');
    await page.getByLabel('Last name').fill('Owner');
    await page.getByLabel('Work email').fill(`owner.${stamp}@example.test`);
    // Must not contain the person's name or email (the server-side policy rejects that).
    await passwordField(page).fill(`Kx7!${stamp}-Vault`);
    await page.getByRole('button', { name: 'Create organization' }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: organization, exact: true })).toBeVisible();
    const nav = await primaryNav(page);
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
    await nav.getByRole('link', { name: 'Roles & permissions' }).click();
    await expect(page.getByRole('cell', { name: /Organization Admin/ })).toBeVisible();
  });

  test('forgot-password confirms without revealing account existence', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Work email').fill('nobody@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('If an account exists');
  });
});
