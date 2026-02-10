-- CreateTable
CREATE TABLE "public"."DocumentationImage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entityType" "public"."DocumentationEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "DocumentationImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentationImage_projectId_idx" ON "public"."DocumentationImage"("projectId");

-- CreateIndex
CREATE INDEX "DocumentationImage_labelId_idx" ON "public"."DocumentationImage"("labelId");

-- CreateIndex
CREATE INDEX "DocumentationImage_entityType_entityId_idx" ON "public"."DocumentationImage"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentationImage_entityType_entityId_labelId_name_key" ON "public"."DocumentationImage"("entityType", "entityId", "labelId", "name");

-- AddForeignKey
ALTER TABLE "public"."DocumentationImage" ADD CONSTRAINT "DocumentationImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentationImage" ADD CONSTRAINT "DocumentationImage_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "public"."ProjectLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentationImage" ADD CONSTRAINT "DocumentationImage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
