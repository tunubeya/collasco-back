-- CreateEnum
CREATE TYPE "public"."DocumentationEntityType" AS ENUM ('FEATURE', 'MODULE');

-- CreateTable
CREATE TABLE "public"."DocumentationField" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entityType" "public"."DocumentationEntityType" NOT NULL,
    "featureId" TEXT,
    "moduleId" TEXT,
    "labelId" TEXT NOT NULL,
    "content" TEXT,
    "isNotApplicable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentationField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentationField_labelId_idx" ON "public"."DocumentationField"("labelId");

-- CreateIndex
CREATE INDEX "DocumentationField_featureId_idx" ON "public"."DocumentationField"("featureId");

-- CreateIndex
CREATE INDEX "DocumentationField_moduleId_idx" ON "public"."DocumentationField"("moduleId");

-- CreateIndex
CREATE INDEX "DocumentationField_projectId_idx" ON "public"."DocumentationField"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentationField_projectId_entityType_featureId_moduleId__key" ON "public"."DocumentationField"("projectId", "entityType", "featureId", "moduleId", "labelId");

-- AddForeignKey
ALTER TABLE "public"."DocumentationField" ADD CONSTRAINT "DocumentationField_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentationField" ADD CONSTRAINT "DocumentationField_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "public"."Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentationField" ADD CONSTRAINT "DocumentationField_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "public"."Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentationField" ADD CONSTRAINT "DocumentationField_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "public"."ProjectLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
