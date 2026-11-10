-- Deleting the audit trail is now a restricted permission: Organization Admin no longer holds it implicitly. Another
-- administrator can still grant it to a dedicated role (never to a role they hold themselves).
UPDATE "permissions" SET "is_restricted" = true WHERE "key" = 'audit.purge';

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id"
  AND rp."permission_id" = p."id"
  AND p."key" = 'audit.purge'
  AND r."key" = 'org_admin'
  AND r."is_system" = true;
