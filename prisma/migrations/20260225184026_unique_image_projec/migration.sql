/*
  Warnings:

  - A unique constraint covering the columns `[projectId,name]` on the table `DocumentationImage` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."DocumentationImage_entityType_entityId_labelId_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "DocumentationImage_projectId_name_key" ON "public"."DocumentationImage"("projectId", "name");
