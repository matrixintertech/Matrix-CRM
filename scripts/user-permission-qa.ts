import { PrismaClient } from "@prisma/client";

import { getUserPermissions, hasPermission, isPlatformOnlyPermissionKey } from "../lib/auth/permissions";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { listAssignableRoles } from "../features/users/services/user.service";
import { ensureQaRoleWithPermissions, replaceUserRoles } from "./qa-rbac";

const prisma = new PrismaClient();

type NavRow = {
  id: string;
  key: string;
  parentId: string | null;
  permissionKeys: string[];
};

type SessionLike = {
  user: {
    id: string;
    servicePartnerId: string;
    roleKeys: string[];
    isSuperAdmin: boolean;
  };
};

function canSeeNavItem(item: NavRow, permissionSet: Set<string>, isSuperAdmin: boolean) {
  if (isSuperAdmin) {
    return true;
  }
  if (item.permissionKeys.length === 0) {
    return true;
  }
  return item.permissionKeys.some((permissionKey) => permissionSet.has(permissionKey));
}

function buildVisibleKeys(rows: NavRow[], permissionSet: Set<string>, isSuperAdmin: boolean) {
  const byParent = new Map<string | null, NavRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(row);
    byParent.set(row.parentId, siblings);
  }

  const visible = new Set<string>();
  function visit(parentId: string | null) {
    const children = byParent.get(parentId) ?? [];
    for (const row of children) {
      visit(row.id);
      const hasVisibleChild = (byParent.get(row.id) ?? []).some((child) => visible.has(child.id));
      if (canSeeNavItem(row, permissionSet, isSuperAdmin) || hasVisibleChild) {
        visible.add(row.id);
      }
    }
  }

  visit(null);
  return rows.filter((row) => visible.has(row.id)).map((row) => row.key);
}

function flattenNavKeys(items: Awaited<ReturnType<typeof getNavigationForSession>>) {
  const keys: string[] = [];
  const visit = (nodeList: typeof items) => {
    for (const node of nodeList) {
      keys.push(node.key);
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(items);
  return keys;
}

async function main() {
  const superAdminUsers = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      roles: {
        some: {
          role: {
            key: "super_admin",
            deletedAt: null,
          },
        },
      },
    },
    select: {
      id: true,
      email: true,
      servicePartnerId: true,
      roles: {
        select: {
          role: {
            select: {
              key: true,
            },
          },
        },
      },
    },
    take: 3,
  });

  const superAdminBypass = await Promise.all(
    superAdminUsers.map(async (user) => ({
      email: user.email,
      roleKeys: user.roles.map((entry) => entry.role.key),
      canReadClients: await hasPermission(
        {
          user: {
            id: user.id,
            servicePartnerId: user.servicePartnerId,
            roleKeys: user.roles.map((entry) => entry.role.key),
            isSuperAdmin: true,
          },
        } as never,
        "clients.read"
      ),
    }))
  );

  const tenant =
    (await prisma.servicePartner.findFirst({
      where: {
        code: "DEVCOMPANY",
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
      },
    })) ??
    (await prisma.servicePartner.findFirst({
      where: {
        deletedAt: null,
        roles: {
          some: {
            key: "company_admin",
            deletedAt: null,
          },
        },
      },
      select: {
        id: true,
        code: true,
      },
    }));

  if (!tenant) {
    throw new Error("No tenant found for QA.");
  }
  const tenantId = tenant.id;
  const tenantCode = tenant.code;

  const roleKey = "project_manager";
  const initialPermissionKeys = ["dashboard.read", "clients.read", "service_requests.read"];
  const updatedPermissionKeys = ["dashboard.read", "items.read", "rate_cards.read"];

  const projectManagerRole = await ensureQaRoleWithPermissions(prisma, {
    servicePartnerId: tenantId,
    key: roleKey,
    name: "Project Manager",
    description: "QA role used to verify role-based access parity.",
    permissionKeys: initialPermissionKeys,
  });

  const qaUsers = [
    { email: "qa.pm.usera@matrixcrm.local", name: "QA PM User A", phone: "+919910000101" },
    { email: "qa.pm.userb@matrixcrm.local", name: "QA PM User B", phone: "+919910000102" },
  ];

  const savedUsers: { id: string; email: string | null; servicePartnerId: string }[] = [];
  for (const qaUser of qaUsers) {
    const user = await prisma.user.upsert({
      where: {
        email: qaUser.email,
      },
      update: {
        servicePartnerId: tenantId,
        name: qaUser.name,
        phone: qaUser.phone,
        status: "ACTIVE",
        deletedAt: null,
      },
      create: {
        servicePartnerId: tenantId,
        name: qaUser.name,
        email: qaUser.email,
        phone: qaUser.phone,
        status: "ACTIVE",
      },
      select: {
        id: true,
        email: true,
        servicePartnerId: true,
      },
    });

    await replaceUserRoles(prisma, {
      userId: user.id,
      roleIds: [projectManagerRole.id],
    });

    savedUsers.push(user);
  }

  const userARecord = savedUsers[0];
  const userBRecord = savedUsers[1];
  if (!userARecord || !userBRecord) {
    throw new Error("Failed to create QA users.");
  }

  const [resolvedAInitial, resolvedBInitial] = await Promise.all([
    getUserPermissions(userARecord.id, [projectManagerRole.key]),
    getUserPermissions(userBRecord.id, [projectManagerRole.key]),
  ]);

  const navRowsRaw = await prisma.navigationItem.findMany({
    where: {
      servicePartnerId: tenantId,
      isActive: true,
    },
    select: {
      id: true,
      key: true,
      parentId: true,
      permissions: {
        select: {
          permission: {
            select: {
              key: true,
            },
          },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  const navRows: NavRow[] = navRowsRaw.map((row) => ({
    id: row.id,
    key: row.key,
    parentId: row.parentId,
    permissionKeys: row.permissions.map((entry) => entry.permission.key),
  }));

  const modelNavInitial = buildVisibleKeys(navRows, new Set(initialPermissionKeys), false);

  const [navAInitial, navBInitial] = await Promise.all([
    getNavigationForSession({
      user: {
        id: userARecord.id,
        servicePartnerId: userARecord.servicePartnerId,
        roleKeys: [projectManagerRole.key],
        isSuperAdmin: false,
      },
    } as never),
    getNavigationForSession({
      user: {
        id: userBRecord.id,
        servicePartnerId: userBRecord.servicePartnerId,
        roleKeys: [projectManagerRole.key],
        isSuperAdmin: false,
      },
    } as never),
  ]);

  await ensureQaRoleWithPermissions(prisma, {
    servicePartnerId: tenantId,
    key: roleKey,
    name: "Project Manager",
    description: "QA role used to verify role-based access parity.",
    permissionKeys: updatedPermissionKeys,
  });

  const [resolvedAUpdated, resolvedBUpdated] = await Promise.all([
    getUserPermissions(userARecord.id, [projectManagerRole.key]),
    getUserPermissions(userBRecord.id, [projectManagerRole.key]),
  ]);

  const [navAUpdated, navBUpdated] = await Promise.all([
    getNavigationForSession({
      user: {
        id: userARecord.id,
        servicePartnerId: userARecord.servicePartnerId,
        roleKeys: [projectManagerRole.key],
        isSuperAdmin: false,
      },
    } as never),
    getNavigationForSession({
      user: {
        id: userBRecord.id,
        servicePartnerId: userBRecord.servicePartnerId,
        roleKeys: [projectManagerRole.key],
        isSuperAdmin: false,
      },
    } as never),
  ]);

  const companyAdmin = await prisma.user.findFirst({
    where: {
      servicePartnerId: tenantId,
      deletedAt: null,
      status: "ACTIVE",
      roles: {
        some: {
          role: {
            key: "company_admin",
            deletedAt: null,
          },
        },
      },
    },
    select: {
      id: true,
      roles: {
        select: {
          role: {
            select: {
              key: true,
              scope: true,
            },
          },
        },
      },
    },
  });

  const companyAdminPermissionKeys = companyAdmin
    ? (
        await prisma.rolePermission.findMany({
          where: {
            role: {
              users: {
                some: {
                  userId: companyAdmin.id,
                },
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
        })
      ).map((entry) => entry.permission.key)
    : [];

  const assignableRolesForCompanyAdmin = companyAdmin
    ? await listAssignableRoles({
        user: {
          id: companyAdmin.id,
          servicePartnerId: tenantId,
          roleKeys: companyAdmin.roles.map((entry) => entry.role.key),
          isSuperAdmin: false,
        },
      } as never)
    : [];

  console.log(
    JSON.stringify(
      {
        superAdminBypass,
        tenantCode,
        sameRoleScenario: {
          roleKey: projectManagerRole.key,
          initialPermissionKeys,
          updatedPermissionKeys,
          samePermissionsInitially:
            JSON.stringify([...resolvedAInitial].sort()) === JSON.stringify([...resolvedBInitial].sort()),
          samePermissionsAfterRoleChange:
            JSON.stringify([...resolvedAUpdated].sort()) === JSON.stringify([...resolvedBUpdated].sort()),
          userA: {
            email: userARecord.email,
            resolvedInitialPermissionKeys: [...resolvedAInitial].sort(),
            resolvedUpdatedPermissionKeys: [...resolvedAUpdated].sort(),
            visibleNavKeysInitial: flattenNavKeys(navAInitial),
            visibleNavKeysUpdated: flattenNavKeys(navAUpdated),
          },
          userB: {
            email: userBRecord.email,
            resolvedInitialPermissionKeys: [...resolvedBInitial].sort(),
            resolvedUpdatedPermissionKeys: [...resolvedBUpdated].sort(),
            visibleNavKeysInitial: flattenNavKeys(navBInitial),
            visibleNavKeysUpdated: flattenNavKeys(navBUpdated),
          },
          navModelInitial: modelNavInitial,
          clientsBlockedAfterRoleChange: !resolvedAUpdated.includes("clients.read") && !resolvedBUpdated.includes("clients.read"),
          itemsGrantedAfterRoleChange: resolvedAUpdated.includes("items.read") && resolvedBUpdated.includes("items.read"),
        },
        companyAdminChecks: companyAdmin
          ? {
              assignableRoleIncludesSuperAdmin: assignableRolesForCompanyAdmin.some((role) => role.key === "super_admin"),
              assignableRolesTenantOnly: assignableRolesForCompanyAdmin.every(
                (role) => role.servicePartnerId === tenantId && role.scope === "TENANT"
              ),
              hasSuperAdminRoleAssigned: companyAdmin.roles.some((entry) => entry.role.key === "super_admin"),
              hasPlatformPermissionsThroughRoles: companyAdminPermissionKeys.some((key) => isPlatformOnlyPermissionKey(key)),
            }
          : null,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
