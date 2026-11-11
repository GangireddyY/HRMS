/**
 * Conventional Commits (https://www.conventionalcommits.org): `type(scope): summary`, e.g.
 * `feat(payroll): pay settlements by bank file` or `fix(auth): refuse breached passwords`.
 * Checked in CI for every commit in a pull request, and locally by `.githooks/commit-msg` (`npm run hooks:install`).
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'api', 'auth', 'approvals', 'attendance', 'audit', 'billing', 'benefits', 'compliance', 'db', 'deps', 'docs', 'employees', 'engagement', 'exit',
        'frontend', 'grievance', 'helpdesk', 'imports', 'integrations', 'leave', 'notifications', 'onboarding', 'organization', 'payroll', 'performance',
        'platform', 'privacy', 'rbac', 'recruitment', 'reports', 'security', 'services', 'sso', 'training', 'ci', 'release',
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 200],
  },
};
