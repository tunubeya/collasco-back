-- CreateTable
CREATE TABLE "public"."ManualShareLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "labelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualShareLink_projectId_idx" ON "public"."ManualShareLink"("projectId");

-- CreateIndex
CREATE INDEX "ManualShareLink_createdById_idx" ON "public"."ManualShareLink"("createdById");


-- AddForeignKey
ALTER TABLE "public"."ManualShareLink" ADD CONSTRAINT "ManualShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ManualShareLink" ADD CONSTRAINT "ManualShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
