import { env } from "../lib/config/env";
import { createPrismaClient } from "../lib/db/client";

const prisma = createPrismaClient();

function getCutoffDate(retentionDays: number) {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const retentionDays = env().ACTIVITY_LOG_RETENTION_DAYS;
  const cutoffDate = getCutoffDate(retentionDays);

  const count = await prisma.activityLog.count({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        dryRun,
        retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        matchingLogs: count,
      },
      null,
      2
    )
  );

  if (dryRun || count === 0) {
    return;
  }

  const result = await prisma.activityLog.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        deletedCount: result.count,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
