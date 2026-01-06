-- CreateTable
CREATE TABLE "public"."UserProjectPreference" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentationLabelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProjectPreference_pkey" PRIMARY KEY ("userId","projectId")
);

-- CreateIndex
CREATE INDEX "UserProjectPreference_projectId_idx" ON "public"."UserProjectPreference"("projectId");

-- AddForeignKey
ALTER TABLE "public"."UserProjectPreference" ADD CONSTRAINT "UserProjectPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserProjectPreference" ADD CONSTRAINT "UserProjectPreference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
