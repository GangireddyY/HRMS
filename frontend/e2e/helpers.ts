import { expect, type Locator, type Page } from '@playwright/test';

/** The password field (exact accessible name, so the "Show password" toggle is not matched). */
export const passwordField = (page: Page) => page.getByRole('textbox', { name: 'Password', exact: true });

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await passwordField(page).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function signOut(page: Page): Promise<void> {
  const account = page.getByRole('button', { name: 'Account menu' });
  if (await account.isVisible()) {
    await account.click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
  } else {
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
  }
  await expect(page).toHaveURL(/\/login/);
}

export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;

/**
 * Appearance normally follows the (shared) account. For tests that need a particular look, the choices are set in
 * the browser and account preferences are hidden from the app; preference saves are answered locally.
 */
export async function isolateAppearance(page: Page, prefs: { mode?: string; sidebar?: string; color?: string }): Promise<void> {
  await page.addInitScript((p) => {
    if (p.mode) localStorage.setItem('hrms.theme', p.mode);
    if (p.sidebar) localStorage.setItem('hrms.sidebar', p.sidebar);
    if (p.color) localStorage.setItem('hrms.colorTheme', p.color);
  }, prefs);
  await page.route('**/api/v1/auth/me/preferences', (route) => route.fulfill({ json: { success: true, data: {} } }));
  await page.route(/\/api\/v1\/auth\/(me|login|mfa\/verify|switch-organization)$/, async (route) => {
    if (route.request().method() === 'PATCH') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const ctx = body?.data?.context ?? body?.data;
    if (ctx?.user) ctx.user.preferences = {};
    await route.fulfill({ response, json: body });
  });
}

/** Appearance is saved on the account; resets it and waits for the save so later tests start from the defaults. */
export async function resetAppearance(page: Page): Promise<void> {
  if (!page.url().includes('/me/appearance')) await page.goto('/me/appearance');
  const saved = page.waitForResponse((r) => r.url().includes('/auth/me/preferences') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await saved;
}

/** Primary navigation; on screens narrower than `lg` it is in the "More" menu of the tab bar, opened first. */
export async function primaryNav(page: Page): Promise<Locator> {
  const more = page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'More' });
  if ((await more.isVisible()) && (await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(nav).toBeVisible();
  return nav;
}

/** Picks a date in an AppDatePicker (day buttons are labelled with the full date in the browser's locale). */
export async function pickDate(page: Page, scope: Locator, label: string, iso: string): Promise<void> {
  // The form guide beside page forms lists required fields as buttons too, so match the picker trigger only.
  await scope.getByRole('button', { name: new RegExp(`^${label}`) }).and(scope.locator('[aria-haspopup="dialog"]')).click();
  const picker = page.getByRole('dialog', { name: `Choose ${label}` });
  const name = await page.evaluate((d) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, iso);
  for (let i = 0; i < 3 && !(await picker.getByRole('button', { name, exact: true }).isVisible()); i++) await picker.getByRole('button', { name: 'Next month' }).click();
  await picker.getByRole('button', { name, exact: true }).click();
}

/** Local calendar date `days` from today as YYYY-MM-DD. */
export function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fails when the page itself scrolls sideways (wide content must scroll inside its own container). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  expect(overflow, 'page is wider than the viewport').toBeLessThanOrEqual(0);
}
