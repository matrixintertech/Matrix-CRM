import { getUserPermissions, hasPermission } from "@/lib/auth/permissions";
import { redirectForbidden } from "@/lib/auth/access-control";
import { requireAuth } from "@/lib/auth/session";

export async function requirePermission(permissionKey: string) {
  const session = await requireAuth();
  const allowed = await hasPermission(session, permissionKey);

  if (!allowed) {
    redirectForbidden();
  }

  return session;
}

export async function requireAnyPermission(permissionKeys: string[]) {
  const session = await requireAuth();

  if (session.user.isSuperAdmin) {
    return session;
  }

  const permissions = await getUserPermissions(session.user.id);
  if (!permissionKeys.some((permissionKey) => permissions.includes(permissionKey))) {
    redirectForbidden();
  }

  return session;
}

export async function requireAllPermissions(permissionKeys: string[]) {
  const session = await requireAuth();

  if (session.user.isSuperAdmin) {
    return session;
  }

  const permissions = await getUserPermissions(session.user.id);
  if (!permissionKeys.every((permissionKey) => permissions.includes(permissionKey))) {
    redirectForbidden();
  }

  return session;
}
