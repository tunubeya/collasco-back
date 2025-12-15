-- Backfill targetCaseIds for historical test runs so they capture the
-- test cases that already had recorded results. This ensures older runs
-- get an explicit custom scope matching their executed cases.
UPDATE "public"."TestRun" AS tr
SET
  "targetCaseIds" = sub."caseIds",
  "isTargetScopeCustom" = TRUE
FROM (
  SELECT
    "testRunId",
    ARRAY_AGG(DISTINCT "testCaseId" ORDER BY "testCaseId") AS "caseIds"
  FROM "public"."TestResult"
  GROUP BY "testRunId"
) AS sub
WHERE
  tr."id" = sub."testRunId"
  AND COALESCE(ARRAY_LENGTH(tr."targetCaseIds", 1), 0) = 0;
