-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'DEVELOPER', 'TESTER');

-- CreateEnum
CREATE TYPE "public"."ProjectMemberRole" AS ENUM ('OWNER', 'MAINTAINER', 'DEVELOPER', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'FINISHED');

-- CreateEnum
CREATE TYPE "public"."Visibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "public"."FeaturePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "public"."FeatureStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "public"."ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "public"."UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserRefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserRefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GithubIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "status" "public"."ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "repositoryUrl" TEXT,
    "visibility" "public"."Visibility" NOT NULL DEFAULT 'PRIVATE',
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."ProjectMemberRole" NOT NULL DEFAULT 'DEVELOPER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "public"."ProjectGithubCredential" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenType" TEXT,
    "scopes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectGithubCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Module" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentModuleId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isRoot" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT,
    "depth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastModifiedById" TEXT,
    "publishedVersionId" TEXT,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ModuleVersion" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "parentModuleId" TEXT,
    "isRoot" BOOLEAN,
    "changelog" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRollback" BOOLEAN NOT NULL DEFAULT false,
    "childrenPins" JSONB,
    "featurePins" JSONB,
    "contentHash" TEXT,

    CONSTRAINT "ModuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Feature" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" "public"."FeaturePriority" DEFAULT 'MEDIUM',
    "status" "public"."FeatureStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastModifiedById" TEXT,
    "publishedVersionId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FeatureVersion" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "priority" "public"."FeaturePriority",
    "status" "public"."FeatureStatus",
    "changelog" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRollback" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT,

    CONSTRAINT "FeatureVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IssueElement" (
    "id" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "githubIssueUrl" TEXT,
    "pullRequestUrl" TEXT,
    "repoOwner" TEXT,
    "repoName" TEXT,
    "githubIssueNumber" INTEGER,
    "githubPrNumber" INTEGER,
    "commitHashes" TEXT[],
    "reviewStatus" "public"."ReviewStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueElement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserRefreshToken_tokenHash_key" ON "public"."UserRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserRefreshToken_userId_idx" ON "public"."UserRefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubIdentity_userId_key" ON "public"."GithubIdentity"("userId");

-- CreateIndex
CREATE INDEX "Project_ownerId_idx" ON "public"."Project"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_ownerId_slug_key" ON "public"."Project"("ownerId", "slug");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "public"."ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGithubCredential_projectId_key" ON "public"."ProjectGithubCredential"("projectId");

-- CreateIndex
CREATE INDEX "Module_publishedVersionId_idx" ON "public"."Module"("publishedVersionId");

-- CreateIndex
CREATE INDEX "Module_projectId_parentModuleId_sortOrder_idx" ON "public"."Module"("projectId", "parentModuleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Module_projectId_parentModuleId_name_key" ON "public"."Module"("projectId", "parentModuleId", "name");

-- CreateIndex
CREATE INDEX "ModuleVersion_moduleId_versionNumber_idx" ON "public"."ModuleVersion"("moduleId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleVersion_moduleId_contentHash_key" ON "public"."ModuleVersion"("moduleId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleVersion_moduleId_versionNumber_key" ON "public"."ModuleVersion"("moduleId", "versionNumber");

-- CreateIndex
CREATE INDEX "Feature_publishedVersionId_idx" ON "public"."Feature"("publishedVersionId");

-- CreateIndex
CREATE INDEX "Feature_moduleId_priority_status_idx" ON "public"."Feature"("moduleId", "priority", "status");

-- CreateIndex
CREATE INDEX "Feature_moduleId_sortOrder_idx" ON "public"."Feature"("moduleId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_moduleId_name_key" ON "public"."Feature"("moduleId", "name");

-- CreateIndex
CREATE INDEX "FeatureVersion_featureId_versionNumber_idx" ON "public"."FeatureVersion"("featureId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureVersion_featureId_contentHash_key" ON "public"."FeatureVersion"("featureId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureVersion_featureId_versionNumber_key" ON "public"."FeatureVersion"("featureId", "versionNumber");

-- CreateIndex
CREATE INDEX "IssueElement_featureId_idx" ON "public"."IssueElement"("featureId");

-- CreateIndex
CREATE INDEX "IssueElement_repoOwner_repoName_githubIssueNumber_idx" ON "public"."IssueElement"("repoOwner", "repoName", "githubIssueNumber");

-- CreateIndex
CREATE INDEX "IssueElement_repoOwner_repoName_githubPrNumber_idx" ON "public"."IssueElement"("repoOwner", "repoName", "githubPrNumber");

-- AddForeignKey
ALTER TABLE "public"."UserRefreshToken" ADD CONSTRAINT "UserRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GithubIdentity" ADD CONSTRAINT "GithubIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProjectGithubCredential" ADD CONSTRAINT "ProjectGithubCredential_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Module" ADD CONSTRAINT "Module_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Module" ADD CONSTRAINT "Module_parentModuleId_fkey" FOREIGN KEY ("parentModuleId") REFERENCES "public"."Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Module" ADD CONSTRAINT "Module_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Module" ADD CONSTRAINT "Module_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "public"."ModuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ModuleVersion" ADD CONSTRAINT "ModuleVersion_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "public"."Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ModuleVersion" ADD CONSTRAINT "ModuleVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Feature" ADD CONSTRAINT "Feature_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "public"."Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Feature" ADD CONSTRAINT "Feature_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Feature" ADD CONSTRAINT "Feature_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "public"."FeatureVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeatureVersion" ADD CONSTRAINT "FeatureVersion_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "public"."Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FeatureVersion" ADD CONSTRAINT "FeatureVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."IssueElement" ADD CONSTRAINT "IssueElement_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "public"."Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
