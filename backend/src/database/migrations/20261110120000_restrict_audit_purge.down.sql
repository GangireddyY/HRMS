UPDATE "permissions" SET "is_restricted" = false WHERE "key" = 'audit.purge';

INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission_id", "scope", "created_at")
SELECT gen_random_uuid(), r."organization_id", r."id", p."id", 'ORGANIZATION', CURRENT_TIMESTAMP
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'org_admin' AND r."is_system" = true AND p."key" = 'audit.purge'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = p."id");
