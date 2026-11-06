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
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;

/** Primary navigation; on screens narrower than `lg` it lives in a drawer that is opened first. */
export async function primaryNav(page: Page): Promise<Locator> {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(nav).toBeVisible();
  return nav;
}

/** Picks a date in an AppDatePicker (day buttons are labelled with the full date in the browser's locale). */
export async function pickDate(page: Page, scope: Locator, label: string, iso: string): Promise<void> {
  await scope.getByRole('button', { name: new RegExp(`^${label}`) }).click();
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
