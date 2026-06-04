import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  AssignmentRole,
  ClientStatus,
  EmailChangeRequestStatus,
  OtpPurpose,
  RoleScope,
  ServiceRequestStatus,
  TaskStatus,
  UserStatus,
  type PrismaClient,
} from "@prisma/client";

import { createClient, getClientById, listClients, updateClient } from "../features/clients/services/client.service";
import {
  approveEmailChangeRequest,
  createEmailChangeRequest,
  rejectEmailChangeRequest,
  sendEmailChangeVerificationOtp,
  verifyEmailChangeRequest,
} from "../features/users/services/email-change.service";
import { getTaskNotificationContext, sendEmailNotifications } from "../lib/notifications/notification.service";
import { createTask, listTasksForServiceRequest } from "../features/tasks/services/task.service";
import { createTaskSchema } from "../features/tasks/validations";
import { listActivityLogs } from "../features/activity-log/services/activity-log.service";
import { buildCsv } from "../lib/export/csv";
import { buildExcelWorkbook } from "../lib/export/excel";
import { buildPdfDocument } from "../lib/export/pdf";
import { getExportPermissionKey, getExportRows, type ExportModuleKey } from "../features/export/services/export.service";
import { getUserPermissions, hasPermission } from "../lib/auth/permissions";
import { env } from "../lib/config/env";
import { createPrismaClient } from "../lib/db/client";
import { permissionActionLabels } from "../lib/rbac/permission-matrix";
import { baselinePermissions } from "../lib/rbac/baseline";
import { sendOtpChallengeToKnownTarget } from "../features/auth/services/otp.service";
import { ensureQaRoleWithPermissions, replaceUserRoles } from "./qa-rbac";
import { listServicePartners } from "../features/service-partners/services/service-partner.service";

const prisma = createPrismaClient();

type QaStatus = "PASS" | "FAIL" | "SKIP";
type QaResult = {
  key: string;
  status: QaStatus;
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

type QaUser = {
  id: string;
  servicePartnerId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  status: UserStatus;
  roles: {
    role: {
      id: string;
      key: string;
      scope: RoleScope;
    };
  }[];
};

const dashboardPageSource = readFileSync("app/(dashboard)/page.tsx", "utf8");
const servicePartnerDetailSource = readFileSync("app/(dashboard)/service-partners/[id]/page.tsx", "utf8");
const taskFormSource = readFileSync("features/tasks/components/task-form.tsx", "utf8");
const tasksTableSource = readFileSync("features/tasks/components/tasks-table.tsx", "utf8");
const emailChangeActionsSource = readFileSync("features/users/actions/email-change.actions.ts", "utf8");
const emailChangeServiceSource = readFileSync("features/users/services/email-change.service.ts", "utf8");
const profilePageSource = readFileSync("app/(dashboard)/profile/page.tsx", "utf8");
const emailChangeRequestsPageSource = readFileSync("app/(dashboard)/email-change-requests/page.tsx", "utf8");
const notificationsSource = readFileSync("lib/notifications/notification.service.ts", "utf8");
const taskActionsSource = readFileSync("features/tasks/actions/task.actions.ts", "utf8");
const activityLogPageSource = readFileSync("app/(dashboard)/activity-log/page.tsx", "utf8");
const purgeLogsSource = readFileSync("scripts/purge-activity-logs.ts", "utf8");
const exportRouteSource = readFileSync("app/api/exports/[module]/route.ts", "utf8");
const exportServiceSource = readFileSync("features/export/services/export.service.ts", "utf8");
const userFormSource = readFileSync("features/users/components/user-form.tsx", "utf8");
const userRoleFormSource = readFileSync("features/users/components/user-role-form.tsx", "utf8");
const rolePermissionFormSource = readFileSync("features/rbac/components/role-permission-form.tsx", "utf8");
const permissionsSource = readFileSync("lib/auth/permissions.ts", "utf8");

function push(results: QaResult[], key: string, status: QaStatus, details?: string) {
  results.push({ key, status, details });
}

function pass(results: QaResult[], key: string, details?: string) {
  push(results, key, "PASS", details);
}

function fail(results: QaResult[], key: string, details?: string) {
  push(results, key, "FAIL", details);
}

function skip(results: QaResult[], key: string, details?: string) {
  push(results, key, "SKIP", details);
}

function assert(results: QaResult[], key: string, condition: boolean, details?: string, failDetails?: string) {
  if (condition) {
    pass(results, key, details);
    return;
  }
  fail(results, key, failDetails ?? details);
}

async function expectThrows(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function toSession(user: QaUser): SessionLike {
  const roleKeys = user.roles.map((entry) => entry.role.key);
  return {
    user: {
      id: user.id,
      servicePartnerId: user.servicePartnerId,
      roleKeys,
      isSuperAdmin: roleKeys.includes("super_admin"),
      name: user.name,
      email: user.email,
      phone: user.phone,
    },
  };
}

async function loadUserByEmail(email: string) {
  return prisma.user.findFirst({
    where: {
      email,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      email: true,
      phone: true,
      name: true,
      status: true,
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        select: {
          role: {
            select: {
              id: true,
              key: true,
              scope: true,
            },
          },
        },
      },
    },
  });
}

async function ensureUser(input: {
  servicePartnerId: string;
  email?: string;
  phone?: string;
  name: string;
  status?: UserStatus;
}) {
  const status = input.status ?? UserStatus.ACTIVE;
  const payload = {
    servicePartnerId: input.servicePartnerId,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    status,
    deletedAt: null,
  };

  if (input.email) {
    await prisma.user.upsert({
      where: { email: input.email },
      update: payload,
      create: payload,
    });
    const user = await loadUserByEmail(input.email);
    if (!user) {
      throw new Error(`Unable to load QA user ${input.email}`);
    }
    return user;
  }

  if (!input.phone) {
    throw new Error("Phone is required when email is not provided.");
  }

  await prisma.user.upsert({
    where: { phone: input.phone },
    update: payload,
    create: payload,
  });

  const user = await prisma.user.findFirst({
    where: {
      phone: input.phone,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      email: true,
      phone: true,
      name: true,
      status: true,
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        select: {
          role: {
            select: {
              id: true,
              key: true,
              scope: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new Error(`Unable to load QA user ${input.phone}`);
  }
  return user;
}

async function getRoleIdByKey(servicePartnerId: string, key: string) {
  const role = await prisma.role.findFirst({
    where: {
      servicePartnerId,
      key,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!role) {
    throw new Error(`Missing role ${key} for service partner ${servicePartnerId}`);
  }

  return role.id;
}

async function assignSingleRole(userId: string, roleId: string) {
  await replaceUserRoles(prisma as PrismaClient, {
    userId,
    roleIds: [roleId],
  });
}

async function ensureClientFixture(servicePartnerId: string, code: string, name: string) {
  return prisma.client.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId,
        code,
      },
    },
    update: {
      name,
      status: ClientStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      servicePartnerId,
      code,
      name,
      status: ClientStatus.ACTIVE,
    },
  });
}

async function ensureServiceRequestFixture(input: {
  servicePartnerId: string;
  clientId: string;
  createdByUserId: string;
  title: string;
  serviceNumber: string;
}) {
  const existing = await prisma.serviceRequest.findFirst({
    where: {
      servicePartnerId: input.servicePartnerId,
      serviceNumber: input.serviceNumber,
    },
    select: { id: true },
  });

  if (existing) {
    return prisma.serviceRequest.update({
      where: { id: existing.id },
      data: {
        clientId: input.clientId,
        createdByUserId: input.createdByUserId,
        title: input.title,
        serviceType: "QA",
        status: ServiceRequestStatus.RAISED,
        deletedAt: null,
      },
    });
  }

  return prisma.serviceRequest.create({
    data: {
      servicePartnerId: input.servicePartnerId,
      clientId: input.clientId,
      createdByUserId: input.createdByUserId,
      serviceNumber: input.serviceNumber,
      title: input.title,
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
    },
  });
}

function parseJsonObjectFromOutput(output: string) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function main() {
  const results: QaResult[] = [];
  const config = env();
  const retentionDays = config.ACTIVITY_LOG_RETENTION_DAYS;
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const [superAdminUser, devTenant, foreignTenant] = await Promise.all([
    prisma.user.findFirst({
      where: {
        deletedAt: null,
        status: UserStatus.ACTIVE,
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
        phone: true,
        name: true,
        status: true,
        roles: {
          where: {
            role: {
              deletedAt: null,
            },
          },
          select: {
            role: {
              select: {
                id: true,
                key: true,
                scope: true,
              },
            },
          },
        },
      },
    }),
    prisma.servicePartner.findFirst({
      where: {
        code: "DEVCOMPANY",
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        code: true,
      },
    }),
    prisma.servicePartner.findFirst({
      where: {
        code: {
          not: "DEVCOMPANY",
        },
        deletedAt: null,
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
      },
    }),
  ]);

  if (!superAdminUser || !devTenant || !foreignTenant) {
    throw new Error("Operational hardening QA requires seeded super admin, DEVCOMPANY, and a foreign tenant.");
  }

  const superAdminSession = toSession(superAdminUser);

  const companyAdmin = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      servicePartnerId: devTenant.id,
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
      phone: true,
      name: true,
      status: true,
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        select: {
          role: {
            select: {
              id: true,
              key: true,
              scope: true,
            },
          },
        },
      },
    },
  });

  if (!companyAdmin) {
    throw new Error("Operational hardening QA requires an active DEVCOMPANY company admin.");
  }

  const companySession = toSession(companyAdmin);
  const supportRoleId = await getRoleIdByKey(devTenant.id, "support");
  const operatorRoleId = await getRoleIdByKey(devTenant.id, "operator");
  const foreignOperatorRoleId = await getRoleIdByKey(foreignTenant.id, "operator");

  const [
    qaTenantUser,
    qaSupportReader,
    qaEmailUser,
    qaRequester,
    qaAssignee,
    qaRelated,
    qaUnrelated,
    qaInactive,
    qaNoEmail,
    qaForeignUser,
    qaRoleUserA,
    qaRoleUserB,
  ] = await Promise.all([
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.tenant.user@matrixcrm.local",
      phone: "+910000001001",
      name: "QA Operational Tenant User",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.support.reader@matrixcrm.local",
      phone: "+910000001002",
      name: "QA Operational Support Reader",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.email.user@matrixcrm.local",
      phone: "+910000001003",
      name: "QA Operational Email User",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.requester@matrixcrm.local",
      phone: "+910000001004",
      name: "QA Operational Requester",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.assignee@matrixcrm.local",
      phone: "+910000001005",
      name: "QA Operational Assignee",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.related@matrixcrm.local",
      phone: "+910000001006",
      name: "QA Operational Related",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.unrelated@matrixcrm.local",
      phone: "+910000001007",
      name: "QA Operational Unrelated",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.inactive@matrixcrm.local",
      phone: "+910000001008",
      name: "QA Operational Inactive",
      status: UserStatus.INACTIVE,
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      phone: "+910000001009",
      name: "QA Operational No Email",
    }),
    ensureUser({
      servicePartnerId: foreignTenant.id,
      email: "qa.operational.foreign@matrixcrm.local",
      phone: "+910000001010",
      name: "QA Operational Foreign",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.role.usera@matrixcrm.local",
      phone: "+910000001011",
      name: "QA Operational Role User A",
    }),
    ensureUser({
      servicePartnerId: devTenant.id,
      email: "qa.operational.role.userb@matrixcrm.local",
      phone: "+910000001012",
      name: "QA Operational Role User B",
    }),
  ]);

  await Promise.all([
    assignSingleRole(qaTenantUser.id, supportRoleId),
    assignSingleRole(qaEmailUser.id, operatorRoleId),
    assignSingleRole(qaRequester.id, operatorRoleId),
    assignSingleRole(qaAssignee.id, operatorRoleId),
    assignSingleRole(qaRelated.id, operatorRoleId),
    assignSingleRole(qaUnrelated.id, operatorRoleId),
    assignSingleRole(qaInactive.id, operatorRoleId),
    assignSingleRole(qaNoEmail.id, operatorRoleId),
    assignSingleRole(qaForeignUser.id, foreignOperatorRoleId),
  ]);

  await ensureQaRoleWithPermissions(prisma as PrismaClient, {
    servicePartnerId: devTenant.id,
    key: "qa_operational_support_reader",
    name: "QA Operational Support Reader",
    description: "Read-only activity log access for operational QA.",
    permissionKeys: ["activity_logs.read"],
  });
  const supportReaderRoleId = await getRoleIdByKey(devTenant.id, "qa_operational_support_reader");
  await assignSingleRole(qaSupportReader.id, supportReaderRoleId);

  const [tenantUser, supportReader, emailUser, requester, assignee, related, unrelated, foreignUser, roleUserA, roleUserB] =
    await Promise.all([
      loadUserByEmail("qa.operational.tenant.user@matrixcrm.local"),
      loadUserByEmail("qa.operational.support.reader@matrixcrm.local"),
      loadUserByEmail("qa.operational.email.user@matrixcrm.local"),
      loadUserByEmail("qa.operational.requester@matrixcrm.local"),
      loadUserByEmail("qa.operational.assignee@matrixcrm.local"),
      loadUserByEmail("qa.operational.related@matrixcrm.local"),
      loadUserByEmail("qa.operational.unrelated@matrixcrm.local"),
      loadUserByEmail("qa.operational.foreign@matrixcrm.local"),
      loadUserByEmail("qa.operational.role.usera@matrixcrm.local"),
      loadUserByEmail("qa.operational.role.userb@matrixcrm.local"),
    ]);

  if (!tenantUser || !supportReader || !emailUser || !requester || !assignee || !related || !unrelated || !foreignUser || !roleUserA || !roleUserB) {
    throw new Error("Unable to load operational QA fixture users after setup.");
  }

  const tenantSession = toSession(tenantUser);
  const supportReaderSession = toSession(supportReader);
  const emailUserSession = toSession(emailUser);
  const requesterSession = toSession(requester);
  const assigneeSession = toSession(assignee);
  const foreignUserSession = toSession(foreignUser);

  const [devClient, foreignClient] = await Promise.all([
    ensureClientFixture(devTenant.id, "QAOHCDEV", "QA Operational Dev Client"),
    ensureClientFixture(foreignTenant.id, "QAOHCFRN", "QA Operational Foreign Client"),
  ]);

  const qaServiceRequest = await ensureServiceRequestFixture({
    servicePartnerId: devTenant.id,
    clientId: devClient.id,
    createdByUserId: requester.id,
    title: "QA Operational Service Request",
    serviceNumber: "QAOH-SR-001",
  });

  await prisma.assignment.deleteMany({
    where: {
      serviceRequestId: qaServiceRequest.id,
    },
  });
  await prisma.assignment.createMany({
    data: [
      {
        servicePartnerId: devTenant.id,
        serviceRequestId: qaServiceRequest.id,
        userId: related.id,
        role: AssignmentRole.PM,
      },
      {
        servicePartnerId: devTenant.id,
        serviceRequestId: qaServiceRequest.id,
        userId: qaInactive.id,
        role: AssignmentRole.TECHNICIAN,
      },
      {
        servicePartnerId: devTenant.id,
        serviceRequestId: qaServiceRequest.id,
        userId: qaNoEmail.id,
        role: AssignmentRole.SM,
      },
    ],
  });

  await prisma.activityLog.deleteMany({
    where: {
      module: "qa_operational",
    },
  });

  const [recentTenantLog, oldTenantLog, foreignLog] = await Promise.all([
    prisma.activityLog.create({
      data: {
        servicePartnerId: devTenant.id,
        actorUserId: requester.id,
        action: "qa.operational.current",
        module: "qa_operational",
        entityType: "OTHER",
        entityId: devClient.id,
        message: "Current tenant QA activity log entry",
      },
    }),
    prisma.activityLog.create({
      data: {
        servicePartnerId: devTenant.id,
        actorUserId: requester.id,
        action: "qa.operational.expired",
        module: "qa_operational",
        entityType: "OTHER",
        entityId: "old-log",
        message: "Expired tenant QA activity log entry",
        createdAt: new Date(cutoffDate.getTime() - 24 * 60 * 60 * 1000),
      },
    }),
    prisma.activityLog.create({
      data: {
        servicePartnerId: foreignTenant.id,
        actorUserId: foreignUser.id,
        action: "qa.operational.foreign",
        module: "qa_operational",
        entityType: "OTHER",
        entityId: foreignClient.id,
        message: "Foreign tenant QA activity log entry",
      },
    }),
  ]);

  const taskInput = createTaskSchema.parse({
    serviceRequestId: qaServiceRequest.id,
    title: `QA Operational Task ${Date.now()}`,
    description: "Task for operational hardening QA.",
    assigneeUserId: assignee.id,
    status: TaskStatus.YET_TO_START,
    requestedAt: "2026-06-04T10:15:00.000Z",
    dueDate: "2026-06-05",
  });

  const createdTask = await createTask(tenantSession as never, taskInput);
  const taskList = await listTasksForServiceRequest(tenantSession as never, qaServiceRequest.id);
  const createdTaskRow = taskList.tasks.find((task) => task.id === createdTask.id);

  assert(
    results,
    "dashboard.super_admin_company_directory_is_name_first",
    dashboardPageSource.includes("select: { id: true, name: true }") && dashboardPageSource.includes("{company.name}"),
    "High-level company directory selects and renders names only."
  );
  assert(
    results,
    "dashboard.super_admin_company_directory_click_targets_detail",
    dashboardPageSource.includes("href={`/service-partners/${company.id}`}"),
    "Company directory links to the existing service partner detail route."
  );
  assert(
    results,
    "dashboard.company_admin_directory_hidden",
    dashboardPageSource.includes("isSuperAdmin && companyDirectory.length > 0"),
    "Company directory is gated to super admins."
  );

  const companyServicePartners = await listServicePartners(companySession as never, { pageSize: 50 });
  const leakedServicePartner = companyServicePartners.servicePartners.find((row) => row.id !== companyAdmin.servicePartnerId);
  assert(
    results,
    "clients.company_admin_does_not_see_other_company_directory",
    !leakedServicePartner,
    `Scoped service partner count: ${companyServicePartners.total}`,
    leakedServicePartner ? `Leaked company ${leakedServicePartner.id}` : undefined
  );

  const [companyAdminClients, tenantUserClients] = await Promise.all([
    listClients(companySession as never, { pageSize: 200 }),
    listClients(tenantSession as never, { pageSize: 200 }),
  ]);

  assert(
    results,
    "clients.company_admin_sees_only_own_service_partner_clients",
    companyAdminClients.clients.every((client) => client.servicePartnerId === companyAdmin.servicePartnerId),
    `Visible client count: ${companyAdminClients.total}`
  );
  assert(
    results,
    "clients.tenant_user_sees_only_own_service_partner_clients",
    tenantUserClients.clients.every((client) => client.servicePartnerId === tenantUser.servicePartnerId),
    `Visible client count: ${tenantUserClients.total}`
  );

  const [foreignLookupByCompanyAdmin, foreignLookupByTenantUser, foreignLookupBySuperAdmin] = await Promise.all([
    getClientById(companySession as never, foreignClient.id),
    getClientById(tenantSession as never, foreignClient.id),
    getClientById(superAdminSession as never, foreignClient.id),
  ]);

  assert(results, "clients.direct_url_to_foreign_client_blocked_for_company_admin", !foreignLookupByCompanyAdmin);
  assert(results, "clients.direct_url_to_foreign_client_blocked_for_tenant_user", !foreignLookupByTenantUser);
  assert(results, "clients.super_admin_can_access_foreign_client", Boolean(foreignLookupBySuperAdmin));

  const forcedTenantClientCode = `QAOH${Date.now().toString().slice(-8)}`;
  const createdScopedClient = await createClient(companySession as never, {
    servicePartnerId: foreignTenant.id,
    code: forcedTenantClientCode,
    name: "QA Forced Tenant Client",
    status: ClientStatus.ACTIVE,
  });
  assert(
    results,
    "clients.create_foreign_service_partner_input_is_blocked_for_tenant_user",
    createdScopedClient.servicePartnerId === companyAdmin.servicePartnerId,
    `Created under tenant ${createdScopedClient.servicePartnerId}`
  );

  const foreignUpdateError = await expectThrows(() =>
    updateClient(companySession as never, foreignClient.id, {
      servicePartnerId: foreignTenant.id,
      code: foreignClient.code,
      name: "Should Not Update",
      status: ClientStatus.ACTIVE,
    })
  );
  assert(
    results,
    "clients.update_foreign_tenant_client_blocked",
    Boolean(foreignUpdateError && foreignUpdateError.toLowerCase().includes("not found")),
    foreignUpdateError ?? undefined,
    foreignUpdateError ?? "Expected foreign client update to be blocked."
  );

  const foreignClientRows = await listClients(superAdminSession as never, {
    pageSize: 50,
    servicePartnerId: foreignTenant.id,
  });
  assert(
    results,
    "clients.super_admin_can_list_all_clients_with_tenant_filter",
    foreignClientRows.clients.some((client) => client.servicePartnerId === foreignTenant.id),
    `Foreign tenant client count: ${foreignClientRows.total}`
  );

  const invalidTaskParse = createTaskSchema.safeParse({
    serviceRequestId: qaServiceRequest.id,
    title: "Invalid Requested At Task",
    requestedAt: "not-a-date",
  });

  assert(results, "tasks.created_at_remains_automatic", Boolean(createdTask.createdAt));
  assert(results, "tasks.requested_at_accepts_date_time", taskInput.requestedAt instanceof Date);
  assert(
    results,
    "tasks.requested_at_persists",
    Boolean(createdTask.requestedAt && createdTask.requestedAt.toISOString() === taskInput.requestedAt?.toISOString()),
    createdTask.requestedAt?.toISOString()
  );
  assert(results, "tasks.invalid_requested_at_rejected", !invalidTaskParse.success);
  assert(
    results,
    "tasks.table_and_source_show_requested_at_and_created_at",
    Boolean(createdTaskRow?.requestedAt) &&
      taskFormSource.includes("Requested Date/Time") &&
      taskFormSource.includes("Created At") &&
      tasksTableSource.includes("Requested At") &&
      tasksTableSource.includes("Created At")
  );

  await prisma.emailChangeRequest.deleteMany({
    where: {
      userId: {
        in: [emailUser.id, requester.id, assignee.id],
      },
    },
  });
  await prisma.otpChallenge.deleteMany({
    where: {
      userId: {
        in: [emailUser.id, requester.id, assignee.id],
      },
      purpose: OtpPurpose.EMAIL_CHANGE,
    },
  });
  await Promise.all([
    prisma.user.update({
      where: { id: emailUser.id },
      data: {
        email: "qa.operational.email.user@matrixcrm.local",
        emailVerified: null,
      },
    }),
    prisma.user.update({
      where: { id: requester.id },
      data: {
        email: "qa.operational.requester@matrixcrm.local",
        emailVerified: null,
      },
    }),
    prisma.user.update({
      where: { id: assignee.id },
      data: {
        email: "qa.operational.assignee@matrixcrm.local",
        emailVerified: null,
      },
    }),
  ]);

  const duplicateEmailError = await expectThrows(() => createEmailChangeRequest(emailUserSession as never, companyAdmin.email ?? ""));
  const emailChangeRequest = await createEmailChangeRequest(emailUserSession as never, "qa.operational.email.user+new@matrixcrm.local");
  const sendOtpBeforeApprovalError = await expectThrows(() =>
    sendEmailChangeVerificationOtp(emailUserSession as never, emailChangeRequest.id)
  );
  const tenantApprovePermission = await hasPermission(tenantSession as never, "email_change_requests.approve");
  let approvedRequest = null as Awaited<ReturnType<typeof approveEmailChangeRequest>> | null;
  let approvedRequestError: string | null = null;
  try {
    approvedRequest = await approveEmailChangeRequest(superAdminSession as never, emailChangeRequest.id);
  } catch (error) {
    approvedRequestError = error instanceof Error ? error.message : String(error);
    approvedRequest = await prisma.emailChangeRequest.findUnique({
      where: { id: emailChangeRequest.id },
    });
  }
  if (!approvedRequest) {
    throw new Error("Unable to load approved email change request fixture.");
  }
  const wrongOtpError = await expectThrows(() =>
    verifyEmailChangeRequest(emailUserSession as never, approvedRequest.id, "000000")
  );

  const foreignOtpSendError = await expectThrows(() =>
    sendEmailChangeVerificationOtp(foreignUserSession as never, approvedRequest.id)
  );
  const foreignOtpVerifyError = await expectThrows(() =>
    verifyEmailChangeRequest(foreignUserSession as never, approvedRequest.id, "000000")
  );

  const expiringRequest = await createEmailChangeRequest(requesterSession as never, "qa.operational.requester+expired@matrixcrm.local");
  let approvedExpiringRequest = null as Awaited<ReturnType<typeof approveEmailChangeRequest>> | null;
  try {
    approvedExpiringRequest = await approveEmailChangeRequest(superAdminSession as never, expiringRequest.id);
  } catch {
    approvedExpiringRequest = await prisma.emailChangeRequest.findUnique({
      where: { id: expiringRequest.id },
    });
  }
  if (!approvedExpiringRequest) {
    throw new Error("Unable to load expiring email change request fixture.");
  }
  await prisma.emailChangeRequest.update({
    where: { id: approvedExpiringRequest.id },
    data: {
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const expiredOtpError = await expectThrows(() =>
    verifyEmailChangeRequest(requesterSession as never, approvedExpiringRequest.id, "000000")
  );
  const expiredRequestRow = await prisma.emailChangeRequest.findUnique({
    where: { id: approvedExpiringRequest.id },
    select: { status: true },
  });

  const rejectedRequest = await createEmailChangeRequest(assigneeSession as never, "qa.operational.assignee+rejected@matrixcrm.local");
  const rejectedRow = await rejectEmailChangeRequest(superAdminSession as never, rejectedRequest.id, "QA rejection");
  const rejectedVerifyError = await expectThrows(() =>
    verifyEmailChangeRequest(assigneeSession as never, rejectedRow.id, "000000")
  );

  const otpPreviewDelivery = await sendOtpChallengeToKnownTarget({
    servicePartnerId: emailUser.servicePartnerId,
    userId: emailUser.id,
    target: approvedRequest.newEmail,
    purpose: OtpPurpose.EMAIL_CHANGE,
  });
  let verifiedUserEmail: string | null = null;
  if (otpPreviewDelivery.ok && otpPreviewDelivery.devOtpPreview) {
    await verifyEmailChangeRequest(emailUserSession as never, approvedRequest.id, otpPreviewDelivery.devOtpPreview);
    const verifiedUser = await prisma.user.findUnique({
      where: { id: emailUser.id },
      select: { email: true },
    });
    verifiedUserEmail = verifiedUser?.email ?? null;
  }

  assert(results, "email_change.user_can_request_email_change_for_own_account", Boolean(emailChangeRequest.id));
  assert(
    results,
    "email_change.duplicate_new_email_blocked",
    Boolean(duplicateEmailError && duplicateEmailError.toLowerCase().includes("already in use")),
    duplicateEmailError ?? undefined
  );
  assert(
    results,
    "email_change.request_requires_approval_before_otp_send",
    Boolean(sendOtpBeforeApprovalError && sendOtpBeforeApprovalError.toLowerCase().includes("not ready")),
    sendOtpBeforeApprovalError ?? undefined
  );
  assert(
    results,
    "email_change.super_admin_can_approve",
    approvedRequest.status === EmailChangeRequestStatus.APPROVED || approvedRequest.status === EmailChangeRequestStatus.OTP_SENT,
    approvedRequestError ?? approvedRequest.status
  );
  assert(results, "email_change.super_admin_can_reject", rejectedRow.status === EmailChangeRequestStatus.REJECTED);
  assert(results, "email_change.non_super_admin_without_permission_cannot_approve", tenantApprovePermission === false);
  if (approvedRequest.status === EmailChangeRequestStatus.OTP_SENT && approvedRequest.expiresAt) {
    pass(results, "email_change.approved_request_sends_otp_to_new_email");
  } else if (approvedRequestError?.toLowerCase().includes("temporarily unavailable")) {
    skip(
      results,
      "email_change.approved_request_sends_otp_to_new_email",
      "OTP delivery was temporarily unavailable during QA. Approval still persisted."
    );
  } else {
    fail(
      results,
      "email_change.approved_request_sends_otp_to_new_email",
      approvedRequestError ?? `Unexpected approved request status: ${approvedRequest.status}`
    );
  }
  assert(
    results,
    "email_change.old_email_alert_notification_path_present",
    emailChangeServiceSource.includes('notifyEmailAddress(user.email, "Matrix CRM email change requested"') &&
      emailChangeServiceSource.includes('notifyEmailAddress(request.oldEmail, "Matrix CRM email changed successfully"')
  );
  assert(
    results,
    "email_change.wrong_otp_rejected",
    Boolean(wrongOtpError && wrongOtpError.length > 0),
    wrongOtpError ?? undefined
  );
  assert(
    results,
    "email_change.expired_otp_rejected",
    Boolean(expiredOtpError && expiredOtpError.toLowerCase().includes("expired")) &&
      expiredRequestRow?.status === EmailChangeRequestStatus.EXPIRED,
    expiredOtpError ?? undefined
  );
  if (otpPreviewDelivery.ok && otpPreviewDelivery.devOtpPreview) {
    assert(
      results,
      "email_change.correct_otp_updates_email",
      verifiedUserEmail === approvedRequest.newEmail,
      `Updated email: ${verifiedUserEmail ?? "missing"}`
    );
  } else {
    skip(results, "email_change.correct_otp_updates_email", "OTP provider did not expose a local dev preview code.");
  }
  assert(
    results,
    "email_change.rejected_request_cannot_be_verified",
    Boolean(rejectedVerifyError && rejectedVerifyError.toLowerCase().includes("not awaiting")),
    rejectedVerifyError ?? undefined
  );
  assert(
    results,
    "email_change.tenant_scoping_enforced_for_otp_send_and_verify",
    Boolean(foreignOtpSendError && foreignOtpSendError.toLowerCase().includes("not found")) &&
      Boolean(foreignOtpVerifyError && foreignOtpVerifyError.toLowerCase().includes("not found")),
    `${foreignOtpSendError ?? "missing send error"} / ${foreignOtpVerifyError ?? "missing verify error"}`
  );
  assert(
    results,
    "email_change.no_raw_otp_leaked_in_ui_or_actions",
    !profilePageSource.includes("devOtpPreview") &&
      !emailChangeActionsSource.includes("devOtpPreview") &&
      !emailChangeServiceSource.includes("console.log") &&
      !emailChangeActionsSource.includes("console.log")
  );

  const taskContext = await getTaskNotificationContext(createdTask.id);
  const notificationRecipientIds = new Set(taskContext?.recipients.map((recipient) => recipient.id));
  const expectedInvolvedUserIds = new Set([assignee.id, tenantUser.id, requester.id, related.id, qaInactive.id, qaNoEmail.id]);
  const unrelatedPresent = notificationRecipientIds.has(unrelated.id) || notificationRecipientIds.has(foreignUser.id);
  const skippedNotificationResult = await sendEmailNotifications({
    actorUserId: requester.id,
    servicePartnerId: devTenant.id,
    subject: "QA Notification Filter Test",
    body: "Testing notification recipient filtering.",
    templateKey: "qa.notification.filter",
    recipients: [
      {
        id: requester.id,
        servicePartnerId: devTenant.id,
        email: requester.email,
        name: requester.name,
        status: requester.status,
        deletedAt: null,
      },
      {
        id: qaInactive.id,
        servicePartnerId: devTenant.id,
        email: qaInactive.email,
        name: qaInactive.name,
        status: qaInactive.status,
        deletedAt: null,
      },
      {
        id: qaNoEmail.id,
        servicePartnerId: devTenant.id,
        email: null,
        name: qaNoEmail.name,
        status: qaNoEmail.status,
        deletedAt: null,
      },
      {
        id: foreignUser.id,
        servicePartnerId: foreignTenant.id,
        email: foreignUser.email,
        name: foreignUser.name,
        status: foreignUser.status,
        deletedAt: null,
      },
    ],
  });

  assert(
    results,
    "notifications.task_assigned_and_updated_recipients_are_only_involved_users",
    Boolean(taskContext) &&
      !unrelatedPresent &&
      Array.from(notificationRecipientIds).every((id) => expectedInvolvedUserIds.has(id)),
    taskContext ? `Recipients: ${Array.from(notificationRecipientIds).length}` : "Missing task notification context."
  );
  assert(
    results,
    "notifications.actor_deduped_and_excluded_by_implementation",
    notificationsSource.includes("if (recipient.id === actorUserId)") &&
      notificationsSource.includes("unique.has(recipient.id)")
  );
  assert(
    results,
    "notifications.inactive_no_email_foreign_and_actor_recipients_are_skipped",
    skippedNotificationResult.attempted === 0 && skippedNotificationResult.sent === 0 && skippedNotificationResult.failed === 0,
    JSON.stringify(skippedNotificationResult)
  );
  assert(
    results,
    "notifications.non_critical_email_failure_does_not_break_task_mutations",
    taskActionsSource.includes("Task assignment notification failed") &&
      taskActionsSource.includes("Task update notification failed") &&
      taskActionsSource.includes("Task status notification failed")
  );
  assert(
    results,
    "notifications.no_secrets_logged",
    !notificationsSource.includes("process.env") &&
      !notificationsSource.includes("DATABASE_URL") &&
      !notificationsSource.includes("AUTH_SECRET") &&
      !notificationsSource.includes("SMTP_") &&
      !notificationsSource.includes("console.log(recipient.email") &&
      readFileSync("features/auth/services/otp-provider.service.ts", "utf8").includes('replace(/(pass(word)?|token|secret)=\\S+/gi, "$1=[redacted]")')
  );

  const [superAdminLogs, supportLogs, actorFilteredLogs, actionFilteredLogs, entityFilteredLogs, dateFilteredLogs] = await Promise.all([
    listActivityLogs(superAdminSession as never, { pageSize: 200, module: "qa_operational" }),
    listActivityLogs(supportReaderSession as never, { pageSize: 200, module: "qa_operational" }),
    listActivityLogs(superAdminSession as never, { pageSize: 200, actorUserId: requester.id, module: "qa_operational" }),
    listActivityLogs(superAdminSession as never, { pageSize: 200, action: recentTenantLog.action, module: "qa_operational" }),
    listActivityLogs(superAdminSession as never, { pageSize: 200, q: recentTenantLog.entityId ?? "", module: "qa_operational" }),
    listActivityLogs(superAdminSession as never, {
      pageSize: 200,
      module: "qa_operational",
      dateFrom: new Date(recentTenantLog.createdAt),
      dateTo: new Date(recentTenantLog.createdAt),
    }),
  ]);

  const dryRunCommand = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/purge-activity-logs.ts", "--dry-run"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );
  const dryRunPayload = parseJsonObjectFromOutput(`${dryRunCommand.stdout ?? ""}\n${dryRunCommand.stderr ?? ""}`) as
    | { dryRun?: boolean; retentionDays?: number; matchingLogs?: number }
    | null;
  const postDryRunOldLog = await prisma.activityLog.findUnique({
    where: { id: oldTenantLog.id },
    select: { id: true },
  });

  assert(results, "activity_logs.page_permission_gated", activityLogPageSource.includes('requirePermission("activity_logs.read")'));
  assert(
    results,
    "activity_logs.super_admin_sees_all_logs",
    superAdminLogs.logs.some((log) => log.servicePartner.id === foreignTenant.id),
    `Visible log count: ${superAdminLogs.total}`
  );
  assert(
    results,
    "activity_logs.tenant_support_user_sees_scoped_logs_only",
    supportLogs.logs.length > 0 &&
      supportLogs.logs.every((log) => log.servicePartner.id === devTenant.id),
    `Visible log count: ${supportLogs.total}`
  );
  assert(
    results,
    "activity_logs.filters_work_by_date_action_entity_and_actor",
    actorFilteredLogs.logs.every((log) => log.actor?.id === requester.id) &&
      actionFilteredLogs.logs.every((log) => log.action === recentTenantLog.action) &&
      entityFilteredLogs.logs.some((log) => log.entityId === recentTenantLog.entityId) &&
      dateFilteredLogs.logs.some((log) => log.id === recentTenantLog.id),
    `Actor=${actorFilteredLogs.total}, Action=${actionFilteredLogs.total}, Entity=${entityFilteredLogs.total}, Date=${dateFilteredLogs.total}`
  );
  assert(
    results,
    "activity_logs.export_requires_activity_logs_export_permission",
    getExportPermissionKey("activity-logs") === "activity_logs.export" &&
      (await hasPermission(supportReaderSession as never, "activity_logs.export")) === false
  );
  assert(
    results,
    "activity_logs.purge_dry_run_returns_count_and_does_not_delete",
    dryRunCommand.status === 0 &&
      dryRunPayload?.dryRun === true &&
      typeof dryRunPayload.matchingLogs === "number" &&
      Boolean(postDryRunOldLog),
    dryRunPayload ? JSON.stringify(dryRunPayload) : dryRunCommand.stderr
  );
  assert(
    results,
    "activity_logs.purge_respects_retention_days",
    dryRunPayload?.retentionDays === retentionDays,
    dryRunPayload ? `Retention days: ${dryRunPayload.retentionDays}` : "Dry run output unavailable."
  );

  const supportedExportModules: ExportModuleKey[] = [
    "activity-logs",
    "clients",
    "service-requests",
    "tasks",
    "quotations",
    "purchase-orders",
    "invoices",
    "payments",
    "ledger",
    "vendor-payments",
    "finance-reports",
  ];
  const mappedExportKeys = supportedExportModules.map((moduleKey) => ({
    moduleKey,
    permissionKey: getExportPermissionKey(moduleKey),
  }));
  const clientExportRows = await getExportRows(companySession as never, "clients", new URLSearchParams());
  const filteredClientExportRows = await getExportRows(companySession as never, "clients", new URLSearchParams({ q: "QA Operational Dev Client" }));
  const superAdminForeignClientExportRows = await getExportRows(
    superAdminSession as never,
    "clients",
    new URLSearchParams({ servicePartnerId: foreignTenant.id })
  );
  const activityLogExportRows = await getExportRows(
    supportReaderSession as never,
    "activity-logs",
    new URLSearchParams({ module: "qa_operational", actorUserId: requester.id })
  );
  const csvOutput = buildCsv(clientExportRows.slice(0, 2));
  const excelOutput = buildExcelWorkbook(clientExportRows.slice(0, 2), "clients");
  const pdfOutput = buildPdfDocument("clients", clientExportRows.slice(0, 2));

  assert(
    results,
    "exports.each_supported_module_checks_export_permission",
    mappedExportKeys.every((entry) => typeof entry.permissionKey === "string" && entry.permissionKey.includes("export"))
  );
  assert(
    results,
    "exports.tenant_user_exports_only_own_tenant_data",
    clientExportRows.every((row) => row.company === devTenant.name) &&
      activityLogExportRows.every((row) => row.company === devTenant.name),
    `Client rows=${clientExportRows.length}, Activity log rows=${activityLogExportRows.length}`
  );
  assert(
    results,
    "exports.super_admin_can_export_all_tenants",
    superAdminForeignClientExportRows.some((row) => row.company === foreignTenant.name),
    `Foreign export rows=${superAdminForeignClientExportRows.length}`
  );
  assert(
    results,
    "exports.csv_excel_pdf_formats_are_valid_lightweight_outputs",
    csvOutput.includes("code,name,company") &&
      excelOutput.startsWith("<?xml version=\"1.0\"?>") &&
      excelOutput.includes("<Workbook") &&
      pdfOutput.toString("utf8", 0, 8).startsWith("%PDF-1.4")
  );
  assert(
    results,
    "exports.filters_are_respected_where_supported",
    filteredClientExportRows.every((row) => String(row.name).includes("QA Operational Dev Client")) &&
      activityLogExportRows.every((row) => row.actor === requester.name),
    `Filtered clients=${filteredClientExportRows.length}, filtered logs=${activityLogExportRows.length}`
  );
  assert(
    results,
    "exports.no_cross_tenant_or_secret_leak_paths_present",
    exportServiceSource.includes("scopeByTenant(session as never, {})") &&
      !exportServiceSource.includes("DATABASE_URL") &&
      !exportRouteSource.includes("DATABASE_URL")
  );

  const qaRole = await ensureQaRoleWithPermissions(prisma as PrismaClient, {
    servicePartnerId: devTenant.id,
    key: "qa_operational_matrix_role",
    name: "QA Operational Matrix Role",
    description: "Role used to verify standardized role-based permission updates.",
    permissionKeys: ["clients.read", "tasks.read"],
  });
  await Promise.all([
    replaceUserRoles(prisma as PrismaClient, { userId: roleUserA.id, roleIds: [qaRole.id] }),
    replaceUserRoles(prisma as PrismaClient, { userId: roleUserB.id, roleIds: [qaRole.id] }),
  ]);
  const initialRolePermissions = await Promise.all([
    getUserPermissions(roleUserA.id, [qaRole.key]),
    getUserPermissions(roleUserB.id, [qaRole.key]),
  ]);
  await ensureQaRoleWithPermissions(prisma as PrismaClient, {
    servicePartnerId: devTenant.id,
    key: "qa_operational_matrix_role",
    name: "QA Operational Matrix Role",
    description: "Role used to verify standardized role-based permission updates.",
    permissionKeys: ["clients.read", "reports.read"],
  });
  const updatedRolePermissions = await Promise.all([
    getUserPermissions(roleUserA.id, [qaRole.key]),
    getUserPermissions(roleUserB.id, [qaRole.key]),
  ]);

  assert(
    results,
    "permission_matrix.roles_are_final_access_source",
    permissionsSource.includes("prisma.userRole.findMany") &&
      permissionsSource.includes("roleAssignments") &&
      permissionsSource.includes("for (const assignment of roleAssignments)") &&
      permissionsSource.includes("for (const entry of assignment.role.permissions)") &&
      permissionsSource.includes("permissions: {") &&
      permissionsSource.includes("permission: {") &&
      permissionsSource.includes("entry.permission.key") &&
      !permissionsSource.includes("prisma.userPermission")
  );
  assert(
    results,
    "permission_matrix.action_labels_are_standardized",
    permissionActionLabels.export === "Export" &&
      permissionActionLabels.approve === "Approve" &&
      permissionActionLabels.reject === "Reject" &&
      permissionActionLabels["status.update"] === "Status Update" &&
      permissionActionLabels.purge === "Purge"
  );
  assert(
    results,
    "permission_matrix.groups_permissions_by_module",
    rolePermissionFormSource.includes("rowsByModule") && rolePermissionFormSource.includes("Role Permissions")
  );
  assert(
    results,
    "permission_matrix.same_role_users_get_same_permissions",
    JSON.stringify(initialRolePermissions[0].sort()) === JSON.stringify(initialRolePermissions[1].sort()) &&
      JSON.stringify(updatedRolePermissions[0].sort()) === JSON.stringify(updatedRolePermissions[1].sort()),
    `Initial=${initialRolePermissions[0].join(",")} Updated=${updatedRolePermissions[0].join(",")}`
  );
  assert(
    results,
    "permission_matrix_adding_and_removing_role_permission_changes_access",
    initialRolePermissions[0].includes("tasks.read") &&
      !updatedRolePermissions[0].includes("tasks.read") &&
      updatedRolePermissions[0].includes("reports.read")
  );
  assert(
    results,
    "permission_matrix.no_user_level_permission_ui_exists",
    userFormSource.includes("Access is controlled by assigned roles.") &&
      userRoleFormSource.includes("Users receive access from assigned roles.") &&
      !userFormSource.includes("permissionIds") &&
      !userRoleFormSource.includes("permissionIds")
  );

  const requiredOperationalPermissions = [
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
        in: requiredOperationalPermissions,
      },
    },
    select: { key: true },
  });
  const existingPermissionKeys = new Set(existingPermissions.map((permission) => permission.key));
  assert(
    results,
    "permission_matrix.standardized_operational_permission_keys_exist",
    requiredOperationalPermissions.every((permissionKey) => existingPermissionKeys.has(permissionKey)),
    `Found ${existingPermissions.length}/${requiredOperationalPermissions.length} required permission keys.`
  );
  assert(
    results,
    "permission_matrix.baseline_permissions_are_role_based",
    baselinePermissions.some((permission) => permission.key === "users.roles.assign") &&
      baselinePermissions.some((permission) => permission.key === "tasks.export")
  );
  assert(
    results,
    "service_partner_detail_page_exposes_permission_gated_sections",
    servicePartnerDetailSource.includes("Company Admins") &&
      servicePartnerDetailSource.includes("Clients") &&
      servicePartnerDetailSource.includes("Branches") &&
      servicePartnerDetailSource.includes("Service Request Summary") &&
      servicePartnerDetailSource.includes("Financial Summary")
  );
  assert(
    results,
    "email_change_pages_are_permission_gated",
    profilePageSource.includes('requirePermission("profile.email_change.request")') &&
      emailChangeRequestsPageSource.includes('requirePermission("email_change_requests.read")')
  );

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
