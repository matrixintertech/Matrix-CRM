import type { Session } from "next-auth";

import { prisma } from "@/lib/db/prisma";

export type PermissionKey = string;
const PLATFORM_ONLY_PREFIXES = ["platform.", "service_partners."] as const;
const PLATFORM_ONLY_KEYS = new Set<string>(["dashboard.platform"]);

type PermissionSubject =
  | Session
  | {
      id?: string;
      isSuperAdmin?: boolean;
      roleKeys?: string[];
    }
  | string[];

function getSubjectUser(subject: PermissionSubject) {
  if (Array.isArray(subject)) {
    return null;
  }

  if ("user" in subject) {
    return subject.user;
  }

  return subject;
}

export async function getUserRoleKeys(userId: string): Promise<string[]> {
  const roles = await prisma.userRole.findMany({
    where: {
      userId,
      role: {
        deletedAt: null,
      },
    },
    select: {
      role: {
        select: {
          key: true,
        },
      },
    },
  });

  return roles.map((entry) => entry.role.key);
}

export function isPlatformOnlyPermissionKey(permissionKey: string): boolean {
  if (PLATFORM_ONLY_KEYS.has(permissionKey)) {
    return true;
  }

  return PLATFORM_ONLY_PREFIXES.some((prefix) => permissionKey.startsWith(prefix));
}

export async function getUserPermissions(userId: string, roleKeysHint?: string[]): Promise<string[]> {
  const roleKeys = roleKeysHint ?? (await getUserRoleKeys(userId));
  if (roleKeys.includes("super_admin")) {
    const permissions = await prisma.permission.findMany({ select: { key: true } });
    return permissions.map((permission) => permission.key);
  }

  const permissions = await prisma.userPermission.findMany({
    where: {
      userId,
      allowed: true,
    },
    select: {
      permission: {
        select: {
          key: true,
        },
      },
    },
  });

  return permissions.map((entry) => entry.permission.key);
}

export async function hasPermission(subject: PermissionSubject, permissionKey: string): Promise<boolean> {
  if (Array.isArray(subject)) {
    return subject.includes(permissionKey);
  }

  const user = getSubjectUser(subject);
  if (!user?.id) {
    return false;
  }

  if (user.isSuperAdmin || user.roleKeys?.includes("super_admin")) {
    return true;
  }

  const permissions = await getUserPermissions(user.id, user.roleKeys);
  return permissions.includes(permissionKey);
}
