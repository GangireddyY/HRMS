-- Assets, helpdesk and travel on the standard plans, and team leads seeing what their team holds, for databases
-- where the modules' catalog rows already exist (fresh databases get both from the catalog sync at boot).

INSERT INTO "plan_features" ("id", "plan_id", "feature_id")
SELECT gen_random_uuid(), p."id", f."id"
  FROM "plans" p
  JOIN "features" f ON (p."code" = 'growth' AND f."key" IN ('assets', 'helpdesk')) OR (p."code" = 'enterprise' AND f."key" IN ('assets', 'helpdesk', 'travel'))
 WHERE NOT EXISTS (SELECT 1 FROM "plan_features" x WHERE x."plan_id" = p."id" AND x."feature_id" = f."id");

INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission_id", "scope")
SELECT gen_random_uuid(), r."organization_id", r."id", pm."id", 'TEAM'
  FROM "roles" r
  JOIN "permissions" pm ON pm."key" = 'assets.view'
 WHERE r."key" = 'team_lead' AND r."is_system"
   AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = pm."id");
