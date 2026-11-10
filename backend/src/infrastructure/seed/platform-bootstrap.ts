import { DEFAULT_PASSWORD_POLICY, validatePassword } from '../../contracts';
import { Feature, PasswordHistory, Plan, PlanFeature, User } from '../../database/models';
import type { PasswordHasher } from '../crypto/password-hasher.service';

export interface PlanSeed {
  code: string;
  name: string;
  description: string;
  maxUsers: number | null;
  monthlyPrice: number | null;
  sortOrder: number;
  features: string[];
}

/** Default subscription plans. Created once; platform administrators own them afterwards. */
export const DEFAULT_PLANS: PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Core HR for small teams.',
    maxUsers: 50,
    monthlyPrice: 4999,
    sortOrder: 1,
    features: ['employee', 'attendance', 'leave', 'engagement'],
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'Complete HR, payroll and talent for growing organizations.',
    maxUsers: 500,
    monthlyPrice: 24999,
    sortOrder: 2,
    features: ['employee', 'attendance', 'leave', 'engagement', 'recruitment', 'onboarding', 'payroll', 'performance', 'training', 'compliance', 'exit', 'reports', 'assets', 'helpdesk'],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Every module with unlimited users.',
    maxUsers: null,
    monthlyPrice: null,
    sortOrder: 3,
    features: ['employee', 'recruitment', 'onboarding', 'attendance', 'leave', 'payroll', 'performance', 'training', 'engagement', 'grievance', 'benefits', 'compliance', 'exit', 'reports', 'assets', 'helpdesk', 'travel'],
  },
];

/** Creates missing plans. Requires the feature catalog to be synced first. Returns created codes. */
export async function seedPlans(plans: PlanSeed[] = DEFAULT_PLANS): Promise<string[]> {
  const features = new Map((await Feature.findAll()).map((f) => [f.key, f.id]));
  const created: string[] = [];
  for (const seed of plans) {
    if (await Plan.findOne({ where: { code: seed.code } })) continue;
    const plan = await Plan.create({
      code: seed.code,
      name: seed.name,
      description: seed.description,
      maxUsers: seed.maxUsers,
      monthlyPrice: seed.monthlyPrice,
      sortOrder: seed.sortOrder,
    });
    await PlanFeature.bulkCreate(seed.features.map((key) => ({ planId: plan.id, featureId: features.get(key)! })));
    created.push(seed.code);
  }
  return created;
}

export function assertStrongPassword(label: string, password: string): void {
  const issues = validatePassword(password, DEFAULT_PASSWORD_POLICY);
  if (issues.length) throw new Error(`${label} does not meet the password policy: ${issues.join('; ')}`);
}

/** Creates a user with a password (and password history). Used by bootstrap and seeds only. */
export async function createUserWithPassword(
  hasher: PasswordHasher,
  input: { email: string; firstName: string; lastName: string; password: string; platformRole?: 'SUPER_ADMIN' | null },
): Promise<User> {
  const hash = await hasher.hash(input.password);
  const user = await User.create({
    email: input.email.trim().toLowerCase(),
    firstName: input.firstName,
    lastName: input.lastName,
    platformRole: input.platformRole ?? null,
    passwordHash: hash,
    passwordChangedAt: new Date(),
  });
  await PasswordHistory.create({ userId: user.id, passwordHash: hash });
  return user;
}

/** Creates the first Super Admin if no user with that email exists. Returns true when created. */
export async function ensureSuperAdmin(hasher: PasswordHasher, email: string | undefined, password: string | undefined): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !password) return false;
  if (await User.findOne({ where: { email: normalized } })) return false;
  assertStrongPassword('Super Admin password', password);
  await createUserWithPassword(hasher, { email: normalized, firstName: 'Platform', lastName: 'Administrator', password, platformRole: 'SUPER_ADMIN' });
  return true;
}
