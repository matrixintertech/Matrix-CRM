import { readFileSync } from "node:fs";

import { AssignmentRole, ServicePartnerStatus, TaskStatus, UserStatus } from "@prisma/client";

import { getExportPermissionKey, getExportRows } from "../features/export/services/export.service";
import {
  createTask,
  createTaskRemark,
  getTaskById,
  getTaskHistoryEntries,
  listTasks,
  listTasksForServiceRequest,
  softDeleteTask,
  updateTask,
  updateTaskStatus,
} from "../features/tasks/services/task.service";
import { createTaskSchema } from "../features/tasks/validations";
import { createPrismaClient } from "../lib/db/client";
import {
  getTaskAssignmentNotificationRecipients,
  getTaskStatusNotificationRecipients,
  getTaskUpdateNotificationRecipients,
} from "../lib/notifications/notification.service";
import { ensureTenantRbac } from "../lib/rbac/bootstrap";
import { baselinePermissions } from "../lib/rbac/baseline";
import { permissionActionOrder } from "../lib/rbac/permission-matrix";

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
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: input.email }, { phone: input.phone }],
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        servicePartnerId: input.servicePartnerId,
        email: input.email,
        phone: input.phone,
        name: input.name,
        status: input.status ?? UserStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  return prisma.user.create({
    data: {
      servicePartnerId: input.servicePartnerId,
      email: input.email,
      phone: input.phone,
      name: input.name,
      status: input.status ?? UserStatus.ACTIVE,
    },
  });
}

async function ensurePhoneOnlyUser(input: {
  servicePartnerId: string;
  phone: string;
  name: string;
  status?: UserStatus;
}) {
  const existing = await prisma.user.findFirst({
    where: {
      phone: input.phone,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        servicePartnerId: input.servicePartnerId,
        email: null,
        phone: input.phone,
        name: input.name,
        status: input.status ?? UserStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  return prisma.user.create({
    data: {
      servicePartnerId: input.servicePartnerId,
      email: null,
      phone: input.phone,
      name: input.name,
      status: input.status ?? UserStatus.ACTIVE,
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

async function cleanupQaFixtures(serviceRequestIds: string[]) {
  await prisma.assignment.deleteMany({
    where: {
      serviceRequestId: {
        in: serviceRequestIds,
      },
    },
  });

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

function blockAfter(source: string, marker: string, endMarker: string) {
  const start = source.indexOf(marker);
  if (start === -1) {
    return "";
  }

  const sliced = source.slice(start + marker.length);
  const end = sliced.indexOf(endMarker);
  return end === -1 ? sliced : sliced.slice(0, end);
}

async function main() {
  const results: QaResult[] = [];

  const schemaSource = readFileSync("prisma/schema.prisma", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const taskServiceSource = readFileSync("features/tasks/services/task.service.ts", "utf8");
  const taskActionsSource = readFileSync("features/tasks/actions/task.actions.ts", "utf8");
  const taskFormSource = readFileSync("features/tasks/components/task-form.tsx", "utf8");
  const tasksTableSource = readFileSync("features/tasks/components/tasks-table.tsx", "utf8");
  const tasksPageSource = readFileSync("app/(dashboard)/tasks/page.tsx", "utf8");
  const taskDetailSource = readFileSync("app/(dashboard)/tasks/[id]/page.tsx", "utf8");
  const serviceRequestDetailSource = readFileSync("app/(dashboard)/service-requests/[id]/page.tsx", "utf8");
  const notificationSource = readFileSync("lib/notifications/notification.service.ts", "utf8");
  const taskValidationSource = readFileSync("features/tasks/validations.ts", "utf8");

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

  const updateTaskSchemaBlock = blockAfter(taskValidationSource, "export const updateTaskSchema = z.object({", "});");

  push(results, "schema.task_parent_relation_exists", schemaSource.includes("parentTaskId"));
  push(results, "schema.task_assigned_by_exists", schemaSource.includes("assignedByUserId"));
  push(results, "schema.role_level_exists", schemaSource.includes("level            Int"));
  push(
    results,
    "rbac.baseline_task_permissions_present",
    requiredPermissionKeys.every((key) => baselinePermissions.some((permission) => permission.key === key))
  );
  push(
    results,
    "rbac.permission_matrix_orders_task_hierarchy_actions",
    ["assign.downline", "assign.any", "delegate", "remark.create", "history.read"].every((key) =>
      permissionActionOrder.includes(key as (typeof permissionActionOrder)[number])
    )
  );

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

  const [
    companyAdminRoleId,
    managerRoleId,
    operatorRoleId,
    technicianRoleId,
    supportRoleId,
    foreignTechnicianRoleId,
  ] = await Promise.all([
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
    secondManager,
    operator,
    technician,
    support,
    siblingOperator,
    unrelatedSupport,
    responsibleSupport,
    foreignTechnician,
    inactiveTechnician,
    noEmailSupport,
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
      email: `${QA_PREFIX}.manager2@matrixcrm.local`,
      phone: "+919940000009",
      name: "QA Task Manager Two",
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
      email: `${QA_PREFIX}.sibling.operator@matrixcrm.local`,
      phone: "+919940000006",
      name: "QA Task Sibling Operator",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.unrelated.support@matrixcrm.local`,
      phone: "+919940000010",
      name: "QA Task Unrelated Support",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: `${QA_PREFIX}.responsible.support@matrixcrm.local`,
      phone: "+919940000011",
      name: "QA Task Responsible Support",
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
    ensurePhoneOnlyUser({
      servicePartnerId: tenant.id,
      phone: "+919940000012",
      name: "QA Task No Email Support",
    }),
  ]);

  await Promise.all([
    replaceUserRole(companyAdmin.id, companyAdminRoleId),
    replaceUserRole(manager.id, managerRoleId),
    replaceUserRole(secondManager.id, managerRoleId),
    replaceUserRole(operator.id, operatorRoleId),
    replaceUserRole(technician.id, technicianRoleId),
    replaceUserRole(support.id, supportRoleId),
    replaceUserRole(siblingOperator.id, operatorRoleId),
    replaceUserRole(unrelatedSupport.id, supportRoleId),
    replaceUserRole(responsibleSupport.id, supportRoleId),
    replaceUserRole(foreignTechnician.id, foreignTechnicianRoleId),
    replaceUserRole(inactiveTechnician.id, technicianRoleId),
    replaceUserRole(noEmailSupport.id, supportRoleId),
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

  await cleanupQaFixtures([tenantServiceRequest.id, foreignServiceRequest.id]);

  await prisma.assignment.createMany({
    data: [
      {
        servicePartnerId: tenant.id,
        serviceRequestId: tenantServiceRequest.id,
        userId: responsibleSupport.id,
        role: AssignmentRole.PM,
      },
      {
        servicePartnerId: tenant.id,
        serviceRequestId: tenantServiceRequest.id,
        userId: inactiveTechnician.id,
        role: AssignmentRole.TECHNICIAN,
      },
      {
        servicePartnerId: tenant.id,
        serviceRequestId: tenantServiceRequest.id,
        userId: noEmailSupport.id,
        role: AssignmentRole.SM,
      },
    ],
  });

  const [
    companyAdminRoleKeys,
    managerRoleKeys,
    operatorRoleKeys,
    technicianRoleKeys,
    unrelatedSupportRoleKeys,
    responsibleSupportRoleKeys,
  ] = await Promise.all([
    getRoleKeys(companyAdmin.id),
    getRoleKeys(manager.id),
    getRoleKeys(operator.id),
    getRoleKeys(technician.id),
    getRoleKeys(unrelatedSupport.id),
    getRoleKeys(responsibleSupport.id),
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
    roleKeys: await getRoleKeys(support.id),
    isSuperAdmin: false,
  });
  const unrelatedSupportSession = toSession({
    id: unrelatedSupport.id,
    servicePartnerId: tenant.id,
    roleKeys: unrelatedSupportRoleKeys,
    isSuperAdmin: false,
  });
  const responsibleSupportSession = toSession({
    id: responsibleSupport.id,
    servicePartnerId: tenant.id,
    roleKeys: responsibleSupportRoleKeys,
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

  const siblingChildTask = await createTask(managerSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    parentTaskId: parentTask.id,
    title: `${QA_PREFIX} sibling-child`,
    description: "Sibling child task outside technician scope.",
    assigneeUserId: support.id,
    status: TaskStatus.YET_TO_START,
    requestedAt: new Date("2026-06-04T13:15:00.000Z"),
    dueDate: new Date("2026-06-08T00:00:00.000Z"),
  });

  const privateTask = await createTask(companyAdminSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    title: `${QA_PREFIX} private`,
    description: "Private management task outside technician scope.",
    assigneeUserId: siblingOperator.id,
    status: TaskStatus.YET_TO_START,
  });

  const managerOwnTask = await createTask(companyAdminSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    title: `${QA_PREFIX} manager-own`,
    description: "Manager-visible task assigned using assign any.",
    assigneeUserId: manager.id,
    status: TaskStatus.YET_TO_START,
  });

  const managerPeerTask = await createTask(managerSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    title: `${QA_PREFIX} manager-peer`,
    description: "Manager can assign to equal role because of assign any.",
    assigneeUserId: secondManager.id,
    status: TaskStatus.YET_TO_START,
  });

  const foreignTask = await createTask(superSession as never, {
    serviceRequestId: foreignServiceRequest.id,
    title: `${QA_PREFIX} foreign`,
    description: "Foreign tenant task for super admin visibility.",
    assigneeUserId: foreignTechnician.id,
    status: TaskStatus.YET_TO_START,
  });

  const deletableLeaf = await createTask(companyAdminSession as never, {
    serviceRequestId: tenantServiceRequest.id,
    title: `${QA_PREFIX} deletable-leaf`,
    description: "Leaf task reserved for delete QA.",
    assigneeUserId: support.id,
    status: TaskStatus.YET_TO_START,
  });

  push(results, "role_hierarchy.higher_role_can_assign_lower_role", parentTask.assigneeUserId === operator.id);

  const lowerRoleBlockedError = await expectThrow(() =>
    createTask(technicianSession as never, {
      serviceRequestId: tenantServiceRequest.id,
      parentTaskId: childTask.id,
      title: `${QA_PREFIX} invalid-upline`,
      description: "Should fail",
      assigneeUserId: operator.id,
      status: TaskStatus.YET_TO_START,
    })
  );
  push(
    results,
    "role_hierarchy.lower_role_cannot_assign_higher_role",
    Boolean(lowerRoleBlockedError && lowerRoleBlockedError.toLowerCase().includes("lower-level")),
    lowerRoleBlockedError ?? undefined
  );

  const equalRoleBlockedError = await expectThrow(() =>
    createTask(operatorSession as never, {
      serviceRequestId: tenantServiceRequest.id,
      title: `${QA_PREFIX} invalid-equal`,
      description: "Should fail",
      assigneeUserId: siblingOperator.id,
      status: TaskStatus.YET_TO_START,
    })
  );
  push(
    results,
    "role_hierarchy.equal_role_blocked_without_assign_any",
    Boolean(equalRoleBlockedError && equalRoleBlockedError.toLowerCase().includes("lower-level")),
    equalRoleBlockedError ?? undefined
  );

  push(results, "role_hierarchy.assign_any_allows_equal_role_within_tenant", managerPeerTask.assigneeUserId === secondManager.id);

  const crossTenantAssignAnyError = await expectThrow(() =>
    createTask(managerSession as never, {
      serviceRequestId: tenantServiceRequest.id,
      title: `${QA_PREFIX} cross-tenant-assign-any`,
      description: "Should fail",
      assigneeUserId: foreignTechnician.id,
      status: TaskStatus.YET_TO_START,
    })
  );
  push(
    results,
    "role_hierarchy.cross_tenant_assignment_blocked_even_with_assign_any",
    Boolean(crossTenantAssignAnyError && crossTenantAssignAnyError.toLowerCase().includes("tenant")),
    crossTenantAssignAnyError ?? undefined
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
    "role_hierarchy.inactive_assignee_blocked",
    Boolean(inactiveBlockedError && inactiveBlockedError.toLowerCase().includes("invalid")),
    inactiveBlockedError ?? undefined
  );

  push(results, "parent_child.child_inherits_service_request", childTask.serviceRequestId === parentTask.serviceRequestId);
  push(
    results,
    "parent_child.child_parent_link_persisted",
    childTask.parentTaskId === parentTask.id && grandchildTask.parentTaskId === childTask.id
  );

  const parentDetail = await getTaskById(managerSession as never, parentTask.id);
  const childDetail = await getTaskById(managerSession as never, childTask.id);

  push(results, "parent_child.parent_shows_child_count", (parentDetail?.childTaskCount ?? 0) >= 2);
  push(results, "parent_child.child_detail_has_parent_summary", Boolean(childDetail?.parentTaskSummary?.id === parentTask.id));
  push(
    results,
    "parent_child.parent_detail_lists_child_tasks",
    Boolean(parentDetail?.childTasks.some((task) => task.id === childTask.id) && parentDetail?.childTasks.some((task) => task.id === siblingChildTask.id))
  );
  push(results, "parent_child.circular_parent_reassignment_ui_blocked", !updateTaskSchemaBlock.includes("parentTaskId"));
  push(results, "parent_child.circular_parent_reassignment_service_blocked", !taskServiceSource.includes("parentTaskId: input.parentTaskId"));

  const crossTenantParentChildError = await expectThrow(() =>
    createTask(superSession as never, {
      serviceRequestId: foreignServiceRequest.id,
      parentTaskId: parentTask.id,
      title: `${QA_PREFIX} cross-tenant-parent-child`,
      description: "Should fail",
      assigneeUserId: foreignTechnician.id,
      status: TaskStatus.YET_TO_START,
    })
  );
  push(
    results,
    "parent_child.parent_child_across_tenant_blocked",
    Boolean(crossTenantParentChildError && crossTenantParentChildError.toLowerCase().includes("same tenant")),
    crossTenantParentChildError ?? undefined
  );

  const superVisible = await listTasks(superSession as never, {});
  const companyVisible = await listTasksForServiceRequest(companyAdminSession as never, tenantServiceRequest.id);
  const managerVisible = await listTasksForServiceRequest(managerSession as never, tenantServiceRequest.id);
  const technicianVisible = await listTasksForServiceRequest(technicianSession as never, tenantServiceRequest.id);
  const responsibleVisible = await listTasksForServiceRequest(responsibleSupportSession as never, tenantServiceRequest.id);
  const unrelatedVisible = await listTasksForServiceRequest(unrelatedSupportSession as never, tenantServiceRequest.id);

  const superIds = new Set(superVisible.tasks.map((task) => task.id));
  const companyIds = new Set(companyVisible.tasks.map((task) => task.id));
  const managerIds = new Set(managerVisible.tasks.map((task) => task.id));
  const technicianIds = new Set(technicianVisible.tasks.map((task) => task.id));
  const responsibleIds = new Set(responsibleVisible.tasks.map((task) => task.id));
  const unrelatedIds = new Set(unrelatedVisible.tasks.map((task) => task.id));

  push(results, "visibility.super_admin_sees_all", superIds.has(parentTask.id) && superIds.has(foreignTask.id));
  push(
    results,
    "visibility.company_admin_sees_tenant_tasks",
    companyIds.has(parentTask.id) &&
      companyIds.has(childTask.id) &&
      companyIds.has(grandchildTask.id) &&
      companyIds.has(privateTask.id)
  );
  push(
    results,
    "visibility.pm_sees_own_delegated_descendant_tasks",
    managerIds.has(parentTask.id) &&
      managerIds.has(childTask.id) &&
      managerIds.has(grandchildTask.id) &&
      managerIds.has(siblingChildTask.id) &&
      managerIds.has(managerOwnTask.id)
  );
  push(results, "visibility.lower_assignee_sees_own_task", technicianIds.has(childTask.id));
  push(results, "visibility.lower_assignee_cannot_see_sibling_task", !technicianIds.has(siblingChildTask.id));
  push(results, "visibility.lower_assignee_cannot_see_unrelated_upline_private_task", !technicianIds.has(privateTask.id));
  push(results, "visibility.direct_url_access_blocked_for_forbidden_task", (await getTaskById(technicianSession as never, privateTask.id)) === null);
  push(results, "visibility.service_request_responsible_user_sees_related_tasks", responsibleIds.has(parentTask.id) && responsibleIds.has(privateTask.id));
  push(results, "visibility.unrelated_same_tenant_user_blocked", unrelatedIds.size === 0 && (await getTaskById(unrelatedSupportSession as never, parentTask.id)) === null);

  const updatedChild = await updateTaskStatus(technicianSession as never, childTask.id, {
    status: TaskStatus.COMPLETED,
  });
  push(
    results,
    "task_actions.assigned_user_can_update_own_status_when_allowed",
    updatedChild.status === TaskStatus.COMPLETED && Boolean(updatedChild.completedAt)
  );

  const managerChildAfterStatus = await getTaskById(managerSession as never, childTask.id);
  push(
    results,
    "task_actions.parent_delegator_can_view_child_status",
    Boolean(managerChildAfterStatus && managerChildAfterStatus.status === TaskStatus.COMPLETED)
  );

  const lowerUserEditBlockedError = await expectThrow(() =>
    updateTask(technicianSession as never, privateTask.id, {
      title: `${QA_PREFIX} private edited`,
      description: "Should fail",
      assigneeUserId: siblingOperator.id,
      status: TaskStatus.YET_TO_START,
      requestedAt: undefined,
      startDate: undefined,
      dueDate: undefined,
    })
  );
  push(
    results,
    "task_actions.lower_user_cannot_edit_parent_private_task",
    Boolean(lowerUserEditBlockedError && lowerUserEditBlockedError.toLowerCase().includes("not found")),
    lowerUserEditBlockedError ?? undefined
  );

  const hierarchyDeleteBlockedError = await expectThrow(() => softDeleteTask(companyAdminSession as never, parentTask.id));
  push(
    results,
    "task_actions.delete_blocks_parent_with_children",
    Boolean(hierarchyDeleteBlockedError && hierarchyDeleteBlockedError.toLowerCase().includes("child tasks")),
    hierarchyDeleteBlockedError ?? undefined
  );

  const permissionDeleteBlockedError = await expectThrow(() => softDeleteTask(supportSession as never, deletableLeaf.id));
  push(
    results,
    "task_actions.delete_respects_permissions",
    Boolean(permissionDeleteBlockedError && permissionDeleteBlockedError.toLowerCase().includes("delete tasks")),
    permissionDeleteBlockedError ?? undefined
  );

  const deletedLeaf = await softDeleteTask(companyAdminSession as never, deletableLeaf.id);
  push(results, "task_actions.leaf_delete_succeeds_when_allowed", Boolean(deletedLeaf.deletedAt));

  await prisma.activityLog.create({
    data: {
      servicePartnerId: childTask.servicePartnerId,
      actorUserId: technician.id,
      action: "task.status_change",
      module: "tasks",
      entityType: "TASK",
      entityId: childTask.id,
      message: `Task status changed to ${updatedChild.status}`,
      metadata: {
        fromStatus: TaskStatus.IN_PROGRESS,
        toStatus: updatedChild.status,
      },
    },
  });

  await createTaskRemark(managerSession as never, childTask.id, {
    remark: "Delegation QA remark.",
  });
  await prisma.activityLog.create({
    data: {
      servicePartnerId: childTask.servicePartnerId,
      actorUserId: manager.id,
      action: "task.remark_create",
      module: "tasks",
      entityType: "TASK",
      entityId: childTask.id,
      message: "Task remark added",
      metadata: {
        remark: "Delegation QA remark.",
      },
    },
  });

  const historyEntries = await getTaskHistoryEntries(managerSession as never, childTask.id);
  push(results, "task_actions.status_update_logs_activity", historyEntries.some((entry) => entry.action === "task.status_change"));
  push(
    results,
    "task_actions.remark_logs_activity_when_present",
    historyEntries.some((entry) => entry.action === "task.remark_create" && String((entry.metadata as { remark?: string })?.remark ?? "").includes("Delegation QA remark"))
  );

  push(results, "dates.created_at_automatic", Boolean(parentTask.createdAt));
  push(results, "dates.created_at_read_only_in_form", taskFormSource.includes("readOnly"));
  push(results, "dates.requested_at_persisted", parentTask.requestedAt?.toISOString() === "2026-06-04T10:15:00.000Z");
  push(
    results,
    "dates.requested_at_invalid_rejected",
    !createTaskSchema.safeParse({
      serviceRequestId: tenantServiceRequest.id,
      title: "x",
      status: TaskStatus.YET_TO_START,
      requestedAt: "not-a-date",
    }).success
  );
  push(
    results,
    "dates.due_date_remains_independent",
    Boolean(parentTask.dueDate && parentTask.requestedAt && parentTask.dueDate.getTime() !== parentTask.requestedAt.getTime())
  );

  const assignmentRecipients = await getTaskAssignmentNotificationRecipients(parentTask.id, manager.id);
  const delegatedRecipients = await getTaskAssignmentNotificationRecipients(childTask.id, operator.id);
  const statusRecipients = await getTaskStatusNotificationRecipients(childTask.id, technician.id);
  const updateRecipients = await getTaskUpdateNotificationRecipients(childTask.id, operator.id);

  const assignmentRecipientIds = new Set(assignmentRecipients.map((recipient) => recipient.id));
  const delegatedRecipientIds = new Set(delegatedRecipients.map((recipient) => recipient.id));
  const statusRecipientIds = new Set(statusRecipients.map((recipient) => recipient.id));
  const updateRecipientIds = new Set(updateRecipients.map((recipient) => recipient.id));

  push(
    results,
    "notifications.assignment_goes_to_new_assignee",
    assignmentRecipientIds.has(operator.id) && assignmentRecipientIds.size === 1
  );
  push(
    results,
    "notifications.delegation_goes_to_parent_involved_users",
    delegatedRecipientIds.has(technician.id) &&
      delegatedRecipientIds.has(manager.id) &&
      !delegatedRecipientIds.has(siblingOperator.id) &&
      !delegatedRecipientIds.has(foreignTechnician.id)
  );
  push(
    results,
    "notifications.status_update_notifies_delegator_and_responsible_users",
    statusRecipientIds.has(operator.id) &&
      statusRecipientIds.has(manager.id) &&
      statusRecipientIds.has(responsibleSupport.id)
  );
  push(results, "notifications.unrelated_user_excluded", !statusRecipientIds.has(unrelatedSupport.id));
  push(results, "notifications.actor_dedupe_works", !assignmentRecipientIds.has(manager.id) && !delegatedRecipientIds.has(operator.id));
  push(
    results,
    "notifications.no_email_and_inactive_users_skipped",
    !statusRecipientIds.has(noEmailSupport.id) && !statusRecipientIds.has(inactiveTechnician.id)
  );
  push(
    results,
    "notifications.email_failure_does_not_break_mutation_path",
    notificationSource.includes("catch {") && taskActionsSource.includes("notification failed")
  );
  push(
    results,
    "notifications.update_recipients_include_responsible_users_only",
    updateRecipientIds.has(technician.id) &&
      updateRecipientIds.has(manager.id) &&
      updateRecipientIds.has(responsibleSupport.id) &&
      !updateRecipientIds.has(unrelatedSupport.id)
  );

  const exportRows = await getExportRows(managerSession as never, "tasks", new URLSearchParams({ serviceRequestId: tenantServiceRequest.id }));
  const childExportRow = exportRows.find((row) => (row as Record<string, unknown>).taskNumber === childTask.taskNumber) as
    | Record<string, unknown>
    | undefined;

  push(results, "export.tasks_export_permission_required", getExportPermissionKey("tasks") === "tasks.export");
  push(
    results,
    "export.tenant_export_scoped",
    exportRows.every((row) => String((row as Record<string, unknown>).serviceRequest).startsWith("QATH-SR-001"))
  );
  push(
    results,
    "export.rows_include_hierarchy_fields",
    !!childExportRow &&
      "parentTask" in childExportRow &&
      "assignedBy" in childExportRow &&
      "assignedTo" in childExportRow &&
      "hierarchyLevel" in childExportRow &&
      "requestedAt" in childExportRow &&
      "dueDate" in childExportRow &&
      "status" in childExportRow &&
      "serviceRequest" in childExportRow
  );

  push(
    results,
    "ui.tasks_page_has_scope_tabs_and_filters",
    tasksPageSource.includes("scopeOptions") && tasksPageSource.includes("Apply Filters")
  );
  push(
    results,
    "ui.task_detail_shows_assignment_chain_and_parent_link",
    taskDetailSource.includes("Assignment chain") && taskDetailSource.includes("Parent task")
  );
  push(
    results,
    "ui.service_request_detail_shows_hierarchy_guidance_and_links",
    serviceRequestDetailSource.includes("delegate sub-tasks") &&
      serviceRequestDetailSource.includes("TasksTable") &&
      tasksTableSource.includes("Parent:")
  );
  push(
    results,
    "ui.no_broken_task_links_in_sources",
    tasksTableSource.includes('href={`/tasks/${task.id}`}') &&
      taskDetailSource.includes('href={`/service-requests/${taskServiceRequestSummary.id}`}') &&
      serviceRequestDetailSource.includes('redirectTo={`/service-requests/${serviceRequest.id}`}')
  );

  const requiredRegressionScripts = [
    "qa:operational-hardening",
    "qa:access",
    "qa:rbac",
    "qa:service-requests",
    "qa:production-readiness",
  ];
  push(
    results,
    "regression.required_qa_scripts_exist",
    requiredRegressionScripts.every((scriptName) => Boolean(packageJson.scripts?.[scriptName]))
  );
  push(results, "regression.task_status_action_logs_source_present", taskActionsSource.includes('action: "task.status_change"'));
  push(results, "regression.task_remark_action_logs_source_present", taskActionsSource.includes('action: "task.remark_create"'));

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
