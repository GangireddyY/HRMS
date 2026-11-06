/**
 * Contracts shared with the frontend (imported there as '@contracts'): permission catalog,
 * role templates, API envelope/error codes and password rules.
 * Must stay framework-free (no NestJS, Sequelize or Node APIs) because the browser bundle compiles it.
 */
export * from './permissions';
export * from './roles';
export * from './api';
export * from './password-policy';
export * from './people';
export * from './attendance';
