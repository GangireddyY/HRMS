/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { primaryNav, signIn, unique } from './helpers';

const { orgAdmin, superAdmin } = credentials();

test.describe('organization administration', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('creates a custom role and grants scoped permissions', async ({ page }, testInfo) => {
    const name = unique('Leave Approver');
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'New role' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Role name').fill(name);
    await dialog.getByLabel('Description').fill('Approves leave for their team');
    await dialog.getByRole('button', { name: 'Create role' }).click();

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await page.getByRole('navigation', { name: 'Permission modules' }).getByRole('button', { name: /Leave/ }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Leave' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('role.png') });
    await page.getByLabel('Filter permissions').fill('leave.approve');
    await page.getByLabel('Approve leave requests').check();
    const scope = page.getByRole('radiogroup', { name: 'Scope for leave.approve' });
    await expect(scope.getByRole('radio', { name: 'Own records' })).toBeChecked();
    await scope.getByRole('radio', { name: 'Team (direct reports)' }).click();
    await expect(page.getByText('1 unsaved change')).toBeVisible();
    await page.getByRole('button', { name: 'Save permissions' }).click();
    await expect(page.getByText('Permissions saved')).toBeVisible();
    await expect(page.getByText('1 unsaved change')).toBeHidden();

    await page.reload();
    await page.getByLabel('Filter permissions').fill('leave.approve');
    await expect(page.getByLabel('Approve leave requests')).toBeChecked();
    await expect(page.getByRole('radiogroup', { name: 'Scope for leave.approve' }).getByRole('radio', { name: 'Team (direct reports)' })).toBeChecked();
  });

  test('switches roles from the dropdown without losing unsaved changes by accident', async ({ page }, testInfo) => {
    await page.goto('/admin/roles');
    await page.getByRole('cell', { name: /Team Lead/ }).click();
    const switcher = page.getByRole('combobox', { name: 'Switch role' });
    await expect(switcher).toContainText('Team Lead');
    await page.getByLabel('Filter permissions').fill('leave.approve');
    await page.getByLabel('Approve leave requests').click();
    await expect(page.getByText('1 unsaved change')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('role-permissions.png') });

    const pick = async (name: string) => {
      await switcher.click();
      await page.getByRole('combobox', { name: 'Search Switch role' }).fill(name);
      await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
    };
    await pick('Auditor');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Discard unsaved changes?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Team Lead' })).toBeVisible();
    await expect(switcher).toContainText('Team Lead');

    await pick('Auditor');
    await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Auditor' })).toBeVisible();
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page.getByText('Role information')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('role-details.png') });
  });

  test('role page keeps its header fixed while the side menu and list scroll on their own', async ({ page }, testInfo) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, 'independent panes are used on large screens');
    await page.goto('/admin/roles');
    await page.getByRole('cell', { name: /HR Manager/ }).click();
    const heading = page.getByRole('heading', { level: 1, name: 'HR Manager' });
    await expect(heading).toBeVisible();
    const headingTop = (await heading.boundingBox())!.y;

    const list = page.getByRole('region', { name: 'Core Platform permissions' });
    await list.hover();
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => list.evaluate((el) => el.parentElement!.scrollTop)).toBeGreaterThan(0);

    const modules = page.getByRole('navigation', { name: 'Permission modules' });
    await modules.hover();
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => modules.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect((await heading.boundingBox())!.y).toBe(headingTop);
    await expect(page.locator('#main')).toHaveJSProperty('scrollTop', 0);
    await page.screenshot({ path: testInfo.outputPath('role-panes.png') });
  });

  test('uploads, optimizes and removes the organization logo', async ({ page }, testInfo) => {
    await page.goto('/admin/organization');
    await page.getByLabel('Logo file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'Upload a PNG, JPG or WebP image' })).toBeVisible();

    // A wide wordmark with large white margins, like a typical exported brand file.
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 900;
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      const grad = g.createLinearGradient(400, 0, 1200, 0);
      grad.addColorStop(0, '#2563eb');
      grad.addColorStop(1, '#7c3aed');
      g.fillStyle = grad;
      g.fillRect(400, 360, 180, 180);
      g.font = 'bold 120px sans-serif';
      g.fillText('D3E Studio', 610, 500);
      return c.toDataURL('image/png');
    });
    const wide = Buffer.from(dataUrl.split(',')[1]!, 'base64');
    await page.getByLabel('Logo file').setInputFiles({ name: 'brand.png', mimeType: 'image/png', buffer: wide });
    await expect(page.getByText('Logo updated')).toBeVisible();
    const preview = page.locator('#main').getByRole('img', { name: /logo$/ });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight)).toBeGreaterThan(3);
    await expect(page.getByRole('button', { name: 'Replace logo' }).first()).toBeVisible();

    await page.reload();
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      // The logo gets its own full-width brand area at the top of the sidebar.
      const brand = page.locator('aside').getByRole('link', { name: /Acme Technologies – go to/ });
      await expect(brand.locator('img')).toBeVisible();
      expect((await brand.boundingBox())!.width).toBeGreaterThan(200);
    }
    await expect(page.getByRole('button', { name: 'Replace logo' }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('logo.png') });

    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove logo' }).click();
    await expect(page.getByText('Logo removed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload logo' }).first()).toBeVisible();
  });

  test('locked roles cannot be edited', async ({ page }) => {
    await page.goto('/admin/roles');
    await page.getByRole('cell', { name: /Organization Admin/ }).click();
    await expect(page.getByText('This role is locked')).toBeVisible();
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
    await expect(page.getByText('System role names can’t be changed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save permissions' })).toHaveCount(0);
  });

  test('invites a user from the users page', async ({ page }) => {
    const email = `invitee.${Date.now()}@example.test`;
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Invite user' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Work email').fill(email);
    await dialog.getByLabel('First name').fill('Priya');
    await dialog.getByLabel('Last name').fill('Kapoor');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Invitation sent')).toBeVisible();

    await page.getByLabel('Search users').fill(email);
    await expect(page.getByRole('cell', { name: new RegExp(email) })).toBeVisible();
    await page.getByRole('cell', { name: new RegExp(email) }).click();
    await expect(page.getByRole('button', { name: 'Resend invitation' })).toBeVisible();
  });

  test('validates the organization profile on the server', async ({ page }) => {
    await page.goto('/admin/organization');
    await page.getByLabel('Website').fill('not-a-url');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/website must be a URL/i)).toBeVisible();
  });

  test('global search navigates to pages', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search', exact: true }).fill('audit');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/audit-logs/);
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  });

  test('custom dropdowns and date pickers filter lists', async ({ page }, testInfo) => {
    await page.goto('/admin/users');
    const status = page.getByRole('combobox', { name: 'Filter by status' });
    await status.click();
    await expect(page.getByRole('listbox', { name: 'Filter by status' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('select-open.png') });
    await page.getByRole('option', { name: 'Active' }).click();
    await expect(status).toContainText('Active');
    await expect(page.getByRole('cell', { name: /admin@acme\.test/ })).toBeVisible();

    // Keyboard: reopen, move to the placeholder ("All statuses") and choose it.
    await status.focus();
    await page.keyboard.press('ArrowDown');
    await expect(status).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Home');
    await expect(status).toHaveAttribute('aria-activedescendant', /-0$/);
    await page.keyboard.press('Enter');
    await expect(status).toHaveAttribute('aria-expanded', 'false');
    await expect(status).toContainText('All statuses');

    await page.goto('/admin/audit-logs');
    const from = page.getByRole('button', { name: /^From date/ });
    await from.click();
    const calendar = page.getByRole('dialog', { name: 'Choose From date' });
    await expect(calendar.getByRole('grid')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('datepicker-open.png') });
    await calendar.getByRole('button', { name: 'Today' }).click();
    await expect(calendar).toBeHidden();
    await expect(page.getByRole('button', { name: 'Clear From date' })).toBeVisible();
    await expect(page.getByRole('cell').first()).toBeVisible();
  });

  test('blocks platform pages for organization admins', async ({ page }) => {
    await page.goto('/platform/organizations');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });
});

test.describe('platform administration', () => {
  test('super admin manages organizations', async ({ page }) => {
    await signIn(page, superAdmin.email, superAdmin.password);
    await expect(page).toHaveURL(/\/platform$/);
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();

    await (await primaryNav(page)).getByRole('link', { name: 'Organizations' }).click();
    await page.getByLabel('Search organizations').fill('acme');
    await page.getByRole('cell', { name: /Acme Technologies/ }).click();
    await expect(page.getByRole('heading', { name: 'Acme Technologies' })).toBeVisible();
    await page.getByRole('tab', { name: 'Entitlements' }).click();
    await expect(page.getByText('Overrides apply on top of the plan')).toBeVisible();
  });
});
