import {
  Prisma,
  PrismaClient,
  UserRole,
  ProjectStatus,
  Visibility,
  ProjectMemberRole,
  FeaturePriority,
  FeatureStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // === Usuarios base ===
  const admin = await prisma.user.upsert({
    where: { email: 'admin@local.test' },
    update: {},
    create: {
      email: 'admin@local.test',
      passwordHash: await bcrypt.hash('Admin123!', 10),
      role: UserRole.ADMIN,
      name: 'Admin',
    },
  });

  const dev = await prisma.user.upsert({
    where: { email: 'dev@local.test' },
    update: {},
    create: {
      email: 'dev@local.test',
      passwordHash: await bcrypt.hash('Dev123456', 10),
      role: UserRole.DEVELOPER,
      name: 'Dev One',
    },
  });

  const tester = await prisma.user.upsert({
    where: { email: 'tester@local.test' },
    update: {},
    create: {
      email: 'tester@local.test',
      passwordHash: await bcrypt.hash('Tester123456', 10),
      role: UserRole.TESTER,
      name: 'QA Tester',
    },
  });

  // === Proyecto de ejemplo: owner = admin ===
  const project = await prisma.project.create({
    data: {
      name: 'Alpha',
      slug: 'alpha',
      description: 'Proyecto seed con módulos/features',
      status: ProjectStatus.ACTIVE,
      visibility: Visibility.PRIVATE,
      ownerId: admin.id,
      // si quieres vincular repo, pon repositoryUrl aquí
      members: {
        create: [
          { userId: admin.id, role: ProjectMemberRole.OWNER }, // owner también como miembro
          { userId: dev.id, role: ProjectMemberRole.DEVELOPER },
          { userId: tester.id, role: ProjectMemberRole.VIEWER },
        ],
      },
    },
  });

  // === Módulos ===
  const root = await prisma.module.create({
    data: {
      projectId: project.id,
      name: 'Root',
      description: 'Módulo raíz',
      isRoot: true,
      sortOrder: 0,
      lastModifiedById: admin.id,
    },
  });

  const backend = await prisma.module.create({
    data: {
      projectId: project.id,
      parentModuleId: root.id,
      name: 'Backend',
      description: 'Servicios y API',
      isRoot: false,
      sortOrder: 0,
      lastModifiedById: dev.id,
    },
  });

  const frontend = await prisma.module.create({
    data: {
      projectId: project.id,
      parentModuleId: root.id,
      name: 'Frontend',
      description: 'UI web',
      isRoot: false,
      sortOrder: 1,
      lastModifiedById: dev.id,
    },
  });

  // === Features (en Backend) ===
  const featAuth = await prisma.feature.create({
    data: {
      moduleId: backend.id,
      name: 'Auth',
      description: 'Login/JWT',
      priority: FeaturePriority.HIGH,
      status: FeatureStatus.PENDING,
      lastModifiedById: dev.id,
      sortOrder: 0,
    },
  });

  const featPayments = await prisma.feature.create({
    data: {
      moduleId: backend.id,
      name: 'Payments',
      description: 'Integración con pasarela',
      priority: FeaturePriority.MEDIUM,
      status: FeatureStatus.PENDING,
      lastModifiedById: dev.id,
      sortOrder: 1,
    },
  });

  // === Versiones de Features (v1) + publicar
  const fvAuthV1 = await prisma.featureVersion.create({
    data: {
      featureId: featAuth.id,
      versionNumber: 1,
      name: featAuth.name,
      description: featAuth.description,
      priority: featAuth.priority,
      status: featAuth.status,
      createdById: dev.id,
      // contentHash opcional: lo dejamos null en seed
    },
  });

  const fvPayV1 = await prisma.featureVersion.create({
    data: {
      featureId: featPayments.id,
      versionNumber: 1,
      name: featPayments.name,
      description: featPayments.description,
      priority: featPayments.priority,
      status: featPayments.status,
      createdById: dev.id,
    },
  });

  await prisma.feature.update({
    where: { id: featAuth.id },
    data: { publishedVersionId: fvAuthV1.id },
  });
  await prisma.feature.update({
    where: { id: featPayments.id },
    data: { publishedVersionId: fvPayV1.id },
  });

  // === Versiones de Módulos (v1) con pins y publicar
  const mvBackendV1 = await prisma.moduleVersion.create({
    data: {
      moduleId: backend.id,
      versionNumber: 1,
      name: backend.name,
      description: backend.description,
      isRoot: backend.isRoot,
      createdById: dev.id,
      featurePins: [
        { featureId: featAuth.id, versionNumber: 1 },
        { featureId: featPayments.id, versionNumber: 1 },
      ] as unknown as Prisma.JsonArray,
      // childrenPins vacío: backend no tiene hijos
    },
  });

  const mvFrontendV1 = await prisma.moduleVersion.create({
    data: {
      moduleId: frontend.id,
      versionNumber: 1,
      name: frontend.name,
      description: frontend.description,
      isRoot: frontend.isRoot,
      createdById: dev.id,
      featurePins: [] as unknown as Prisma.JsonArray,
    },
  });

  const mvRootV1 = await prisma.moduleVersion.create({
    data: {
      moduleId: root.id,
      versionNumber: 1,
      name: root.name,
      description: root.description,
      isRoot: root.isRoot,
      createdById: admin.id,
      childrenPins: [
        { moduleId: backend.id, versionNumber: 1 },
        { moduleId: frontend.id, versionNumber: 1 },
      ] as unknown as Prisma.JsonArray,
    },
  });

  await prisma.module.update({
    where: { id: backend.id },
    data: { publishedVersionId: mvBackendV1.id },
  });
  await prisma.module.update({
    where: { id: frontend.id },
    data: { publishedVersionId: mvFrontendV1.id },
  });
  await prisma.module.update({ where: { id: root.id }, data: { publishedVersionId: mvRootV1.id } });

  console.log('✅ Seed completado');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
