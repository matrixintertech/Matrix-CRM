import type { Session } from "next-auth";

import { prisma } from "@/lib/db/prisma";

export type PermissionKey =
  | "users.read"
  | "users.create"
  | "users.update"
  | "users.delete"
  | "service_requests.read"
  | "service_requests.create"
  | "service_requests.assign"
  | "service_requests.approve"
  | "inventory.read"
  | "inventory.manage"
  | "payments.read"
  | "payments.create"
  | "reports.read";

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

export async function getUserPermissions(userId: string): Promise<string[]> {
  const roleKeys = await getUserRoleKeys(userId);
  if (roleKeys.includes("super_admin")) {
    const permissions = await prisma.permission.findMany({ select: { key: true } });
    return permissions.map((permission) => permission.key);
  }

  const permissions = await prisma.rolePermission.findMany({
    where: {
      role: {
        deletedAt: null,
        users: {
          some: { userId },
        },
      },
    },
    select: {
      permission: {
        select: {
          key: true,
        },
      },
    },
  });

  return Array.from(new Set(permissions.map((entry) => entry.permission.key)));
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

  const permissions = await getUserPermissions(user.id);
  return permissions.includes(permissionKey);
}
