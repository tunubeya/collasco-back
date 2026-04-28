-- AlterTable
ALTER TABLE "public"."TestRun" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TestRun_deletedAt_idx" ON "public"."TestRun"("deletedAt");
