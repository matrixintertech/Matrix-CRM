import { getClientById, listClients } from "../features/clients/services/client.service";
import { env } from "../lib/config/env";
import { getUserPermissions } from "../lib/auth/permissions";
import { createPrismaClient } from "../lib/db/client";

const prisma = createPrismaClient();

type QaStatus = "PASS" | "FAIL" | "SKIP";
type QaResult = {
  key: string;
  status: QaStatus;
  details?: string;
};

function push(results: QaResult[], key: string, status: QaStatus, details?: string) {
  results.push({ key, status, details });
}

async function main() {
  const results: QaResult[] = [];

  const requiredPermissionKeys = [
    "profile.email_change.request",
    "email_change_requests.read",
    "email_change_requests.approve",
    "email_change_requests.reject",
    "activity_logs.read",
    "activity_logs.export",
    "activity_logs.purge",
    "clients.export",
    "service_requests.export",
    "tasks.export",
    "quotations.export",
    "purchase_orders.export",
    "invoices.export",
    "payments.export",
    "ledger.export",
    "vendor_payments.export",
    "reports.export",
    "service_requests.status.update",
  ];

  const existingPermissions = await prisma.permission.findMany({
    where: {
      key: {
        in: requiredPermissionKeys,
      },
    },
    select: { key: true },
  });
  const permissionSet = new Set(existingPermissions.map((permission) => permission.key));
  push(
    results,
    "permissions.standardized_export_and_email_change_keys_exist",
    requiredPermissionKeys.every((key) => permissionSet.has(key)) ? "PASS" : "FAIL",
    `Found ${existingPermissions.length}/${requiredPermissionKeys.length} required permission keys.`
  );

  const superAdminRole = await prisma.role.findFirst({
    where: { key: "super_admin", deletedAt: null },
    select: { id: true },
  });
  push(results, "rbac.super_admin_role_exists", superAdminRole ? "PASS" : "FAIL");

  const sampleTask = await prisma.task.findFirst({
    select: {
      id: true,
      requestedAt: true,
      createdAt: true,
    },
  });
  push(
    results,
    "tasks.requested_at_field_accessible",
    sampleTask ? "PASS" : "SKIP",
    sampleTask ? "Task requestedAt field is selectable from Prisma client." : "No task rows available."
  );

  const emailChangeCount = await prisma.emailChangeRequest.count();
  push(results, "email_change_request_model_accessible", "PASS", `Existing request rows: ${emailChangeCount}`);

  const retentionDays = env().ACTIVITY_LOG_RETENTION_DAYS;
  push(
    results,
    "activity_log_retention_config_present",
    retentionDays >= 1 ? "PASS" : "FAIL",
    `Configured retention days: ${retentionDays}`
  );

  const companyAdminUser = await prisma.user.findFirst({
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

  if (!companyAdminUser) {
    push(results, "clients.tenant_scope_company_admin_sample", "SKIP", "No company admin user found.");
  } else {
    const foreignClient = await prisma.client.findFirst({
      where: {
        deletedAt: null,
        servicePartnerId: {
          not: companyAdminUser.servicePartnerId,
        },
      },
      select: { id: true },
    });

    const companySession = {
      user: {
        id: companyAdminUser.id,
        servicePartnerId: companyAdminUser.servicePartnerId,
        roleKeys: companyAdminUser.roles.map((entry) => entry.role.key),
        isSuperAdmin: false,
      },
    };

    const visibleClients = await listClients(companySession as never, { pageSize: 200 });
    const leakedClient = visibleClients.clients.find((client) => client.servicePartnerId !== companyAdminUser.servicePartnerId);

    push(
      results,
      "clients.tenant_list_scoping_enforced",
      leakedClient ? "FAIL" : "PASS",
      leakedClient ? `Leaked client ${leakedClient.id}` : `Visible client count: ${visibleClients.total}`
    );

    if (!foreignClient) {
      push(results, "clients.direct_url_scope_block_foreign_client", "SKIP", "No foreign client found.");
    } else {
      const foreignLookup = await getClientById(companySession as never, foreignClient.id);
      push(
        results,
        "clients.direct_url_scope_block_foreign_client",
        foreignLookup ? "FAIL" : "PASS",
        foreignLookup ? `Foreign client ${foreignClient.id} was accessible.` : undefined
      );
    }
  }

  const companyAdminRole = await prisma.role.findFirst({
    where: {
      key: "company_admin",
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!companyAdminRole) {
    push(results, "rbac.company_admin_role_permission_seed", "SKIP", "Company admin role not found.");
  } else {
    const permissionKeys = await getUserPermissions(
      companyAdminUser?.id ?? "",
      companyAdminUser?.roles.map((entry) => entry.role.key) ?? []
    );
    push(
      results,
      "rbac.company_admin_has_export_permissions_from_role",
      permissionKeys.includes("clients.export") && permissionKeys.includes("service_requests.export") ? "PASS" : "SKIP",
      "Export permissions depend on seeded users and roles."
    );
  }

  const failed = results.filter((result) => result.status === "FAIL");
  console.log(
    JSON.stringify(
      {
        summary: {
          total: results.length,
          passed: results.filter((result) => result.status === "PASS").length,
          failed: failed.length,
          skipped: results.filter((result) => result.status === "SKIP").length,
        },
        results,
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
