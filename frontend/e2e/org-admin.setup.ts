import { expect, test as setup } from '@playwright/test';
import { credentials, E2E_ORGANIZATION } from './env';

const { orgAdmin, superAdmin } = credentials();

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

  // Self-service sign-up starts on the Starter plan; the platform operator enables the extra modules under test.
  const platform = await request.post('/api/v1/auth/login', { data: { email: superAdmin.email, password: superAdmin.password } });
  expect(platform.ok(), `super admin sign-in failed: ${platform.status()}`).toBe(true);
  const headers = { Authorization: `Bearer ${(await platform.json()).data.accessToken}` };
  const orgs = await request.get('/api/v1/platform/organizations', { headers, params: { search: E2E_ORGANIZATION } });
  const org = (await orgs.json()).data.find((o: { name: string }) => o.name === E2E_ORGANIZATION);
  expect(org, 'e2e organization not found').toBeTruthy();
  const features = await request.put(`/api/v1/platform/organizations/${org.id}/features`, {
    headers,
    data: {
      overrides: [
        { featureKey: 'onboarding', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'recruitment', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'payroll', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'performance', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'training', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'engagement', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'grievance', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'benefits', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'compliance', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'exit', enabled: true, reason: 'End-to-end tests' },
        { featureKey: 'reports', enabled: true, reason: 'End-to-end tests' },
      ],
    },
  });
  expect(features.ok(), `enabling modules failed: ${features.status()} ${await features.text()}`).toBe(true);
});
