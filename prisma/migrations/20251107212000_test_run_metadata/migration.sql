-- AlterTable
ALTER TABLE "public"."TestRun"
ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'unspecified',
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Unnamed run';

-- Optional: give feature runs a nicer default name
UPDATE "public"."TestRun" AS tr
SET "name" = COALESCE(f."name", 'Project run')
FROM "public"."Feature" AS f
WHERE tr."featureId" = f."id";

-- Project-level runs (without feature) keep the generic default unless already set by clients
