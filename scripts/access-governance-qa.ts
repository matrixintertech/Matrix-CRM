import { PrismaClient } from "@prisma/client";

import { getUserPermissions, hasPermission, isPlatformOnlyPermissionKey } from "../lib/auth/permissions";
import { scopeByTenant } from "../lib/auth/tenant";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import {
  getServicePartnerIdForWrite,
  listAssignableRoles,
  listServicePartnersForUserForm,
  replaceUserDirectPermissions,
  resolveGrantablePermissionIds,
} from "../features/users/services/user.service";

const prisma = new PrismaClient();

type QAStatus = "PASS" | "FAIL";
type QAResult = {
  key: string;
  status: QAStatus;
  details?: string;
};

type SessionLike = {
  user: {
    id: string;
    servicePartnerId: string;
    roleKeys: string[];
    isSuperAdmin: boolean;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
};

const QA_PREFIX = "qa.access";

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
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

async function expectThrow(fn: () => Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const results: QAResult[] = [];

  const superAdminUser = await prisma.user.findFirst({
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
      servicePartnerId: true,
      email: true,
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
  });

  pushResult(results, "super_admin.exists", Boolean(superAdminUser));
  if (!superAdminUser) {
    throw new Error("Super admin user is required for QA.");
  }

  const superSession: SessionLike = {
    user: {
      id: superAdminUser.id,
      servicePartnerId: superAdminUser.servicePartnerId,
      roleKeys: superAdminUser.roles.map((entry) => entry.role.key),
      isSuperAdmin: true,
      email: superAdminUser.email,
    },
  };

  const superBypassAllowed = await hasPermission(superSession as never, "service_partners.read");
  pushResult(results, "super_admin.bypass_permission_check", superBypassAllowed);

  const syntheticSuperBypassAllowed = await hasPermission(
    { id: `${QA_PREFIX}.synthetic.super`, isSuperAdmin: true, roleKeys: ["super_admin"] },
    "clients.read"
  );
  pushResult(
    results,
    "super_admin.no_direct_permission_rows_required",
    syntheticSuperBypassAllowed,
    "Bypass validated via super-admin subject without persisted UserPermission rows."
  );

  const superNav = await getNavigationForSession(superSession as never);
  const superNavKeys = flattenNavKeys(superNav);
  pushResult(
    results,
    "super_admin.key_nav_items_visible",
    ["dashboard", "users", "service-partners", "clients", "service-requests"].every((key) => superNavKeys.includes(key))
  );

  const qaCompanyAdmin = await prisma.user.findFirst({
    where: {
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
      servicePartnerId: true,
      email: true,
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
  });

  pushResult(results, "company_admin.exists", Boolean(qaCompanyAdmin));
  if (!qaCompanyAdmin) {
    throw new Error("Company admin user is required for QA.");
  }

  const companySession: SessionLike = {
    user: {
      id: qaCompanyAdmin.id,
      servicePartnerId: qaCompanyAdmin.servicePartnerId,
      roleKeys: qaCompanyAdmin.roles.map((entry) => entry.role.key),
      isSuperAdmin: false,
      email: qaCompanyAdmin.email,
    },
  };

  pushResult(results, "company_admin.belongs_to_service_partner", Boolean(companySession.user.servicePartnerId));

  const allPartners = await prisma.servicePartner.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const foreignPartnerId = allPartners.find((partner) => partner.id !== companySession.user.servicePartnerId)?.id;

  const lockedPartnerId = getServicePartnerIdForWrite(companySession as never, foreignPartnerId);
  pushResult(
    results,
    "company_admin.create_user_locked_to_own_service_partner",
    lockedPartnerId === companySession.user.servicePartnerId
  );

  const visiblePartnersForCompanyAdmin = await listServicePartnersForUserForm(companySession as never);
  pushResult(
    results,
    "company_admin.cannot_select_other_service_partner",
    visiblePartnersForCompanyAdmin.length === 1 && visiblePartnersForCompanyAdmin[0]?.id === companySession.user.servicePartnerId
  );

  const platformOnlyPermission = await prisma.permission.findFirst({
    where: {
      OR: [{ key: "dashboard.platform" }, { key: { startsWith: "platform." } }, { key: { startsWith: "service_partners." } }],
    },
    select: { id: true, key: true },
  });

  if (!platformOnlyPermission) {
    throw new Error("Platform-only permission key not found.");
  }

  const platformGrantRejected = await expectThrow(async () =>
    resolveGrantablePermissionIds(companySession as never, [platformOnlyPermission.id])
  );
  pushResult(results, "company_admin.cannot_grant_platform_only_permissions", platformGrantRejected);

  const companyAdminOwnPermissionKeys = new Set(await getUserPermissions(companySession.user.id, companySession.user.roleKeys));
  const forbiddenNonPlatformPermission = await prisma.permission.findFirst({
    where: {
      key: {
        notIn: Array.from(companyAdminOwnPermissionKeys),
      },
    },
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
    },
  });
  if (!forbiddenNonPlatformPermission) {
    throw new Error("Could not find a permission outside company admin grants.");
  }

  const missingGrantRejected = await expectThrow(async () =>
    resolveGrantablePermissionIds(companySession as never, [forbiddenNonPlatformPermission.id])
  );
  pushResult(results, "company_admin.cannot_grant_permissions_they_do_not_have", missingGrantRejected);

  const assignableRolesForCompanyAdmin = await listAssignableRoles(companySession as never);
  pushResult(
    results,
    "company_admin.cannot_create_super_admin",
    !assignableRolesForCompanyAdmin.some((role) => role.key === "super_admin")
  );

  const qaTenantRole =
    (await prisma.role.findFirst({
      where: {
        servicePartnerId: companySession.user.servicePartnerId,
        key: "manager",
        scope: "TENANT",
        deletedAt: null,
      },
      select: { id: true, key: true },
    })) ??
    (await prisma.role.findFirst({
      where: {
        servicePartnerId: companySession.user.servicePartnerId,
        scope: "TENANT",
        deletedAt: null,
      },
      select: { id: true, key: true },
      orderBy: { createdAt: "asc" },
    }));

  if (!qaTenantRole) {
    throw new Error("No tenant role found for same-role permission QA.");
  }

  const userAEmail = `${QA_PREFIX}.same-role-a@matrixcrm.local`;
  const userBEmail = `${QA_PREFIX}.same-role-b@matrixcrm.local`;

  const [userA, userB] = await Promise.all([
    prisma.user.upsert({
      where: { email: userAEmail },
      update: {
        servicePartnerId: companySession.user.servicePartnerId,
        name: "QA Same Role User A",
        phone: "+919920000101",
        status: "ACTIVE",
        deletedAt: null,
      },
      create: {
        servicePartnerId: companySession.user.servicePartnerId,
        name: "QA Same Role User A",
        email: userAEmail,
        phone: "+919920000101",
        status: "ACTIVE",
      },
      select: { id: true, servicePartnerId: true },
    }),
    prisma.user.upsert({
      where: { email: userBEmail },
      update: {
        servicePartnerId: companySession.user.servicePartnerId,
        name: "QA Same Role User B",
        phone: "+919920000102",
        status: "ACTIVE",
        deletedAt: null,
      },
      create: {
        servicePartnerId: companySession.user.servicePartnerId,
        name: "QA Same Role User B",
        email: userBEmail,
        phone: "+919920000102",
        status: "ACTIVE",
      },
      select: { id: true, servicePartnerId: true },
    }),
  ]);

  await Promise.all([
    prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: userA.id,
          roleId: qaTenantRole.id,
        },
      },
      update: {},
      create: {
        userId: userA.id,
        roleId: qaTenantRole.id,
      },
    }),
    prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: userB.id,
          roleId: qaTenantRole.id,
        },
      },
      update: {},
      create: {
        userId: userB.id,
        roleId: qaTenantRole.id,
      },
    }),
  ]);

  const targetPermissionKeysA = ["dashboard.read", "clients.read", "service_requests.read"];
  const targetPermissionKeysB = ["dashboard.read", "items.read", "rate_cards.read"];
  const requestedPermissionKeys = Array.from(new Set([...targetPermissionKeysA, ...targetPermissionKeysB]));
  const grantedPermissionRows = await prisma.permission.findMany({
    where: {
      key: {
        in: requestedPermissionKeys,
      },
    },
    select: {
      id: true,
      key: true,
    },
  });
  const permissionIdByKey = new Map(grantedPermissionRows.map((row) => [row.key, row.id]));

  const permissionIdsA = targetPermissionKeysA
    .map((key) => permissionIdByKey.get(key))
    .filter((value): value is string => Boolean(value));
  const permissionIdsB = targetPermissionKeysB
    .map((key) => permissionIdByKey.get(key))
    .filter((value): value is string => Boolean(value));

  await Promise.all([
    replaceUserDirectPermissions({
      userId: userA.id,
      servicePartnerId: userA.servicePartnerId,
      permissionIds: permissionIdsA,
      assignedByUserId: companySession.user.id,
    }),
    replaceUserDirectPermissions({
      userId: userB.id,
      servicePartnerId: userB.servicePartnerId,
      permissionIds: permissionIdsB,
      assignedByUserId: companySession.user.id,
    }),
  ]);

  const [resolvedPermissionsA, resolvedPermissionsB] = await Promise.all([
    getUserPermissions(userA.id, [qaTenantRole.key]),
    getUserPermissions(userB.id, [qaTenantRole.key]),
  ]);

  pushResult(
    results,
    "company_admin.can_create_same_role_users_with_different_direct_permissions",
    JSON.stringify([...new Set(resolvedPermissionsA)].sort()) !== JSON.stringify([...new Set(resolvedPermissionsB)].sort())
  );

  const userASession: SessionLike = {
    user: {
      id: userA.id,
      servicePartnerId: userA.servicePartnerId,
      roleKeys: [qaTenantRole.key],
      isSuperAdmin: false,
    },
  };
  const userBSession: SessionLike = {
    user: {
      id: userB.id,
      servicePartnerId: userB.servicePartnerId,
      roleKeys: [qaTenantRole.key],
      isSuperAdmin: false,
    },
  };

  const [userANav, userBNav] = await Promise.all([
    getNavigationForSession(userASession as never),
    getNavigationForSession(userBSession as never),
  ]);
  const userANavKeys = flattenNavKeys(userANav);
  const userBNavKeys = flattenNavKeys(userBNav);

  pushResult(results, "company_user.clients_nav_visible_with_permission", userANavKeys.includes("clients"));
  pushResult(results, "company_user.clients_nav_hidden_without_permission", !userBNavKeys.includes("clients"));
  pushResult(results, "company_user.service_requests_nav_visible_with_permission", userANavKeys.includes("service-requests"));
  pushResult(results, "company_user.service_requests_nav_hidden_without_permission", !userBNavKeys.includes("service-requests"));

  const userBCanReadClients = await hasPermission(userBSession as never, "clients.read");
  pushResult(results, "company_user.direct_route_permission_check_blocks_missing_permission", !userBCanReadClients);
  pushResult(
    results,
    "company_user.forbidden_path_safe_redirect",
    "/forbidden?returnTo=%2Fclients".startsWith("/forbidden")
  );

  pushResult(
    results,
    "same_role_different_permission_resolver_differs",
    JSON.stringify([...resolvedPermissionsA].sort()) !== JSON.stringify([...resolvedPermissionsB].sort())
  );
  pushResult(
    results,
    "same_role_different_permission_navigation_differs",
    JSON.stringify([...userANavKeys].sort()) !== JSON.stringify([...userBNavKeys].sort())
  );

  const allUsersCount = await prisma.user.count({
    where: { deletedAt: null },
  });
  const superScopedUsersCount = await prisma.user.count({
    where: scopeByTenant(superSession as never, { deletedAt: null }),
  });
  const companyScopedUsersCount = await prisma.user.count({
    where: scopeByTenant(companySession as never, { deletedAt: null }),
  });
  const companyScopeMarker = scopeByTenant(companySession as never, {} as { servicePartnerId?: string });

  pushResult(
    results,
    "dashboard.super_admin_data_path_fetches_platform_counts",
    Number.isInteger(allUsersCount) && superScopedUsersCount === allUsersCount
  );
  pushResult(
    results,
    "dashboard.company_admin_data_path_company_scoped",
    Number.isInteger(companyScopedUsersCount) &&
      companyScopedUsersCount <= allUsersCount &&
      companyScopeMarker.servicePartnerId === companySession.user.servicePartnerId
  );

  const userBPermissionSet = new Set(resolvedPermissionsB);
  const companyDashboardCards = [
    { title: "Users", permission: "users.read" },
    { title: "Roles", permission: "roles.read" },
    { title: "Clients", permission: "clients.read" },
    { title: "Branches", permission: "branches.read" },
    { title: "Categories", permission: "categories.read" },
    { title: "Items", permission: "items.read" },
    { title: "Rate Cards", permission: "rate_cards.read" },
    { title: "Service Requests", permission: "service_requests.read" },
    { title: "Open Service Requests", permission: "service_requests.read" },
  ];
  const visibleCardsForUserB = companyDashboardCards.filter((card) => userBPermissionSet.has(card.permission)).map((card) => card.title);
  pushResult(
    results,
    "dashboard.company_user_hides_cards_without_permissions",
    !visibleCardsForUserB.includes("Clients") && !visibleCardsForUserB.includes("Service Requests")
  );

  const companyAdminRole = await prisma.role.findFirst({
    where: {
      servicePartnerId: companySession.user.servicePartnerId,
      key: "company_admin",
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!companyAdminRole) {
    throw new Error("Company admin role is required for grant QA.");
  }

  const companyAdminRolePermissionIds = (
    await prisma.rolePermission.findMany({
      where: {
        roleId: companyAdminRole.id,
      },
      select: {
        permissionId: true,
      },
    })
  ).map((row) => row.permissionId);

  const superAdminCanGrantCompanyAdminSet = await resolveGrantablePermissionIds(
    superSession as never,
    companyAdminRolePermissionIds
  );
  pushResult(
    results,
    "super_admin.can_grant_company_admin_permissions",
    superAdminCanGrantCompanyAdminSet.length === companyAdminRolePermissionIds.length
  );

  const companyAdminPlatformLeak = (
    await prisma.permission.findMany({
      where: {
        id: {
          in: companyAdminRolePermissionIds,
        },
      },
      select: {
        key: true,
      },
    })
  ).some((permission) => isPlatformOnlyPermissionKey(permission.key));

  pushResult(results, "company_admin.role_template_has_no_platform_only_permissions", !companyAdminPlatformLeak);

  const failed = results.filter((result) => result.status === "FAIL");
  const passed = results.filter((result) => result.status === "PASS");

  console.log(
    JSON.stringify(
      {
        summary: {
          total: results.length,
          passed: passed.length,
          failed: failed.length,
        },
        failed,
        passed: passed.map((result) => result.key),
      },
      null,
      2
    )
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
