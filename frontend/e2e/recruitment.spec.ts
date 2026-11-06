/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { credentials } from './env';
import { isoDaysFromNow, pickDate, signIn, unique } from './helpers';
import { testDbQuery } from './test-db';

const { orgAdmin } = credentials();

/** The smallest valid PDF header the resume check accepts. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/**
 * Stands in for a second approver: the e2e suite has a single sign-in, and the "someone other than the requester approves"
 * rule is covered by the API tests (backend/test/recruitment.e2e-spec.ts).
 */
async function approveInTestDb(title: string) {
  const n = await testDbQuery(
    `UPDATE job_requisitions SET status = 'APPROVED', reviewed_at = now(), review_note = 'Approved by the e2e fixture' WHERE title = $1 AND status = 'PENDING_APPROVAL'`,
    [title],
  );
  expect(n, 'requisition to approve').toBe(1);
}

test.describe('recruitment', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, orgAdmin.email, orgAdmin.password);
  });

  test('requisition, job, pipeline, offer and hire', async ({ page }) => {
    const title = unique('Backend Engineer');
    await page.goto('/hr/recruitment/requisitions');
    await expect(page.getByRole('heading', { name: 'Requisitions' })).toBeVisible();
    await page.getByRole('button', { name: 'New requisition' }).click();
    let dialog = page.getByRole('dialog', { name: 'New requisition' });
    await dialog.getByLabel('Position').fill(title);
    await dialog.getByLabel('Business justification').fill('The platform team needs another engineer for the payments roadmap.');
    await dialog.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByText('Requisition submitted for approval')).toBeVisible();

    // Requesters never see their own requests in the approval queue, and cannot approve them.
    await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Mine' }).click();
    await page.getByRole('row').filter({ hasText: title }).click();
    dialog = page.getByRole('dialog', { name: new RegExp(title) });
    await expect(dialog.getByText('Awaiting approval')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    await approveInTestDb(title);
    await page.reload();
    await page.getByRole('tab', { name: 'Mine' }).click();
    await page.getByRole('row').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Open job' }).click();
    dialog = page.getByRole('dialog', { name: 'Open a job' });
    await dialog.getByLabel('Description').fill('Build and run the services behind our payroll and payments products.');
    await dialog.getByRole('button', { name: 'Create job' }).click();
    await expect(page).toHaveURL(/\/hr\/recruitment\/jobs\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    await page.getByRole('button', { name: 'Status', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open for applications' }).click();
    await expect(page.getByText('Job open')).toBeVisible();

    // Add a candidate straight into the pipeline.
    const last = unique('Rao');
    const email = `cand.${Date.now()}@example.test`;
    await page.getByRole('button', { name: 'Add candidate' }).click();
    dialog = page.getByRole('dialog', { name: 'Add candidate' });
    await dialog.getByLabel('First name').fill('Priya');
    await dialog.getByLabel('Last name').fill(last);
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByRole('button', { name: 'Add to job' }).click();
    await expect(page.getByText(`Priya ${last} added`)).toBeVisible();

    await page.getByRole('button', { name: new RegExp(`Priya ${last}`) }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Priya ${last}` })).toBeVisible();
    for (const stage of ['Screening', 'Interview', 'Offer']) {
      await page.getByRole('button', { name: `Move to ${stage}` }).click();
      await expect(page.locator('#main').getByText(stage, { exact: true }).first()).toBeVisible();
    }

    // Offer: draft → release → accepted → hire.
    await page.getByRole('button', { name: 'Draft offer' }).click();
    dialog = page.getByRole('dialog', { name: 'Draft offer' });
    await dialog.getByRole('spinbutton', { name: 'Annual CTC' }).fill('1800000');
    await pickDate(page, dialog, 'Joining date', isoDaysFromNow(30));
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Offer saved')).toBeVisible();
    await page.getByRole('button', { name: 'Release' }).click();
    await expect(page.getByText('Offer released')).toBeVisible();
    await page.getByRole('button', { name: 'Accepted' }).click();
    await expect(page.getByText('Offer accepted')).toBeVisible();
    await page.getByRole('button', { name: 'Hire', exact: true }).click();
    dialog = page.getByRole('dialog', { name: `Hire Priya ${last}` });
    await dialog.getByRole('button', { name: 'Hire', exact: true }).click();
    await expect(page.getByText(`Priya ${last} hired as`)).toBeVisible();
    await expect(page).toHaveURL(/\/hr\/(onboarding|employees)\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1, name: `Priya ${last}` })).toBeVisible();
  });

  test('public careers page accepts an application with a resume', async ({ page, browser }) => {
    // An open, public job to apply to.
    const title = unique('Data Analyst');
    await page.goto('/hr/recruitment/requisitions');
    await page.getByRole('button', { name: 'New requisition' }).click();
    let dialog = page.getByRole('dialog', { name: 'New requisition' });
    await dialog.getByLabel('Position').fill(title);
    await dialog.getByLabel('Business justification').fill('Reporting demand from finance has doubled this year.');
    await dialog.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByText('Requisition submitted for approval')).toBeVisible();
    await approveInTestDb(title);
    await page.reload();
    await page.getByRole('tab', { name: 'Mine' }).click();
    await page.getByRole('row').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Open job' }).click();
    dialog = page.getByRole('dialog', { name: 'Open a job' });
    await dialog.getByLabel('Description').fill('Turn finance and people data into decisions.');
    await dialog.getByRole('button', { name: 'Create job' }).click();
    await page.getByRole('button', { name: 'Status', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open for applications' }).click();
    await expect(page.getByText('Job open')).toBeVisible();

    await page.goto('/hr/recruitment/jobs');
    const careersHref = await page.getByRole('link', { name: 'Careers page' }).getAttribute('href');
    expect(careersHref).toMatch(/^\/careers\/.+/);

    // Apply as an anonymous visitor.
    const visitor = await browser.newContext();
    const pub = await visitor.newPage();
    await pub.goto(careersHref!);
    await expect(pub.getByRole('heading', { level: 1, name: /Join / })).toBeVisible();
    await pub.getByRole('link', { name: new RegExp(title) }).click();
    await expect(pub.getByRole('heading', { level: 1, name: title })).toBeVisible();
    const last = unique('Menon');
    await pub.getByLabel('First name').fill('Arjun');
    await pub.getByLabel('Last name').fill(last);
    await pub.getByLabel('Email').fill(`applicant.${Date.now()}@example.test`);
    await pub.getByLabel('Resume', { exact: true }).setInputFiles({ name: 'arjun-resume.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(pub.getByRole('button', { name: 'Send application' })).toBeDisabled();
    await pub.getByRole('checkbox').check();
    await pub.getByRole('button', { name: 'Send application' }).click();
    await expect(pub.getByText('Application sent')).toBeVisible();
    await visitor.close();

    // The recruiter sees the applicant with the resume.
    await page.goto('/hr/recruitment/candidates');
    await page.getByLabel('Search candidates').fill(last);
    await page.getByRole('row').filter({ hasText: `Arjun ${last}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Arjun ${last}` })).toBeVisible();
    await expect(page.getByText('Careers page', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'arjun-resume.pdf' })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('my interviews page loads', async ({ page }) => {
    await page.goto('/me/interviews');
    await expect(page.getByRole('heading', { name: 'My interviews' })).toBeVisible();
  });
});
