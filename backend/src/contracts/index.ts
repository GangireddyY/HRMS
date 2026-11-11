/**
 * Contracts shared with the frontend (imported there as '@contracts'): permission catalog,
 * role templates, API envelope/error codes and password rules.
 * Must stay framework-free (no NestJS, Sequelize or Node APIs) because the browser bundle compiles it.
 */
export * from './permissions';
export * from './roles';
export * from './api';
export * from './audit';
export * from './password-policy';
export * from './people';
export * from './attendance';
export * from './leave';
export * from './onboarding';
export * from './recruitment';
export * from './payroll';
export * from './performance';
export * from './training';
export * from './engagement';
export * from './grievance';
export * from './benefits';
export * from './compliance';
export * from './exit';
export * from './reports';
export * from './notifications';
export * from './approvals';
export * from './services';
export * from './integrations';
export * from './custom-fields';
export * from './report-builder';
export * from './billing';
export * from './entities';
export * from './assistant';
