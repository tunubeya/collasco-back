-- CreateTable
CREATE TABLE "public"."ProjectLabel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "visibleToRoles" "public"."ProjectMemberRole"[] DEFAULT ARRAY[]::"public"."ProjectMemberRole"[],
    "readOnlyRoles" "public"."ProjectMemberRole"[] DEFAULT ARRAY[]::"public"."ProjectMemberRole"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectLabel_projectId_idx" ON "public"."ProjectLabel"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectLabel_projectId_name_key" ON "public"."ProjectLabel"("projectId", "name");

-- AddForeignKey
ALTER TABLE "public"."ProjectLabel" ADD CONSTRAINT "ProjectLabel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
