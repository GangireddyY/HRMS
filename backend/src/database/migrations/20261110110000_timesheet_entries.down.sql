-- Back to one row per project and activity with minutes for each day (times and notes are dropped).
UPDATE "timesheets" t
SET "entries" = COALESCE(
    (
        SELECT jsonb_agg(jsonb_build_object('project', g.project, 'task', g.activity, 'minutes', g.minutes))
        FROM (
            SELECT e->>'project' AS project, e->'activity' AS activity,
                   jsonb_build_array(
                       SUM(CASE WHEN (e->>'day')::int = 0 THEN (e->>'minutes')::int ELSE 0 END),
                       SUM(CASE WHEN (e->>'day')::int = 1 THEN (e->>'minutes')::int ELSE 0 END),
                       SUM(CASE WHEN (e->>'day')::int = 2 THEN (e->>'minutes')::int ELSE 0 END),
                       SUM(CASE WHEN (e->>'day')::int = 3 THEN (e->>'minutes')::int ELSE 0 END),
                       SUM(CASE WHEN (e->>'day')::int = 4 THEN (e->>'minutes')::int ELSE 0 END),
                       SUM(CASE WHEN (e->>'day')::int = 5 THEN (e->>'minutes')::int ELSE 0 END),
                       SUM(CASE WHEN (e->>'day')::int = 6 THEN (e->>'minutes')::int ELSE 0 END)
                   ) AS minutes
            FROM jsonb_array_elements(t."entries") AS e
            GROUP BY e->>'project', e->'activity'
        ) g
    ),
    '[]'::jsonb
)
WHERE jsonb_array_length(t."entries") > 0;

ALTER TABLE "timesheets" RENAME COLUMN "entries" TO "lines";
