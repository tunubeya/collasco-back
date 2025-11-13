-- AlterTable
ALTER TABLE "public"."TestRun"
ADD COLUMN     "isTargetScopeCustom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetCaseIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
