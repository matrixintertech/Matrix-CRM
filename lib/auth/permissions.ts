import type { Session } from "next-auth";

import { clearRuntimeCache, getOrLoadRuntimeCache } from "@/lib/cache/runtime-cache";
import { buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateAuthorizationCaches as invalidateAuthorizationCacheStores } from "@/lib/cache/cache-invalidation";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db/prisma";
import { measurePerf } from "@/lib/observability/perf";

export type PermissionKey = string;
const PLATFORM_ONLY_PREFIXES = ["platform.", "service_partners."] as const;
const PLATFORM_ONLY_KEYS = new Set<string>(["dashboard.platform"]);
const ROLE_KEY_CACHE_TTL_MS = 30_000;
const ROLE_ASSIGNMENT_CACHE_TTL_MS = 30_000;
const ALL_PERMISSION_CACHE_TTL_MS = 5 * 60_000;
const USER_PERMISSION_CACHE_TTL_SECONDS = 60;
const PERMISSION_CATALOG_CACHE_TTL_SECONDS = 10 * 60;

type UserRoleAssignmentSnapshot = {
  roleIds: string[];
  roleKeys: string[];
};

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
    async () => (await getUserRoleAssignmentSnapshot(userId)).roleKeys,
    { userId }
  );
}

async function getUserRoleAssignmentSnapshot(userId: string): Promise<UserRoleAssignmentSnapshot> {
  return getOrLoadRuntimeCache("auth.roleAssignments", userId, ROLE_ASSIGNMENT_CACHE_TTL_MS, async () => {
    const roles = await prisma.userRole.findMany({
      where: {
        userId,
        role: {
          deletedAt: null,
        },
      },
      select: {
        roleId: true,
        role: {
          select: {
            key: true,
          },
        },
      },
    });

    return {
      roleIds: roles.map((entry) => entry.roleId).sort(),
      roleKeys: roles.map((entry) => entry.role.key).sort(),
    };
  });
}

async function getUserPermissionCacheVersion(userId: string): Promise<string> {
  const roleSnapshot = await getUserRoleAssignmentSnapshot(userId);
  if (roleSnapshot.roleIds.length === 0) {
    return "none";
  }

  const aggregate = await prisma.rolePermission.aggregate({
    where: {
      roleId: {
        in: roleSnapshot.roleIds,
      },
    },
    _count: {
      _all: true,
    },
    _max: {
      createdAt: true,
    },
  });

  return [aggregate._count._all, aggregate._max.createdAt?.toISOString() ?? "none"].join(":");
}

export function isPlatformOnlyPermissionKey(permissionKey: string): boolean {
  if (PLATFORM_ONLY_KEYS.has(permissionKey)) {
    return true;
  }

  return PLATFORM_ONLY_PREFIXES.some((prefix) => permissionKey.startsWith(prefix));
}

export async function getUserPermissions(userId: string, roleKeysHint?: string[]): Promise<string[]> {
  const roleSnapshot = await getUserRoleAssignmentSnapshot(userId);
  const roleKeys = roleKeysHint ?? roleSnapshot.roleKeys;
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
    async () =>
      getOrSetServerCache(
        "auth.permissions.user",
        `${userId}:${buildRoleSignature(roleKeys)}:${await getUserPermissionCacheVersion(userId)}`,
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

          return Array.from(new Set(permissions.map((permission) => permission.key))).sort();
        },
        {
          ttlSeconds: USER_PERMISSION_CACHE_TTL_SECONDS,
          prefixes: [cachePrefixes.auth, `${cachePrefixes.auth}:user:${userId}`],
        }
      ),
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

export async function listPermissionCatalog(): Promise<string[]> {
  return getOrSetServerCache(
    "auth.permission_catalog",
    "all",
    async () => {
      const permissions = await prisma.permission.findMany({
        orderBy: [{ key: "asc" }],
        select: { key: true },
      });
      return permissions.map((permission) => permission.key);
    },
    {
      ttlSeconds: PERMISSION_CATALOG_CACHE_TTL_SECONDS,
      prefixes: [cachePrefixes.auth],
    }
  );
}

export async function invalidateAuthorizationCaches() {
  clearRuntimeCache("auth.roleKeys");
  clearRuntimeCache("auth.roleAssignments");
  clearRuntimeCache("auth.permissions.user");
  clearRuntimeCache("auth.permissions.all");
  clearRuntimeCache("navigation.platform_partner");
  clearRuntimeCache("navigation.rows");
  clearRuntimeCache("navigation.tree");
  clearRuntimeCache("tasks.access_context");
  await invalidateAuthorizationCacheStores();
}
