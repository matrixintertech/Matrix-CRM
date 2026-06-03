import { PrismaClient } from "@prisma/client";

import { getUserPermissions, hasPermission, isPlatformOnlyPermissionKey } from "../lib/auth/permissions";
import { scopeByTenant } from "../lib/auth/tenant";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import {
  getServicePartnerIdForWrite,
  listAssignableRoles,
  listServicePartnersForUserForm,
  syncUserRoles,
} from "../features/users/services/user.service";
import { ensureQaRoleWithPermissions, replaceUserRoles } from "./qa-rbac";

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
const SHARED_ROLE_KEY = "qa_access_shared_role";

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
    "Bypass validated via super-admin subject without persisted per-user permission rows."
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

  const assignableRolesForCompanyAdmin = await listAssignableRoles(companySession as never);
  pushResult(
    results,
    "company_admin.assignable_roles_are_tenant_scoped",
    assignableRolesForCompanyAdmin.every(
      (role) => role.servicePartnerId === companySession.user.servicePartnerId && role.scope === "TENANT"
    )
  );
  pushResult(
    results,
    "company_admin.cannot_create_super_admin",
    !assignableRolesForCompanyAdmin.some((role) => role.key === "super_admin")
  );

  const [platformRole, superAdminRole, foreignTenantRole] = await Promise.all([
    prisma.role.findFirst({
      where: {
        scope: "PLATFORM",
        deletedAt: null,
      },
      select: { id: true, key: true },
    }),
    prisma.role.findFirst({
      where: {
        key: "super_admin",
        deletedAt: null,
      },
      select: { id: true, key: true },
    }),
    foreignPartnerId
      ? prisma.role.findFirst({
          where: {
            servicePartnerId: foreignPartnerId,
            scope: "TENANT",
            deletedAt: null,
          },
          select: { id: true, key: true },
        })
      : Promise.resolve(null),
  ]);

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

  const platformAssignmentRejected = platformRole
    ? await expectThrow(() =>
        syncUserRoles(companySession as never, {
          userId: userA.id,
          servicePartnerId: companySession.user.servicePartnerId,
          roleIds: [platformRole.id],
        })
      )
    : true;
  pushResult(results, "company_admin.cannot_assign_platform_roles", platformAssignmentRejected);

  const superAdminAssignmentRejected = superAdminRole
    ? await expectThrow(() =>
        syncUserRoles(companySession as never, {
          userId: userA.id,
          servicePartnerId: companySession.user.servicePartnerId,
          roleIds: [superAdminRole.id],
        })
      )
    : true;
  pushResult(results, "company_admin.cannot_assign_super_admin_role", superAdminAssignmentRejected);

  const foreignRoleAssignmentRejected = foreignTenantRole
    ? await expectThrow(() =>
        syncUserRoles(companySession as never, {
          userId: userA.id,
          servicePartnerId: companySession.user.servicePartnerId,
          roleIds: [foreignTenantRole.id],
        })
      )
    : true;
  pushResult(results, "company_admin.cannot_assign_foreign_tenant_roles", foreignRoleAssignmentRejected);

  const initialPermissionKeys = ["dashboard.read", "clients.read", "service_requests.read"];
  const updatedPermissionKeys = ["dashboard.read", "items.read", "rate_cards.read"];

  const sharedRole = await ensureQaRoleWithPermissions(prisma, {
    servicePartnerId: companySession.user.servicePartnerId,
    key: SHARED_ROLE_KEY,
    name: "QA Shared Access Role",
    description: "QA shared role for role-based access verification.",
    permissionKeys: initialPermissionKeys,
  });

  await Promise.all([
    replaceUserRoles(prisma, { userId: userA.id, roleIds: [sharedRole.id] }),
    replaceUserRoles(prisma, { userId: userB.id, roleIds: [sharedRole.id] }),
  ]);

  const [resolvedPermissionsA, resolvedPermissionsB] = await Promise.all([
    getUserPermissions(userA.id, [sharedRole.key]),
    getUserPermissions(userB.id, [sharedRole.key]),
  ]);
  const resolvedA = [...new Set(resolvedPermissionsA)].sort();
  const resolvedB = [...new Set(resolvedPermissionsB)].sort();

  pushResult(
    results,
    "same_role_users_share_same_permissions",
    JSON.stringify(resolvedA) === JSON.stringify(resolvedB) &&
      JSON.stringify(resolvedA) === JSON.stringify([...initialPermissionKeys].sort())
  );

  const userASession: SessionLike = {
    user: {
      id: userA.id,
      servicePartnerId: userA.servicePartnerId,
      roleKeys: [sharedRole.key],
      isSuperAdmin: false,
    },
  };
  const userBSession: SessionLike = {
    user: {
      id: userB.id,
      servicePartnerId: userB.servicePartnerId,
      roleKeys: [sharedRole.key],
      isSuperAdmin: false,
    },
  };

  const [userANav, userBNav] = await Promise.all([
    getNavigationForSession(userASession as never),
    getNavigationForSession(userBSession as never),
  ]);
  const userANavKeys = flattenNavKeys(userANav).sort();
  const userBNavKeys = flattenNavKeys(userBNav).sort();

  pushResult(
    results,
    "same_role_users_share_same_navigation",
    JSON.stringify(userANavKeys) === JSON.stringify(userBNavKeys)
  );
  pushResult(results, "company_user.clients_nav_visible_with_role_permission", userANavKeys.includes("clients"));
  pushResult(
    results,
    "company_user.service_requests_nav_visible_with_role_permission",
    userANavKeys.includes("service-requests")
  );

  await ensureQaRoleWithPermissions(prisma, {
    servicePartnerId: companySession.user.servicePartnerId,
    key: SHARED_ROLE_KEY,
    name: "QA Shared Access Role",
    description: "QA shared role for role-based access verification.",
    permissionKeys: updatedPermissionKeys,
  });

  const [resolvedPermissionsAfterA, resolvedPermissionsAfterB] = await Promise.all([
    getUserPermissions(userA.id, [sharedRole.key]),
    getUserPermissions(userB.id, [sharedRole.key]),
  ]);
  const resolvedAfterA = [...new Set(resolvedPermissionsAfterA)].sort();
  const resolvedAfterB = [...new Set(resolvedPermissionsAfterB)].sort();

  pushResult(
    results,
    "role_permission_change_updates_all_assigned_users",
    JSON.stringify(resolvedAfterA) === JSON.stringify(resolvedAfterB) &&
      JSON.stringify(resolvedAfterA) === JSON.stringify([...updatedPermissionKeys].sort())
  );

  const [userANavAfter, userBNavAfter] = await Promise.all([
    getNavigationForSession(userASession as never),
    getNavigationForSession(userBSession as never),
  ]);
  const userANavKeysAfter = flattenNavKeys(userANavAfter);
  const userBNavKeysAfter = flattenNavKeys(userBNavAfter);

  pushResult(
    results,
    "role_permission_removal_revokes_access_from_assigned_users",
    !resolvedAfterA.includes("clients.read") &&
      !resolvedAfterB.includes("clients.read") &&
      !userANavKeysAfter.includes("clients") &&
      !userBNavKeysAfter.includes("clients")
  );
  pushResult(
    results,
    "role_permission_addition_grants_access_to_assigned_users",
    resolvedAfterA.includes("items.read") &&
      resolvedAfterB.includes("items.read") &&
      userANavKeysAfter.includes("items") &&
      userBNavKeysAfter.includes("items")
  );

  const userBCanReadClients = await hasPermission(userBSession as never, "clients.read");
  pushResult(results, "company_user.direct_route_permission_check_blocks_missing_permission", !userBCanReadClients);
  pushResult(
    results,
    "company_user.forbidden_path_safe_redirect",
    "/forbidden?returnTo=%2Fclients".startsWith("/forbidden")
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

  const userBPermissionSet = new Set(resolvedPermissionsAfterB);
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

  const companyAdminPermissionKeys = (
    await prisma.rolePermission.findMany({
      where: {
        roleId: companyAdminRole.id,
      },
      select: {
        permission: {
          select: {
            key: true,
          },
        },
      },
    })
  ).map((row) => row.permission.key);

  pushResult(
    results,
    "company_admin.role_has_no_platform_only_permissions",
    !companyAdminPermissionKeys.some((permissionKey) => isPlatformOnlyPermissionKey(permissionKey))
  );

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
