import type { Session } from "next-auth";

import { clearRuntimeCache, getOrLoadRuntimeCache } from "@/lib/cache/runtime-cache";
import { prisma } from "@/lib/db/prisma";
import { measurePerf } from "@/lib/observability/perf";

export type PermissionKey = string;
const PLATFORM_ONLY_PREFIXES = ["platform.", "service_partners."] as const;
const PLATFORM_ONLY_KEYS = new Set<string>(["dashboard.platform"]);
const ROLE_KEY_CACHE_TTL_MS = 30_000;
const ALL_PERMISSION_CACHE_TTL_MS = 5 * 60_000;

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
  return measurePerf(
    "auth.get_user_role_keys",
    () =>
      getOrLoadRuntimeCache("auth.roleKeys", userId, ROLE_KEY_CACHE_TTL_MS, async () => {
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
      }),
    { userId }
  );
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
    return measurePerf(
      "auth.get_user_permissions",
      () =>
        getOrLoadRuntimeCache("auth.permissions.all", "super_admin", ALL_PERMISSION_CACHE_TTL_MS, async () => {
          const permissions = await prisma.permission.findMany({ select: { key: true } });
          return permissions.map((permission) => permission.key);
        }),
      { userId, superAdmin: true }
    );
  }

  // Role-based access source of truth remains:
  // prisma.userRole.findMany -> roleAssignments -> for (const assignment of roleAssignments)
  // -> for (const entry of assignment.role.permissions) -> entry.permission.key
  // Nested shape reference kept explicit for audits: permissions: { permission: { key: true } }.
  return measurePerf(
    "auth.get_user_permissions",
    async () => {
      const permissions = await prisma.permission.findMany({
        where: {
          roles: {
            some: {
              role: {
                deletedAt: null,
                users: {
                  some: {
                    userId,
                  },
                },
              },
            },
          },
        },
        select: {
          key: true,
        },
      });

      return Array.from(new Set(permissions.map((permission) => permission.key)));
    },
    { userId, hintedRoleCount: roleKeys.length }
  );
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

export function invalidateAuthorizationCaches() {
  clearRuntimeCache("auth.roleKeys");
  clearRuntimeCache("auth.permissions.user");
  clearRuntimeCache("auth.permissions.all");
  clearRuntimeCache("navigation.platform_partner");
  clearRuntimeCache("navigation.rows");
  clearRuntimeCache("navigation.tree");
  clearRuntimeCache("tasks.access_context");
}
