import type { ActivityEntityType, Prisma } from "@prisma/client";

import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type LogActivityInput = {
  action: string;
  module: string;
  entityType: ActivityEntityType;
  entityId?: string | null;
  message?: string;
  metadata?: Prisma.InputJsonValue;
  servicePartnerId?: string;
};

export async function logActivity(input: LogActivityInput): Promise<void> {
  const session = await getCurrentSession();
  const servicePartnerId = input.servicePartnerId ?? session?.user.servicePartnerId;

  if (!servicePartnerId) {
    return;
  }

  await prisma.activityLog.create({
    data: {
      servicePartnerId,
      actorUserId: session?.user.id ?? null,
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      message: input.message,
      metadata: input.metadata,
    },
  });
}
