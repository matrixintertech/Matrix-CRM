import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type NavRow = {
  id: string;
  key: string;
  parentId: string | null;
  permissionKeys: string[];
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
    },
    take: 3,
  });

  const superAdminBypass = await Promise.all(
    superAdminUsers.map(async (user) => {
      const directCount = await prisma.userPermission.count({
        where: {
          userId: user.id,
        },
      });
      return {
        email: user.email,
        hasDirectPermissionRows: directCount > 0,
      };
    })
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

  let projectManagerRole = await prisma.role.findFirst({
    where: {
      servicePartnerId: tenant.id,
      key: "project_manager",
      scope: "TENANT",
      deletedAt: null,
    },
    select: {
      id: true,
      key: true,
      name: true,
    },
  });

  if (!projectManagerRole) {
    projectManagerRole = await prisma.role.create({
      data: {
        servicePartnerId: tenant.id,
        name: "Project Manager",
        key: "project_manager",
        scope: "TENANT",
        isSystem: false,
      },
      select: {
        id: true,
        key: true,
        name: true,
      },
    });
  }

  const qaUsers = [
    { email: "qa.pm.usera@matrixcrm.local", name: "QA PM User A", phone: "+919910000101" },
    { email: "qa.pm.userb@matrixcrm.local", name: "QA PM User B", phone: "+919910000102" },
  ];

  const savedUsers: { id: string; email: string | null }[] = [];
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
      },
    });

    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: projectManagerRole.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: projectManagerRole.id,
      },
    });

    savedUsers.push(user);
  }

  const permissionKeysA = ["dashboard.read", "clients.read", "service_requests.read"];
  const permissionKeysB = ["dashboard.read", "items.read", "rate_cards.read"];
  const requiredPermissionKeys = Array.from(new Set([...permissionKeysA, ...permissionKeysB]));

  const requiredPermissions = await prisma.permission.findMany({
    where: {
      key: {
        in: requiredPermissionKeys,
      },
    },
    select: {
      id: true,
      key: true,
    },
  });
  const permissionIdByKey = new Map(requiredPermissions.map((permission) => [permission.key, permission.id]));

  async function assignDirectPermissions(userId: string, permissionKeys: string[]) {
    await prisma.userPermission.deleteMany({
      where: {
        userId,
      },
    });

    for (const permissionKey of permissionKeys) {
      const permissionId = permissionIdByKey.get(permissionKey);
      if (!permissionId) {
        throw new Error(`Missing permission ${permissionKey}`);
      }
      await prisma.userPermission.create({
        data: {
          userId,
          permissionId,
          allowed: true,
          servicePartnerId: tenantId,
        },
      });
    }
  }

  const userARecord = savedUsers[0];
  const userBRecord = savedUsers[1];
  if (!userARecord || !userBRecord) {
    throw new Error("Failed to create QA users.");
  }
  await assignDirectPermissions(userARecord.id, permissionKeysA);
  await assignDirectPermissions(userBRecord.id, permissionKeysB);

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

  const navA = buildVisibleKeys(navRows, new Set(permissionKeysA), false);
  const navB = buildVisibleKeys(navRows, new Set(permissionKeysB), false);

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
      directPermissions: {
        where: { allowed: true },
        select: {
          permission: {
            select: {
              key: true,
            },
          },
        },
      },
    },
  });

  const companyAdminChecks = companyAdmin
    ? {
        assignableRoleIncludesSuperAdmin: (
          await prisma.role.findMany({
            where: {
              servicePartnerId: tenantId,
              deletedAt: null,
              scope: "TENANT",
            },
            select: { key: true },
          })
        ).some((role) => role.key === "super_admin"),
        hasSuperAdminRoleAssigned: companyAdmin.roles.some((entry) => entry.role.key === "super_admin"),
        hasPlatformPermissionsDirectly: companyAdmin.directPermissions.some((entry) => {
          const key = entry.permission.key;
          return key === "dashboard.platform" || key.startsWith("platform.") || key.startsWith("service_partners.");
        }),
        assignablePermissionIncludesPlatformOnly:
          companyAdmin.directPermissions
            .map((entry) => entry.permission.key)
            .filter(
              (key) =>
                !(key === "dashboard.platform" || key.startsWith("platform.") || key.startsWith("service_partners."))
            )
            .some((key) => key === "dashboard.platform" || key.startsWith("platform.") || key.startsWith("service_partners.")),
      }
    : null;

  console.log(
    JSON.stringify(
      {
        superAdminBypass,
        tenantCode,
        sameRoleScenario: {
          roleKey: projectManagerRole.key,
          userA: {
            email: userARecord.email,
            permissionKeys: permissionKeysA,
            visibleNavKeys: navA,
            itemsBlocked: !permissionKeysA.includes("items.read"),
          },
          userB: {
            email: userBRecord.email,
            permissionKeys: permissionKeysB,
            visibleNavKeys: navB,
            clientsBlocked: !permissionKeysB.includes("clients.read"),
          },
        },
        companyAdminChecks,
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
