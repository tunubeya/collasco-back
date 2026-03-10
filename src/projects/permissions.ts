import { ForbiddenException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';

export const PERMISSION_KEYS = {
  PROJECT_READ: 'project.read',
  PROJECT_UPDATE: 'project.update',
  PROJECT_DELETE: 'project.delete',
  PROJECT_MANAGE_MEMBERS: 'project.manage_members',
  PROJECT_MANAGE_ROLES: 'project.manage_roles',
  PROJECT_MANAGE_INTEGRATIONS: 'project.manage_integrations',
  SHARE_LINKS_MANAGE: 'project.manage_share_links',
  MODULE_READ: 'module.read',
  MODULE_WRITE: 'module.write',
  FEATURE_READ: 'feature.read',
  FEATURE_WRITE: 'feature.write',
  QA_READ: 'qa.read',
  QA_WRITE: 'qa.write',
  LABELS_MANAGE: 'labels.manage',
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export type ProjectRoleDefaults = {
  name: string;
  description?: string;
  isOwner: boolean;
  isDefault: boolean;
  permissions: PermissionKey[];
};

export const DEFAULT_PROJECT_ROLES: ProjectRoleDefaults[] = [
  {
    name: 'Owner',
    description: 'Full access.',
    isOwner: true,
    isDefault: true,
    permissions: Object.values(PERMISSION_KEYS) as PermissionKey[],
  },
  {
    name: 'Maintainer',
    description: 'Manage project, roles, and content.',
    isOwner: false,
    isDefault: true,
    permissions: [
      PERMISSION_KEYS.PROJECT_READ,
      PERMISSION_KEYS.PROJECT_UPDATE,
      PERMISSION_KEYS.PROJECT_DELETE,
      PERMISSION_KEYS.PROJECT_MANAGE_ROLES,
      PERMISSION_KEYS.SHARE_LINKS_MANAGE,
      PERMISSION_KEYS.MODULE_READ,
      PERMISSION_KEYS.MODULE_WRITE,
      PERMISSION_KEYS.FEATURE_READ,
      PERMISSION_KEYS.FEATURE_WRITE,
      PERMISSION_KEYS.QA_READ,
      PERMISSION_KEYS.QA_WRITE,
    ],
  },
  {
    name: 'Developer',
    description: 'Read project and write QA items.',
    isOwner: false,
    isDefault: true,
    permissions: [
      PERMISSION_KEYS.PROJECT_READ,
      PERMISSION_KEYS.MODULE_READ,
      PERMISSION_KEYS.FEATURE_READ,
      PERMISSION_KEYS.QA_READ,
      PERMISSION_KEYS.QA_WRITE,
    ],
  },
  {
    name: 'Viewer',
    description: 'Read-only access.',
    isOwner: false,
    isDefault: true,
    permissions: [
      PERMISSION_KEYS.PROJECT_READ,
      PERMISSION_KEYS.MODULE_READ,
      PERMISSION_KEYS.FEATURE_READ,
      PERMISSION_KEYS.QA_READ,
    ],
  },
];

export const DEFAULT_MEMBER_ROLE_NAME = 'Developer';

type PrismaClientLike = PrismaService | PrismaClient | Prisma.TransactionClient;

export async function ensurePermissionsExist(prisma: PrismaClientLike, keys: PermissionKey[]) {
  if (keys.length === 0) return;
  await prisma.permission.createMany({
    data: keys.map((key) => ({ key })),
    skipDuplicates: true,
  });
}

export async function fetchPermissionIds(prisma: PrismaClientLike, keys: PermissionKey[]) {
  const permissions = await prisma.permission.findMany({
    where: { key: { in: keys } },
    select: { id: true, key: true },
  });
  return new Map(permissions.map((p) => [p.key as PermissionKey, p.id]));
}

export async function hasProjectPermission(
  prisma: PrismaClientLike,
  userId: string,
  projectId: string,
  permission: PermissionKey,
): Promise<boolean> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: {
      role: {
        select: {
          id: true,
          isOwner: true,
          rolePermissions: {
            select: { permission: { select: { key: true } } },
          },
        },
      },
    },
  });

  if (!membership?.role) return false;
  if (membership.role.isOwner) return true;
  return membership.role.rolePermissions.some((rp) => rp.permission.key === permission);
}

export async function requireProjectPermission(
  prisma: PrismaClientLike,
  userId: string,
  projectId: string,
  permission: PermissionKey,
): Promise<void> {
  const ok = await hasProjectPermission(prisma, userId, projectId, permission);
  if (!ok) {
    throw new ForbiddenException('Insufficient permission');
  }
}
