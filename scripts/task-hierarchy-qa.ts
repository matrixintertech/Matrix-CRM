import { readFileSync } from "node:fs";

import { ServicePartnerStatus, TaskStatus, UserStatus } from "@prisma/client";

import { getExportPermissionKey, getExportRows } from "../features/export/services/export.service";
import { createTask, getTaskById, listTasks, listTasksForServiceRequest } from "../features/tasks/services/task.service";
import { createTaskSchema } from "../features/tasks/validations";
import { getTaskNotificationContext } from "../lib/notifications/notification.service";
import { createPrismaClient } from "../lib/db/client";
import { ensureTenantRbac } from "../lib/rbac/bootstrap";

const prisma = createPrismaClient();

type QaStatus = "PASS" | "FAIL";
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
  };
};

const QA_PREFIX = "qa.task.hierarchy";
const TENANT_CODE = "QATASKH";
const FOREIGN_CODE = "QATASKHF";

function push(results: QaResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
}

async function expectThrow(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function getRoleKeys(userId: string) {
  const rows = await prisma.userRole.findMany({
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

  return rows.map((row) => row.role.key);
}

function toSession(input: { id: string; servicePartnerId: string; roleKeys: string[]; isSuperAdmin: boolean }): SessionLike {
  return {
    user: {
      id: input.id,
      servicePartnerId: input.servicePartnerId,
      roleKeys: input.roleKeys,
      isSuperAdmin: input.isSuperAdmin,
    },
  };
}

async function ensureServicePartner(code: string, name: string) {
  const servicePartner = await prisma.servicePartner.upsert({
    where: { code },
    update: {
      name,
      status: ServicePartnerStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      code,
      name,
      status: ServicePartnerStatus.ACTIVE,
    },
  });

  await ensureTenantRbac(prisma, {
    servicePartnerId: servicePartner.id,
    includePlatformRole: false,
  });

  return servicePartner;
}

async function ensureRoleId(servicePartnerId: string, key: string) {
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
    throw new Error(`Missing role ${key}`);
  }

  return role.id;
}

async function replaceUserRole(userId: string, roleId: string) {
  await prisma.userRole.deleteMany({ where: { userId } });
  await prisma.userRole.create({
    data: {
      userId,
      roleId,
    },
  });
}

async function ensureUser(input: {
  servicePartnerId: string;
  email: string;
  phone: string;
  name: string;
  status?: UserStatus;
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      servicePartnerId: input.servicePartnerId,
      phone: input.phone,
      name: input.name,
      status: input.status ?? UserStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      email: input.email,
      phone: input.phone,
      name: input.name,
      status: input.status ?? UserStatus.ACTIVE,
    },
  });
}

async function ensureServiceRequest(input: {
  servicePartnerId: string;
  clientId: string;
  createdByUserId: string;
  serviceNumber: string;
  title: string;
}) {
  return prisma.serviceRequest.upsert({
    where: {
      servicePartnerId_serviceNumber: {
        servicePartnerId: input.servicePartnerId,
        serviceNumber: input.serviceNumber,
      },
    },
    update: {
      clientId: input.clientId,
      createdByUserId: input.createdByUserId,
      title: input.title,
      serviceType: "QA",
      status: "RAISED",
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: input.clientId,
      createdByUserId: input.createdByUserId,
      serviceNumber: input.serviceNumber,
      title: input.title,
      serviceType: "QA",
      status: "RAISED",
    },
  });
}

async function ensureClient(servicePartnerId: string, code: string, name: string) {
  return prisma.client.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId,
        code,
      },
    },
    update: {
      name,
      status: "ACTIVE",
      deletedAt: null,
    },
    create: {
      servicePartnerId,
      code,
      name,
      status: "ACTIVE",
    },
  });
}

async function cleanupTaskFixtures(serviceRequestIds: string[]) {
  await prisma.task.deleteMany({
    where: {
      serviceRequestId: {
        in: serviceRequestIds,
      },
      title: {
        startsWith: QA_PREFIX,
      },
    },
  });
}

async function main() {
  const results: QaResult[] = [];

  const schemaSource = readFileSync("prisma/schema.prisma", "utf8");
  const serviceRequestDetailSource = readFileSync("app/(dashboard)/service-requests/[id]/page.tsx", "utf8");
  const tasksPageSource = readFileSync("app/(dashboard)/tasks/page.tsx", "utf8");

  const requiredPermissionKeys = [
    "tasks.read",
    "tasks.create",
    "tasks.update",
    "tasks.delete",
    "tasks.assign",
    "tasks.assign.downline",
    "tasks.assign.any",
    "tasks.delegate",
    "tasks.status.update",
    "tasks.remark.create",
    "tasks.history.read",
    "tasks.export",
  ];

  const permissions = await prisma.permission.findMany({
    where: {
      key: {
        in: requiredPermissionKeys,
      },
    },
    select: { key: true },
  });
  const permissionSet = new Set(permissions.map((permission) => permission.key));
  push(results, "schema.task_parent_relation_exists", schemaSource.includes("parentTaskId"));
  push(results, "schema.task_assigned_by_exists", schemaSource.includes("assignedByUserId"));
  push(results, "schema.role_level_exists", schemaSource.includes("level            Int"));
  push(results, "permissions.task_hierarchy_keys_exist", requiredPermissionKeys.every((key) => permissionSet.has(key)));

  const superAdmin = await prisma.user.findFirst({
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
    },
  });
  if (!superAdmin) {
    throw new Error("Super admin user not found.");
  }

  const superRoleKeys = await getRoleKeys(superAdmin.id);
  const superSession = toSession({
    id: superAdmin.id,
    servicePartnerId: superAdmin.servicePartnerId,
    roleKeys: superRoleKeys,
    isSuperAdmin: true,
  });

  const [tenant, foreignTenant] = await Promise.all([
    ensureServicePartner(TENANT_CODE, "QA Task Hierarchy Company"),
    ensureServicePartner(FOREIGN_CODE, "QA Task Hierarchy Foreign"),
  ]);

  const [companyAdminRoleId, managerRoleId, operatorRoleId, technicianRoleId, supportRoleId, foreignTechnicianRoleId] = await Promise.all([
    ensureRoleId(tenant.id, "company_admin"),
    ensureRoleId(tenant.id, "manager"),
    ensureRoleId(tenant.id, "operator"),
    ensureRoleId(tenant.id, "technician"),
    ensureRoleId(tenant.id, "support"),
    ensureRoleId(foreignTenant.id, "technician"),
  ]);

  const [
    companyAdmin,
    manager,
    operator,
    technician,
    support,
    sibling,
    foreignTechnician,
    inactiveTechnician,
  ] = await Promise.all([
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.companyadmin@matrixcrm.local`,
      phone: "+919940000001",
      name: "QA Task Company Admin",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.manager@matrixcrm.local`,
      phone: "+919940000002",
      name: "QA Task Manager",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.operator@matrixcrm.local`,
      phone: "+919940000003",
      name: "QA Task Operator",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.technician@matrixcrm.local`,
      phone: "+919940000004",
      name: "QA Task Technician",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.support@matrixcrm.local`,
      phone: "+919940000005",
      name: "QA Task Support",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.sibling@matrixcrm.local`,
      phone: "+919940000006",
      name: "QA Task Sibling",
    }),
    ensureUser({
      servicePartnerId: foreignTenant.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      phone: "+919940000007",
      name: "QA Task Foreign",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.inactive@matrixcrm.local`,
      phone: "+919940000008",
      name: "QA Task Inactive",
      status: UserStatus.INACTIVE,
    }),
  ]);

  await Promise.all([
    replaceUserRole(companyAdmin.id, companyAdminRoleId),
    replaceUserRole(manager.id, managerRoleId),
    replaceUserRole(operator.id, operatorRoleId),
    replaceUserRole(technician.id, technicianRoleId),
    replaceUserRole(support.id, supportRoleId),
    replaceUserRole(sibling.id, operatorRoleId),
    replaceUserRole(foreignTechnician.id, foreignTechnicianRoleId),
    replaceUserRole(inactiveTechnician.id, technicianRoleId),
  ]);

  const [managerRole, operatorRole, technicianRole, supportRole] = await Promise.all([
    prisma.role.findUnique({ where: { id: managerRoleId }, select: { level: true } }),
    prisma.role.findUnique({ where: { id: operatorRoleId }, select: { level: true } }),
    prisma.role.findUnique({ where: { id: technicianRoleId }, select: { level: true } }),
    prisma.role.findUnique({ where: { id: supportRoleId }, select: { level: true } }),
  ]);
  push(
    results,
    "roles.levels_descend_as_expected",
    Boolean(managerRole && operatorRole && technicianRole && supportRole) &&
      managerRole!.level > operatorRole!.level &&
      operatorRole!.level > technicianRole!.level &&
      technicianRole!.level > supportRole!.level
  );

  const [tenantClient, foreignClient] = await Promise.all([
    ensureClient(tenant.id, "QATH-CL-001", "QA Task Hierarchy Client"),
    ensureClient(foreignTenant.id, "QATHF-CL-001", "QA Task Hierarchy Foreign Client"),
  ]);

  const [tenantServiceRequest, foreignServiceRequest] = await Promise.all([
    ensureServiceRequest({
      servicePartnerId: tenant.id,
      clientId: tenantClient.id,
      createdByUserId: manager.id,
      serviceNumber: "QATH-SR-001",
      title: "QA Task Hierarchy Request",
    }),
    ensureServiceRequest({
      servicePartnerId: foreignTenant.id,
      clientId: foreignClient.id,
      createdByUserId: foreignTechnician.id,
      serviceNumber: "QATHF-SR-001",
      title: "QA Task Hierarchy Foreign Request",
    }),
  ]);

  await cleanupTaskFixtures([tenantServiceRequest.id, foreignServiceRequest.id]);

  const [companyAdminRoleKeys, managerRoleKeys, operatorRoleKeys, technicianRoleKeys, supportRoleKeys, siblingRoleKeys] =
    await Promise.all([
      getRoleKeys(companyAdmin.id),
      getRoleKeys(manager.id),
      getRoleKeys(operator.id),
      getRoleKeys(technician.id),
      getRoleKeys(support.id),
      getRoleKeys(sibling.id),
    ]);

  const companyAdminSession = toSession({
    id: companyAdmin.id,
    servicePartnerId: tenant.id,
    roleKeys: companyAdminRoleKeys,
    isSuperAdmin: false,
  });
  const managerSession = toSession({
    id: manager.id,
    servicePartnerId: tenant.id,
    roleKeys: managerRoleKeys,
    isSuperAdmin: false,
  });
  const operatorSession = toSession({
    id: operator.id,
    servicePartnerId: tenant.id,
    roleKeys: operatorRoleKeys,
    isSuperAdmin: false,
  });
  const technicianSession = toSession({
    id: technician.id,
    servicePartnerId: tenant.id,
    roleKeys: technicianRoleKeys,
    isSuperAdmin: false,
  });
  const supportSession = toSession({
    id: support.id,
    servicePartnerId: tenant.id,
    roleKeys: supportRoleKeys,
    isSuperAdmin: false,
  });
  const siblingSession = toSession({
    id: sibling.id,
    servicePartnerId: tenant.id,
    roleKeys: siblingRoleKeys,
    isSuperAdmin: false,
  });

  const parentTask = await createTask(managerSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    title: `${QA_PREFIX} parent`,
    description: "Parent task assigned downline.",
    assigneeUserId: operator.id,
    status: TaskStatus.YET_TO_START,
    requestedAt: new Date("2026-06-04T10:15:00.000Z"),
    dueDate: new Date("2026-06-05T00:00:00.000Z"),
  });

  const childTask = await createTask(operatorSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    parentTaskId: parentTask.id,
    title: `${QA_PREFIX} child`,
    description: "Child task delegated downline.",
    assigneeUserId: technician.id,
    status: TaskStatus.IN_PROGRESS,
    requestedAt: new Date("2026-06-04T11:15:00.000Z"),
    dueDate: new Date("2026-06-06T00:00:00.000Z"),
  });

  const grandchildTask = await createTask(technicianSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    parentTaskId: childTask.id,
    title: `${QA_PREFIX} grandchild`,
    description: "Grandchild task delegated to support.",
    assigneeUserId: support.id,
    status: TaskStatus.YET_TO_START,
    requestedAt: new Date("2026-06-04T12:15:00.000Z"),
    dueDate: new Date("2026-06-07T00:00:00.000Z"),
  });

  const privateTask = await createTask(companyAdminSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    title: `${QA_PREFIX} private`,
    description: "Private management task outside operator scope.",
    assigneeUserId: sibling.id,
    status: TaskStatus.YET_TO_START,
  });

  const foreignTask = await createTask(superSession as never, {
    serviceRequestId: foreignServiceRequest.id,
    title: `${QA_PREFIX} foreign`,
    description: "Foreign tenant task for super admin visibility.",
    assigneeUserId: foreignTechnician.id,
    status: TaskStatus.YET_TO_START,
  });

  push(results, "delegation.child_inherits_service_request", childTask.serviceRequestId === parentTask.serviceRequestId);
  push(results, "delegation.parent_child_link_created", childTask.parentTaskId === parentTask.id && grandchildTask.parentTaskId === childTask.id);
  push(results, "delegation.assigned_by_recorded", parentTask.assignedByUserId === manager.id && childTask.assignedByUserId === operator.id);
  push(results, "dates.created_at_automatic", Boolean(parentTask.createdAt));
  push(results, "dates.requested_at_persisted", parentTask.requestedAt?.toISOString() === "2026-06-04T10:15:00.000Z");
  push(results, "dates.due_date_persisted", Boolean(childTask.dueDate));
  push(
    results,
    "dates.invalid_date_rejected",
    !createTaskSchema.safeParse({
      serviceRequestId: tenantServiceRequest.id,
      title: "x",
      status: TaskStatus.YET_TO_START,
      requestedAt: "not-a-date",
    }).success
  );

  const equalOrHigherBlockedError = await expectThrow(() =>
    createTask(technicianSession as never, {
      serviceRequestId: tenantServiceRequest.id,
      parentTaskId: childTask.id,
      title: `${QA_PREFIX} invalid up`,
      description: "Should fail",
      assigneeUserId: operator.id,
      status: TaskStatus.YET_TO_START,
    })
  );
  push(
    results,
    "delegation.equal_or_higher_assignment_blocked_without_assign_any",
    Boolean(equalOrHigherBlockedError && equalOrHigherBlockedError.toLowerCase().includes("lower-level")),
    equalOrHigherBlockedError ?? undefined
  );

  const crossTenantBlockedError = await expectThrow(() =>
    createTask(managerSession as never, {
      serviceRequestId: tenantServiceRequest.id,
      title: `${QA_PREFIX} cross tenant`,
      description: "Should fail",
      assigneeUserId: foreignTechnician.id,
      status: TaskStatus.YET_TO_START,
    })
  );
  push(
    results,
    "delegation.cross_tenant_assignment_blocked",
    Boolean(crossTenantBlockedError && crossTenantBlockedError.toLowerCase().includes("tenant")),
    crossTenantBlockedError ?? undefined
  );

  const inactiveBlockedError = await expectThrow(() =>
    createTask(managerSession as never, {
      serviceRequestId: tenantServiceRequest.id,
      title: `${QA_PREFIX} inactive`,
      description: "Should fail",
      assigneeUserId: inactiveTechnician.id,
      status: TaskStatus.YET_TO_START,
    })
  );
  push(
    results,
    "delegation.inactive_assignee_blocked",
    Boolean(inactiveBlockedError && inactiveBlockedError.toLowerCase().includes("invalid")),
    inactiveBlockedError ?? undefined
  );

  const companyAdminAnyAssignment = await createTask(companyAdminSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    title: `${QA_PREFIX} admin-any`,
    description: "Company admin can assign within tenant.",
    assigneeUserId: manager.id,
    status: TaskStatus.YET_TO_START,
  });
  push(results, "delegation.company_admin_can_assign_within_tenant", companyAdminAnyAssignment.assigneeUserId === manager.id);

  const managerVisible = await listTasksForServiceRequest(managerSession as never, tenantServiceRequest.id);
  const operatorVisible = await listTasksForServiceRequest(operatorSession as never, tenantServiceRequest.id);
  const supportVisible = await listTasksForServiceRequest(supportSession as never, tenantServiceRequest.id);
  const siblingVisible = await listTasksForServiceRequest(siblingSession as never, tenantServiceRequest.id);
  const companyVisible = await listTasksForServiceRequest(companyAdminSession as never, tenantServiceRequest.id);
  const superVisible = await listTasks(superSession as never, {});

  const managerIds = new Set(managerVisible.tasks.map((task) => task.id));
  const operatorIds = new Set(operatorVisible.tasks.map((task) => task.id));
  const supportIds = new Set(supportVisible.tasks.map((task) => task.id));
  const siblingIds = new Set(siblingVisible.tasks.map((task) => task.id));
  const companyIds = new Set(companyVisible.tasks.map((task) => task.id));
  const superIds = new Set(superVisible.tasks.map((task) => task.id));

  push(results, "visibility.upper_level_user_sees_delegated_child_tasks", managerIds.has(parentTask.id) && managerIds.has(childTask.id) && managerIds.has(grandchildTask.id));
  push(results, "visibility.lower_level_user_sees_own_and_delegated_scope", supportIds.has(grandchildTask.id) && !supportIds.has(parentTask.id) && !supportIds.has(privateTask.id));
  push(results, "visibility.operator_sees_parent_and_descendants_not_private_sibling_task", operatorIds.has(parentTask.id) && operatorIds.has(childTask.id) && operatorIds.has(grandchildTask.id) && !operatorIds.has(privateTask.id));
  push(results, "visibility_sibling_user_cannot_see_unrelated_tasks", !siblingIds.has(parentTask.id) && !siblingIds.has(childTask.id) && siblingIds.has(privateTask.id));
  push(results, "visibility_company_admin_sees_all_tenant_tasks", companyIds.has(parentTask.id) && companyIds.has(childTask.id) && companyIds.has(grandchildTask.id) && companyIds.has(privateTask.id));
  push(results, "visibility_super_admin_sees_all_tenants", superIds.has(parentTask.id) && superIds.has(foreignTask.id));

  const supportGrandchildDetail = await getTaskById(supportSession as never, grandchildTask.id);
  const supportParentDetail = await getTaskById(supportSession as never, parentTask.id);
  push(
    results,
    "visibility_assignment_chain_exposed_on_visible_descendant",
    Boolean(supportGrandchildDetail && (supportGrandchildDetail.assignmentChain?.length ?? 0) >= 3)
  );
  push(results, "visibility_lower_level_user_cannot_open_unrelated_parent", supportParentDetail === null);

  const notificationContext = await getTaskNotificationContext(childTask.id);
  const notificationRecipientIds = new Set(notificationContext?.recipients.map((recipient) => recipient.id));
  push(
    results,
    "notifications.assignment_recipients_are_involved_only",
    Boolean(notificationContext) &&
      notificationRecipientIds.has(manager.id) &&
      notificationRecipientIds.has(operator.id) &&
      notificationRecipientIds.has(technician.id) &&
      !notificationRecipientIds.has(sibling.id) &&
      !notificationRecipientIds.has(foreignTechnician.id)
  );

  const exportRows = await getExportRows(managerSession as never, "tasks", new URLSearchParams({ serviceRequestId: tenantServiceRequest.id }));
  const childExportRow = exportRows.find((row) => row.taskNumber === childTask.taskNumber) as Record<string, unknown> | undefined;
  push(results, "export.permission_key_is_tasks_export", getExportPermissionKey("tasks") === "tasks.export");
  push(
    results,
    "export.rows_include_hierarchy_fields",
    Boolean(childExportRow) &&
      (!!childExportRow && "parentTask" in childExportRow) &&
      (!!childExportRow && "assignedBy" in childExportRow) &&
      (!!childExportRow && "hierarchyLevel" in childExportRow) &&
      (!!childExportRow && "assignmentChain" in childExportRow)
  );
  push(
    results,
    "export.rows_remain_tenant_scoped",
    exportRows.every((row) => String((row as Record<string, unknown>).serviceRequest).includes("QATH-SR-001"))
  );

  push(
    results,
    "ui.service_request_detail_references_task_hierarchy",
    serviceRequestDetailSource.includes("delegate sub-tasks") && serviceRequestDetailSource.includes("TasksTable")
  );
  push(results, "ui.tasks_page_exists", tasksPageSource.includes('title="Tasks"'));

  const failed = results.filter((result) => result.status === "FAIL");
  console.log(
    JSON.stringify(
      {
        summary: {
          total: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
        },
        failed,
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
