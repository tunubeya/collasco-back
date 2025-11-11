-- AlterTable
ALTER TABLE "public"."TestRun" ADD COLUMN     "projectId" TEXT;

-- Make featureId nullable to allow project-level runs
ALTER TABLE "public"."TestRun" ALTER COLUMN "featureId" DROP NOT NULL;

-- Backfill projectId using the feature -> module -> project chain
UPDATE "public"."TestRun" AS tr
SET "projectId" = m."projectId"
FROM "public"."Feature" AS f
JOIN "public"."Module"  AS m ON f."moduleId" = m."id"
WHERE tr."featureId" = f."id";

-- Ensure every existing row has a projectId
ALTER TABLE "public"."TestRun" ALTER COLUMN "projectId" SET NOT NULL;

-- Create the foreign key and index for the new relationship
ALTER TABLE "public"."TestRun"
ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TestRun_projectId_runDate_idx" ON "public"."TestRun"("projectId", "runDate");
