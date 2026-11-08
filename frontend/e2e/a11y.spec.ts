import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { credentials } from './env';
import { isolateAppearance, signIn } from './helpers';

const { orgAdmin } = credentials();
const PAGES = ['/me', '/me/attendance', '/me/leave', '/me/appearance', '/hr/employees', '/hr/leave/calendar', '/hr/attendance', '/hr/org-chart', '/admin'];
const MODES = ['light', 'dark', 'paper', 'dim'] as const;

async function audit(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map((v) => `${v.id} (${v.impact}) on ${where}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(report, report.join('\n')).toEqual([]);
}

test.describe('accessibility (WCAG 2.2 AA, axe)', () => {
  test('sign-in page has no serious violations', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await audit(page, '/login');
  });

  for (const mode of MODES) {
    test(`main pages have no serious violations in ${mode} mode`, async ({ page }) => {
      test.slow();
      await isolateAppearance(page, { mode });
      await signIn(page, orgAdmin.email, orgAdmin.password);
      const html = page.locator('html');
      if (mode === 'paper' || mode === 'dim') await expect(html).toHaveAttribute('data-surface', mode);
      else if (mode === 'dark') await expect(html).toHaveClass(/dark/);
      else await expect(html).not.toHaveClass(/dark/);
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await audit(page, `${mode}:${path}`);
      }
    });
  }
});
