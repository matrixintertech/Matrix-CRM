import type { Session } from "next-auth";

import { getUserPermissions } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export type SidebarNavItem = {
  id: string;
  key: string;
  label: string;
  href: string;
  icon: string | null;
  children: SidebarNavItem[];
  isDevelopmentFallback?: boolean;
};

type NavigationRow = {
  id: string;
  key: string;
  label: string;
  href: string;
  icon: string | null;
  parentId: string | null;
  sortOrder: number;
  permissions: {
    permission: {
      key: string;
    };
  }[];
};

function canSeeItem(row: NavigationRow, permissionKeys: Set<string>, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) {
    return true;
  }

  if (row.permissions.length === 0) {
    return true;
  }

  return row.permissions.some((entry) => permissionKeys.has(entry.permission.key));
}

function buildTree(rows: NavigationRow[], permissionKeys: Set<string>, isSuperAdmin: boolean): SidebarNavItem[] {
  const sortedRows = [...rows].sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
  const rowsByParent = new Map<string | null, NavigationRow[]>();

  for (const row of sortedRows) {
    const siblings = rowsByParent.get(row.parentId) ?? [];
    siblings.push(row);
    rowsByParent.set(row.parentId, siblings);
  }

  function buildChildren(parentId: string | null): SidebarNavItem[] {
    const items: SidebarNavItem[] = [];

    for (const row of rowsByParent.get(parentId) ?? []) {
      const children = buildChildren(row.id);
      const visible = canSeeItem(row, permissionKeys, isSuperAdmin) || children.length > 0;

      if (visible) {
        items.push({
          id: row.id,
          key: row.key,
          label: row.label,
          href: row.href,
          icon: row.icon,
          children,
        });
      }
    }

    return items;
  }

  return buildChildren(null);
}

export async function getNavigationForSession(session: Session): Promise<SidebarNavItem[]> {
  const rows = await prisma.navigationItem.findMany({
    where: {
      servicePartnerId: session.user.servicePartnerId,
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: {
      id: true,
      key: true,
      label: true,
      href: true,
      icon: true,
      parentId: true,
      sortOrder: true,
      permissions: {
        select: {
          permission: {
            select: { key: true },
          },
        },
      },
    },
  });

  if (rows.length === 0) {
    return [
      {
        id: "dev-fallback-dashboard",
        key: "dashboard",
        label: "Dashboard",
        href: "/",
        icon: null,
        children: [],
        isDevelopmentFallback: true,
      },
    ];
  }

  const permissions = session.user.isSuperAdmin ? [] : await getUserPermissions(session.user.id);
  return buildTree(rows, new Set(permissions), session.user.isSuperAdmin);
}
