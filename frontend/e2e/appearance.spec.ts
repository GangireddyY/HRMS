import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { resetAppearance, signIn } from './helpers';

const { orgAdmin } = credentials();

/** Appearance is saved on the (shared) account, so these run in order and each leaves the defaults behind. */
test.describe('appearance', () => {
  test.describe.configure({ mode: 'serial' });

  test('switches color theme and mode, and keeps them after reload', async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/me/appearance');
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

    const html = page.locator('html');
    const brand600 = () => page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim()");

    await page.getByRole('radiogroup', { name: 'Color theme' }).getByRole('radio', { name: /Emerald/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'emerald');
    expect(await brand600()).toBe('#047857');

    const saved = page.waitForResponse((r) => r.url().includes('/auth/me/preferences') && r.request().method() === 'PATCH');
    await page.getByRole('radiogroup', { name: 'Color mode' }).getByRole('radio', { name: 'Dark' }).click();
    await expect(html).toHaveClass(/dark/);
    await saved;

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'emerald');
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole('radiogroup', { name: 'Color theme' }).getByRole('radio', { name: /Emerald/ })).toHaveAttribute('aria-checked', 'true');

    await resetAppearance(page);
    await expect(html).toHaveAttribute('data-theme', 'indigo');
  });

  test('quick-switches the theme from the account menu', async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('radio', { name: 'Berry' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'berry');
    await resetAppearance(page);
  });

  test('the brand color becomes the Organization theme until someone picks their own', async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/admin/organization');
    await page.getByRole('textbox', { name: 'Brand color hex code' }).fill('#0e7490');
    await expect(page.getByText(/White text \d+(\.\d)?:1/)).toBeVisible();
    await page.getByRole('button', { name: 'Save brand color' }).click();
    await expect(page.getByText('Brand color saved')).toBeVisible();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'organization');
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--brand-600'))).toBe('#0e7490');

    await page.goto('/me/appearance');
    const themes = page.getByRole('radiogroup', { name: 'Color theme' });
    await expect(themes.getByRole('radio', { name: /brand/ })).toHaveAttribute('aria-checked', 'true');
    await themes.getByRole('radio', { name: /Berry/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'berry');
    await resetAppearance(page);
    await expect(html).toHaveAttribute('data-theme', 'organization');

    await page.goto('/admin/organization');
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Brand color removed')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'indigo');
  });

  test('appearance follows the account to a new browser', async ({ page, browser }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/me/appearance');
    const saved = page.waitForResponse((r) => r.url().includes('/auth/me/preferences') && r.request().method() === 'PATCH');
    await page.getByRole('radiogroup', { name: 'Color theme' }).getByRole('radio', { name: /Teal/ }).click();
    await saved;

    const other = await browser.newContext();
    const fresh = await other.newPage();
    await signIn(fresh, orgAdmin.email, orgAdmin.password);
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'teal');
    await other.close();

    await resetAppearance(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'indigo');
  });
});
