-- CreateTable
CREATE TABLE "public"."FeatureLink" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "linkedFeatureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "FeatureLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeatureLink_featureId_idx" ON "public"."FeatureLink"("featureId");

-- CreateIndex
CREATE INDEX "FeatureLink_linkedFeatureId_idx" ON "public"."FeatureLink"("linkedFeatureId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureLink_featureId_linkedFeatureId_key" ON "public"."FeatureLink"("featureId", "linkedFeatureId");

-- AddForeignKey
ALTER TABLE "public"."FeatureLink" ADD CONSTRAINT "FeatureLink_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "public"."Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeatureLink" ADD CONSTRAINT "FeatureLink_linkedFeatureId_fkey" FOREIGN KEY ("linkedFeatureId") REFERENCES "public"."Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
