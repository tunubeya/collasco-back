import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function subtractMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setMonth(copy.getMonth() - months);
  return copy;
}

async function main() {
  const cutoff = subtractMonths(new Date(), 6);

  const [features, modules, labels, projects] = await prisma.$transaction([
    prisma.feature.deleteMany({
      where: { deletedAt: { lte: cutoff } },
    }),
    prisma.module.deleteMany({
      where: { deletedAt: { lte: cutoff } },
    }),
    prisma.projectLabel.deleteMany({
      where: { deletedAt: { lte: cutoff } },
    }),
    prisma.project.deleteMany({
      where: { deletedAt: { lte: cutoff } },
    }),
  ]);

  console.log('Soft-deleted purge complete');
  console.log({
    cutoff: cutoff.toISOString(),
    deletedFeatures: features.count,
    deletedModules: modules.count,
    deletedProjectLabels: labels.count,
    deletedProjects: projects.count,
  });
}

main()
  .catch((err) => {
    console.error('Soft-deleted purge failed');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
