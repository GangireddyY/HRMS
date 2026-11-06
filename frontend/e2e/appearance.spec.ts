import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { signIn } from './helpers';

const { orgAdmin } = credentials();

test.describe('appearance', () => {
  test('switches color theme and mode, and keeps them after reload', async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.goto('/me/appearance');
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

    const html = page.locator('html');
    const brand600 = () => page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim()");

    await page.getByRole('radiogroup', { name: 'Color theme' }).getByRole('radio', { name: /Emerald/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'emerald');
    expect(await brand600()).toBe('#047857');

    await page.getByRole('radiogroup', { name: 'Color mode' }).getByRole('radio', { name: 'Dark' }).click();
    await expect(html).toHaveClass(/dark/);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'emerald');
    await expect(html).toHaveClass(/dark/);
    await expect(page.getByRole('radiogroup', { name: 'Color theme' }).getByRole('radio', { name: /Emerald/ })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect(html).toHaveAttribute('data-theme', 'indigo');
  });

  test('quick-switches the theme from the account menu', async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('radio', { name: 'Violet' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'violet');
  });
});
