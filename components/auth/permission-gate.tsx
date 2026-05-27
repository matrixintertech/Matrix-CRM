import type { ReactNode } from "react";

import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentSession } from "@/lib/auth/session";

export async function PermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const session = await getCurrentSession();

  if (!session || !(await hasPermission(session, permission))) {
    return null;
  }

  return children;
}
