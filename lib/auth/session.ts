import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function getCurrentSession() {
  return auth();
}

export async function getCurrentUser(sessionInput?: Awaited<ReturnType<typeof getCurrentSession>>) {
  const session = sessionInput ?? (await getCurrentSession());
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  return prisma.user.findFirst({
    where: {
      id: userId,
      servicePartnerId: session.user.servicePartnerId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      name: true,
      email: true,
      phone: true,
      status: true,
    },
  });
}

export async function requireAuth() {
  const session = await getCurrentSession();

  if (!session?.user?.id || !session.user.servicePartnerId) {
    redirect("/login");
  }

  const user = await getCurrentUser(session);
  if (!user) {
    redirect("/login");
  }

  return session;
}
