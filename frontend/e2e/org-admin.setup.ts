import { expect, test as setup } from '@playwright/test';
import { credentials, E2E_ORGANIZATION } from './env';

const { orgAdmin } = credentials();

/**
 * Organizations are not seeded: the e2e Organization Admin is created the same way real customers are,
 * through organization sign-up. Idempotent – an existing account (409) from an earlier run is reused.
 */
setup('organization owner signs up and becomes Organization Admin', async ({ request }) => {
  const res = await request.post('/api/v1/auth/register-organization', {
    data: {
      organization: { name: E2E_ORGANIZATION, country: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', industry: 'Information Technology', companySize: '201-1000' },
      admin: { firstName: 'Asha', lastName: 'Admin', email: orgAdmin.email, password: orgAdmin.password },
    },
  });
  expect([201, 409], `sign-up failed: ${res.status()} ${await res.text()}`).toContain(res.status());

  const login = await request.post('/api/v1/auth/login', { data: { email: orgAdmin.email, password: orgAdmin.password } });
  expect(login.ok(), `sign-in failed: ${login.status()} ${await login.text()}`).toBe(true);
  const { data } = await login.json();
  expect(data.context.activeOrganization.name).toBe(E2E_ORGANIZATION);
  expect(data.context.roles.map((r: { key: string }) => r.key)).toContain('org_admin');
});
