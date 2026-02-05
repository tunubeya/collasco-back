import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

const READ_ROLES = new Set<string>([
  ProjectMemberRole.OWNER,
  ProjectMemberRole.MAINTAINER,
  ProjectMemberRole.DEVELOPER,
  ProjectMemberRole.VIEWER,
]);

const WRITE_ROLES = new Set<string>([
  ProjectMemberRole.OWNER,
  ProjectMemberRole.MAINTAINER,
  ProjectMemberRole.DEVELOPER,
  'TESTER', // allow dedicated QA members when enum expands
]);

export async function assertProjectRead(prisma: PrismaService, userId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { deletedAt: true },
  });
  if (!project || project.deletedAt) {
    throw new NotFoundException('Project not found');
  }

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });

  if (!membership || !READ_ROLES.has(membership.role)) {
    throw new ForbiddenException('Access denied for project.');
  }
}

export async function assertProjectWrite(prisma: PrismaService, userId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { deletedAt: true },
  });
  if (!project || project.deletedAt) {
    throw new NotFoundException('Project not found');
  }

  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });

  if (!membership || !WRITE_ROLES.has(membership.role)) {
    throw new ForbiddenException('Write access denied for project.');
  }
}