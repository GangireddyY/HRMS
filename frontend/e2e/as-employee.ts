import { expect, type Page } from '@playwright/test';
import { credentials } from './env';
import { unique } from './helpers';
import { testDbQuery } from './test-db';

const { orgAdmin } = credentials();

/**
 * The e2e Organization Admin has no employee record, so it can't use employee self-service (raise a grievance, enrol
 * in benefits…). These fixtures link it to a new employee while it acts as that employee, and unlink it again.
 */
export async function linkAdmin(employeeId: string): Promise<void> {
  await unlinkAdmin();
  const linked = await testDbQuery(
    `UPDATE employees e SET membership_id = m.id FROM organization_memberships m JOIN users u ON u.id = m.user_id
     WHERE u.email = $1 AND m.organization_id = e.organization_id AND e.id = $2`,
    [orgAdmin.email, employeeId],
  );
  expect(linked).toBe(1);
}

export async function unlinkAdmin(): Promise<void> {
  await testDbQuery(`UPDATE employees SET membership_id = NULL WHERE membership_id IN (SELECT m.id FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1)`, [orgAdmin.email]);
}

/** Adds an employee through HR operations and returns its id and name. */
export async function newEmployee(page: Page, first = 'Kavya'): Promise<{ id: string; name: string }> {
  await page.goto('/hr/employees/new');
  const last = unique('Employee');
  await page.getByLabel('First name').fill(first);
  await page.getByLabel('Last name').fill(last);
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `${first} ${last}` })).toBeVisible();
  return { id: /\/hr\/employees\/([0-9a-f-]+)/.exec(page.url())![1]!, name: `${first} ${last}` };
}
