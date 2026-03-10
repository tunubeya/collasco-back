/*
  Custom migration to introduce project-scoped roles/permissions and backfill data.
*/

-- Enable UUID generation if not present
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create tables
CREATE TABLE "public"."Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ProjectRole" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ProjectRolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

CREATE TABLE "public"."ProjectLabelVisibleRole" (
    "labelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "ProjectLabelVisibleRole_pkey" PRIMARY KEY ("labelId","roleId")
);

CREATE TABLE "public"."ProjectLabelReadOnlyRole" (
    "labelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "ProjectLabelReadOnlyRole_pkey" PRIMARY KEY ("labelId","roleId")
);

-- Indexes
CREATE UNIQUE INDEX "Permission_key_key" ON "public"."Permission"("key");
CREATE INDEX "ProjectRole_projectId_idx" ON "public"."ProjectRole"("projectId");
CREATE UNIQUE INDEX "ProjectRole_projectId_name_key" ON "public"."ProjectRole"("projectId", "name");
CREATE INDEX "ProjectRolePermission_permissionId_idx" ON "public"."ProjectRolePermission"("permissionId");
CREATE INDEX "ProjectLabelVisibleRole_roleId_idx" ON "public"."ProjectLabelVisibleRole"("roleId");
CREATE INDEX "ProjectLabelReadOnlyRole_roleId_idx" ON "public"."ProjectLabelReadOnlyRole"("roleId");

-- Add nullable roleId first
ALTER TABLE "public"."ProjectMember" ADD COLUMN "roleId" TEXT;

-- Seed permissions
INSERT INTO "public"."Permission" ("id", "key", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p.key, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('project.read'),
    ('project.update'),
    ('project.delete'),
    ('project.manage_members'),
    ('project.manage_roles'),
    ('project.manage_integrations'),
    ('project.manage_share_links'),
    ('module.read'),
    ('module.write'),
    ('feature.read'),
    ('feature.write'),
    ('qa.read'),
    ('qa.write'),
    ('labels.manage')
) AS p(key)
ON CONFLICT ("key") DO NOTHING;

-- Create default roles per project
INSERT INTO "public"."ProjectRole" ("id", "projectId", "name", "description", "isOwner", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p.id, 'Owner', 'Full access.', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."Project" p;

INSERT INTO "public"."ProjectRole" ("id", "projectId", "name", "description", "isOwner", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p.id, 'Maintainer', 'Manage project, roles, and content.', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."Project" p;

INSERT INTO "public"."ProjectRole" ("id", "projectId", "name", "description", "isOwner", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p.id, 'Developer', 'Read project and write QA items.', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."Project" p;

INSERT INTO "public"."ProjectRole" ("id", "projectId", "name", "description", "isOwner", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p.id, 'Viewer', 'Read-only access.', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."Project" p;

-- Assign permissions to roles
-- Owner gets all permissions
INSERT INTO "public"."ProjectRolePermission" ("roleId", "permissionId")
SELECT r.id, perm.id
FROM "public"."ProjectRole" r
JOIN "public"."Permission" perm ON 1=1
WHERE r."name" = 'Owner';

-- Maintainer permissions
INSERT INTO "public"."ProjectRolePermission" ("roleId", "permissionId")
SELECT r.id, perm.id
FROM "public"."ProjectRole" r
JOIN "public"."Permission" perm ON perm."key" IN (
  'project.read',
  'project.update',
  'project.delete',
  'project.manage_roles',
  'project.manage_share_links',
  'module.read',
  'module.write',
  'feature.read',
  'feature.write',
  'qa.read',
  'qa.write'
)
WHERE r."name" = 'Maintainer';

-- Developer permissions
INSERT INTO "public"."ProjectRolePermission" ("roleId", "permissionId")
SELECT r.id, perm.id
FROM "public"."ProjectRole" r
JOIN "public"."Permission" perm ON perm."key" IN (
  'project.read',
  'module.read',
  'feature.read',
  'qa.read',
  'qa.write'
)
WHERE r."name" = 'Developer';

-- Viewer permissions
INSERT INTO "public"."ProjectRolePermission" ("roleId", "permissionId")
SELECT r.id, perm.id
FROM "public"."ProjectRole" r
JOIN "public"."Permission" perm ON perm."key" IN (
  'project.read',
  'module.read',
  'feature.read',
  'qa.read'
)
WHERE r."name" = 'Viewer';

-- Backfill ProjectMember.roleId from old enum
UPDATE "public"."ProjectMember" pm
SET "roleId" = r.id
FROM "public"."ProjectRole" r
WHERE r."projectId" = pm."projectId"
  AND r."name" = CASE pm."role"
    WHEN 'OWNER' THEN 'Owner'
    WHEN 'MAINTAINER' THEN 'Maintainer'
    WHEN 'DEVELOPER' THEN 'Developer'
    WHEN 'VIEWER' THEN 'Viewer'
    ELSE 'Viewer'
  END;

-- Backfill ProjectLabel visibility relations
INSERT INTO "public"."ProjectLabelVisibleRole" ("labelId", "roleId")
SELECT pl.id, r.id
FROM "public"."ProjectLabel" pl
JOIN LATERAL unnest(pl."visibleToRoles") AS role_enum ON TRUE
JOIN "public"."ProjectRole" r ON r."projectId" = pl."projectId"
  AND r."name" = CASE role_enum
    WHEN 'OWNER' THEN 'Owner'
    WHEN 'MAINTAINER' THEN 'Maintainer'
    WHEN 'DEVELOPER' THEN 'Developer'
    WHEN 'VIEWER' THEN 'Viewer'
    ELSE 'Viewer'
  END;

INSERT INTO "public"."ProjectLabelReadOnlyRole" ("labelId", "roleId")
SELECT pl.id, r.id
FROM "public"."ProjectLabel" pl
JOIN LATERAL unnest(pl."readOnlyRoles") AS role_enum ON TRUE
JOIN "public"."ProjectRole" r ON r."projectId" = pl."projectId"
  AND r."name" = CASE role_enum
    WHEN 'OWNER' THEN 'Owner'
    WHEN 'MAINTAINER' THEN 'Maintainer'
    WHEN 'DEVELOPER' THEN 'Developer'
    WHEN 'VIEWER' THEN 'Viewer'
    ELSE 'Viewer'
  END;

-- Set NOT NULL after backfill
ALTER TABLE "public"."ProjectMember" ALTER COLUMN "roleId" SET NOT NULL;

-- Drop old columns and enum
ALTER TABLE "public"."ProjectLabel" DROP COLUMN "readOnlyRoles", DROP COLUMN "visibleToRoles";
ALTER TABLE "public"."ProjectMember" DROP COLUMN "role";
DROP TYPE "public"."ProjectMemberRole";

-- Foreign keys
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."ProjectRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectRole" ADD CONSTRAINT "ProjectRole_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectRolePermission" ADD CONSTRAINT "ProjectRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."ProjectRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectRolePermission" ADD CONSTRAINT "ProjectRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectLabelVisibleRole" ADD CONSTRAINT "ProjectLabelVisibleRole_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "public"."ProjectLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectLabelVisibleRole" ADD CONSTRAINT "ProjectLabelVisibleRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."ProjectRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectLabelReadOnlyRole" ADD CONSTRAINT "ProjectLabelReadOnlyRole_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "public"."ProjectLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ProjectLabelReadOnlyRole" ADD CONSTRAINT "ProjectLabelReadOnlyRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."ProjectRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Final index
CREATE INDEX "ProjectMember_roleId_idx" ON "public"."ProjectMember"("roleId");
