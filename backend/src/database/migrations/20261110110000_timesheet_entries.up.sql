-- Timesheets become day-by-day activities (project, activity, From–To or a duration, note) instead of one row per
-- project with minutes for each day. Existing rows are converted: one entry per project and day with time on it.
ALTER TABLE "timesheets" RENAME COLUMN "lines" TO "entries";

UPDATE "timesheets" t
SET "entries" = COALESCE(
    (
        SELECT jsonb_agg(
                   jsonb_build_object(
                       'day', d.i - 1,
                       'project', x.line->>'project',
                       'activity', x.line->'task',
                       'start', NULL,
                       'end', NULL,
                       'minutes', (x.line->'minutes'->>(d.i - 1))::int,
                       'note', NULL
                   )
                   ORDER BY d.i, x.ord
               )
        FROM jsonb_array_elements(t."entries") WITH ORDINALITY AS x(line, ord)
        CROSS JOIN generate_series(1, 7) AS d(i)
        WHERE COALESCE((x.line->'minutes'->>(d.i - 1))::int, 0) > 0
    ),
    '[]'::jsonb
)
WHERE jsonb_array_length(t."entries") > 0 AND jsonb_typeof(t."entries"->0->'minutes') = 'array';
