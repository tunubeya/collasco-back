-- AlterTable
ALTER TABLE "public"."ProjectLabel" ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ProjectLabel_projectId_displayOrder_idx" ON "public"."ProjectLabel"("projectId", "displayOrder");
