import { forbidden } from "next/navigation";
import type { Session } from "next-auth";

import { requireAuth } from "@/lib/auth/session";

export async function requireTenantAccess(servicePartnerId: string) {
  const session = await requireAuth();

  if (!session.user.isSuperAdmin && session.user.servicePartnerId !== servicePartnerId) {
    forbidden();
  }

  return session;
}

export function scopeByTenant<TWhere extends Record<string, unknown>>(session: Session, where: TWhere): TWhere {
  if (session.user.isSuperAdmin) {
    return where;
  }

  return {
    ...where,
    servicePartnerId: session.user.servicePartnerId,
  };
}
