import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PERMISSION_KEYS, requireProjectPermission } from 'src/projects/permissions';

export async function assertProjectRead(
  prisma: PrismaService,
  userId: string,
  projectId: string,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { deletedAt: true },
  });
  if (!project || project.deletedAt) {
    throw new NotFoundException('Project not found');
  }

  await requireProjectPermission(prisma, userId, projectId, PERMISSION_KEYS.PROJECT_READ);
}

export async function assertProjectWrite(
  prisma: PrismaService,
  userId: string,
  projectId: string,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { deletedAt: true },
  });
  if (!project || project.deletedAt) {
    throw new NotFoundException('Project not found');
  }

  await requireProjectPermission(prisma, userId, projectId, PERMISSION_KEYS.QA_WRITE);
}
