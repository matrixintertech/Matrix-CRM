import { existsSync, readFileSync } from "node:fs";
import {
  PrismaClient,
  ServicePartnerStatus,
  ServiceRequestStatus,
  TaskStatus,
  UserStatus,
} from "@prisma/client";

import {
  getServiceRequestResponsibilities,
  listResponsibilityCandidates,
  updateServiceRequestResponsibilities,
} from "../features/service-requests/services/service-request-responsibility.service";
import { getServiceRequestById, updateServiceRequestStatus } from "../features/service-requests/services/service-request.service";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { getUserPermissions, hasPermission } from "../lib/auth/permissions";
import { ensureTenantRbac } from "../lib/rbac/bootstrap";
import {
  createTask,
  listTasksForServiceRequest,
  softDeleteTask,
  updateTask,
  updateTaskStatus,
} from "../features/tasks/services/task.service";

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
  };
};

type TenantData = {
  servicePartnerId: string;
  clientId: string;
  branchId: string;
  serviceRequestId: string;
};

const QA_PREFIX = "qa.sr.workitems";
const COMPANY_CODE = "QASRWICOMP";
const FOREIGN_CODE = "QASRWIFORE";
const REQUIRED_PERMISSION_KEYS = [
  "service_requests.responsibility.read",
  "service_requests.responsibility.update",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "tasks.delete",
  "tasks.status.update",
] as const;

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
}

async function expectThrow(fn: () => Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

function flattenNavKeys(items: Awaited<ReturnType<typeof getNavigationForSession>>) {
  const keys: string[] = [];
  const visit = (nodes: typeof items) => {
    for (const node of nodes) {
      keys.push(node.key);
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(items);
  return keys;
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

function toSession(input: {
  id: string;
  servicePartnerId: string;
  roleKeys: string[];
  isSuperAdmin: boolean;
}): SessionLike {
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

async function ensureTenantData(input: {
  servicePartnerId: string;
  prefix: string;
  createdByUserId: string;
}): Promise<TenantData> {
  const clientCode = `${input.prefix}-CL-001`;
  const branchCode = `${input.prefix}-BR-001`;
  const serviceNumber = `${input.prefix}-SR-001`;

  const client = await prisma.client.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: clientCode,
      },
    },
    update: {
      name: `${input.prefix} Client`,
      status: "ACTIVE",
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: clientCode,
      name: `${input.prefix} Client`,
      status: "ACTIVE",
    },
  });

  const branch = await prisma.branch.upsert({
    where: {
      clientId_code: {
        clientId: client.id,
        code: branchCode,
      },
    },
    update: {
      name: `${input.prefix} Branch`,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: client.id,
      code: branchCode,
      name: `${input.prefix} Branch`,
    },
  });

  const serviceRequest = await prisma.serviceRequest.upsert({
    where: {
      servicePartnerId_serviceNumber: {
        servicePartnerId: input.servicePartnerId,
        serviceNumber,
      },
    },
    update: {
      clientId: client.id,
      branchId: branch.id,
      createdByUserId: input.createdByUserId,
      title: `${input.prefix} Service Request`,
      description: "QA service request for responsibility/work-item checks.",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: client.id,
      branchId: branch.id,
      createdByUserId: input.createdByUserId,
      serviceNumber,
      title: `${input.prefix} Service Request`,
      description: "QA service request for responsibility/work-item checks.",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
    },
  });

  const historyCount = await prisma.serviceRequestStatusHistory.count({
    where: {
      serviceRequestId: serviceRequest.id,
    },
  });
  if (historyCount === 0) {
    await prisma.serviceRequestStatusHistory.create({
      data: {
        serviceRequestId: serviceRequest.id,
        fromStatus: null,
        toStatus: serviceRequest.status,
        remarks: "QA baseline history row",
        changedByUserId: input.createdByUserId,
      },
    });
  }

  return {
    servicePartnerId: input.servicePartnerId,
    clientId: client.id,
    branchId: branch.id,
    serviceRequestId: serviceRequest.id,
  };
}

async function ensureQaUser(input: {
  servicePartnerId: string;
  roleId: string;
  email: string;
  name: string;
  phone: string;
  status: UserStatus;
}) {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      servicePartnerId: input.servicePartnerId,
      name: input.name,
      phone: input.phone,
      status: input.status,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      email: input.email,
      name: input.name,
      phone: input.phone,
      status: input.status,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: input.roleId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: input.roleId,
    },
  });

  return user;
}

async function replaceDirectPermissions(input: {
  userId: string;
  servicePartnerId: string;
  assignedByUserId: string;
  permissionKeys: string[];
}) {
  await prisma.userPermission.deleteMany({
    where: {
      userId: input.userId,
    },
  });

  if (input.permissionKeys.length === 0) {
    return;
  }

  const permissions = await prisma.permission.findMany({
    where: {
      key: {
        in: input.permissionKeys,
      },
    },
    select: {
      id: true,
      key: true,
    },
  });
  const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

  const permissionIds = input.permissionKeys
    .map((key) => idByKey.get(key))
    .filter((value): value is string => Boolean(value));

  await prisma.userPermission.createMany({
    data: permissionIds.map((permissionId) => ({
      userId: input.userId,
      permissionId,
      allowed: true,
      servicePartnerId: input.servicePartnerId,
      assignedByUserId: input.assignedByUserId,
    })),
    skipDuplicates: true,
  });
}

async function cleanupQaRecords(data: { companyServiceRequestId?: string; foreignServiceRequestId?: string }) {
  const serviceRequestIds = [data.companyServiceRequestId, data.foreignServiceRequestId].filter(
    (value): value is string => Boolean(value)
  );

  if (serviceRequestIds.length === 0) {
    return;
  }

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

  await prisma.assignment.deleteMany({
    where: {
      serviceRequestId: data.companyServiceRequestId,
    },
  });
}

async function main() {
  const results: QAResult[] = [];

  let companyServiceRequestId: string | undefined;
  let foreignServiceRequestId: string | undefined;

  try {
    const requiredPermissions = await prisma.permission.findMany({
      where: {
        key: {
          in: [...REQUIRED_PERMISSION_KEYS],
        },
      },
      select: {
        key: true,
      },
    });
    const requiredPermissionSet = new Set(requiredPermissions.map((permission) => permission.key));
    for (const permissionKey of REQUIRED_PERMISSION_KEYS) {
      pushResult(results, `permissions.${permissionKey}.exists`, requiredPermissionSet.has(permissionKey));
    }

    const superAdmin = await prisma.user.findFirst({
      where: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Responsibility Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Responsibility Foreign");

    const companyRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: companyPartner.id,
        key: "manager",
        deletedAt: null,
      },
      select: {
        id: true,
        key: true,
      },
    });
    const companyAdminRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: companyPartner.id,
        key: "company_admin",
        deletedAt: null,
      },
      select: {
        id: true,
        key: true,
      },
    });
    const foreignRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: foreignPartner.id,
        key: "manager",
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (!companyRole || !companyAdminRole || !foreignRole) {
      throw new Error("QA tenant roles could not be resolved.");
    }

    const qaOperator = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyRole.id,
      email: `${QA_PREFIX}.operator@matrixcrm.local`,
      name: "QA Operator",
      phone: "+919930000001",
      status: UserStatus.ACTIVE,
    });
    const qaCompanyAdmin = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyAdminRole.id,
      email: `${QA_PREFIX}.companyadmin@matrixcrm.local`,
      name: "QA Company Admin",
      phone: "+919930000002",
      status: UserStatus.ACTIVE,
    });

    const companyData = await ensureTenantData({
      servicePartnerId: companyPartner.id,
      prefix: "QASRWI",
      createdByUserId: qaOperator.id,
    });
    const foreignData = await ensureTenantData({
      servicePartnerId: foreignPartner.id,
      prefix: "QASRWIF",
      createdByUserId: qaOperator.id,
    });
    companyServiceRequestId = companyData.serviceRequestId;
    foreignServiceRequestId = foreignData.serviceRequestId;

    await cleanupQaRecords({
      companyServiceRequestId,
      foreignServiceRequestId,
    });

    const [
      pmUserV1,
      pmUserV2,
      smUser,
      technicianUser,
      inactiveUser,
      readOnlyUser,
      noTaskOpsUser,
      foreignUser,
    ] = await Promise.all([
      ensureQaUser({
        servicePartnerId: companyPartner.id,
        roleId: companyRole.id,
        email: `${QA_PREFIX}.pm1@matrixcrm.local`,
        name: "QA PM One",
        phone: "+919930000011",
        status: UserStatus.ACTIVE,
      }),
      ensureQaUser({
        servicePartnerId: companyPartner.id,
        roleId: companyRole.id,
        email: `${QA_PREFIX}.pm2@matrixcrm.local`,
        name: "QA PM Two",
        phone: "+919930000012",
        status: UserStatus.ACTIVE,
      }),
      ensureQaUser({
        servicePartnerId: companyPartner.id,
        roleId: companyRole.id,
        email: `${QA_PREFIX}.sm@matrixcrm.local`,
        name: "QA SM One",
        phone: "+919930000013",
        status: UserStatus.ACTIVE,
      }),
      ensureQaUser({
        servicePartnerId: companyPartner.id,
        roleId: companyRole.id,
        email: `${QA_PREFIX}.tech@matrixcrm.local`,
        name: "QA Technician",
        phone: "+919930000014",
        status: UserStatus.ACTIVE,
      }),
      ensureQaUser({
        servicePartnerId: companyPartner.id,
        roleId: companyRole.id,
        email: `${QA_PREFIX}.inactive@matrixcrm.local`,
        name: "QA Inactive User",
        phone: "+919930000015",
        status: UserStatus.INACTIVE,
      }),
      ensureQaUser({
        servicePartnerId: companyPartner.id,
        roleId: companyRole.id,
        email: `${QA_PREFIX}.read@matrixcrm.local`,
        name: "QA Read Only",
        phone: "+919930000016",
        status: UserStatus.ACTIVE,
      }),
      ensureQaUser({
        servicePartnerId: companyPartner.id,
        roleId: companyRole.id,
        email: `${QA_PREFIX}.notaskops@matrixcrm.local`,
        name: "QA No Task Ops",
        phone: "+919930000017",
        status: UserStatus.ACTIVE,
      }),
      ensureQaUser({
        servicePartnerId: foreignPartner.id,
        roleId: foreignRole.id,
        email: `${QA_PREFIX}.foreign@matrixcrm.local`,
        name: "QA Foreign User",
        phone: "+919930000018",
        status: UserStatus.ACTIVE,
      }),
    ]);

    await Promise.all([
      replaceDirectPermissions({
        userId: qaCompanyAdmin.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: [
          "service_requests.read",
          "service_requests.responsibility.read",
          "service_requests.responsibility.update",
          "tasks.read",
          "tasks.create",
          "tasks.update",
          "tasks.delete",
          "tasks.status.update",
        ],
      }),
      replaceDirectPermissions({
        userId: qaOperator.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["service_requests.read", "tasks.read"],
      }),
      replaceDirectPermissions({
        userId: readOnlyUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["service_requests.read", "service_requests.responsibility.read", "tasks.read"],
      }),
      replaceDirectPermissions({
        userId: noTaskOpsUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["service_requests.read", "tasks.read"],
      }),
      replaceDirectPermissions({
        userId: pmUserV1.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["tasks.read", "tasks.update", "service_requests.read"],
      }),
    ]);

    const qaCompanyAdminSession = toSession({
      id: qaCompanyAdmin.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyAdminRole.key],
      isSuperAdmin: false,
    });
    const readOnlySession = toSession({
      id: readOnlyUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyRole.key],
      isSuperAdmin: false,
    });
    const noTaskOpsSession = toSession({
      id: noTaskOpsUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyRole.key],
      isSuperAdmin: false,
    });

    const candidates = await listResponsibilityCandidates(qaCompanyAdminSession as never, companyPartner.id);
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    pushResult(results, "responsibility.candidates_same_tenant_only", !candidateIds.has(foreignUser.id));
    pushResult(results, "responsibility.candidates_active_only", !candidateIds.has(inactiveUser.id));

    await updateServiceRequestResponsibilities(qaCompanyAdminSession as never, companyData.serviceRequestId, {
      pmUserId: pmUserV1.id,
      smUserId: smUser.id,
      technicianUserId: technicianUser.id,
    });

    const firstSnapshot = await getServiceRequestResponsibilities(qaCompanyAdminSession as never, companyData.serviceRequestId);
    pushResult(
      results,
      "responsibility.create_update_pm_sm_technician",
      firstSnapshot?.snapshot.PM?.user.id === pmUserV1.id &&
        firstSnapshot?.snapshot.SM?.user.id === smUser.id &&
        firstSnapshot?.snapshot.TECHNICIAN?.user.id === technicianUser.id
    );

    await updateServiceRequestResponsibilities(qaCompanyAdminSession as never, companyData.serviceRequestId, {
      pmUserId: pmUserV2.id,
      smUserId: smUser.id,
      technicianUserId: technicianUser.id,
    });

    const pmAssignments = await prisma.assignment.findMany({
      where: {
        serviceRequestId: companyData.serviceRequestId,
        role: "PM",
      },
      orderBy: {
        assignedAt: "desc",
      },
      select: {
        id: true,
        userId: true,
        unassignedAt: true,
      },
    });
    const activePmAssignments = pmAssignments.filter((assignment) => assignment.unassignedAt === null);
    const closedOldPmAssignment = pmAssignments.some(
      (assignment) => assignment.userId === pmUserV1.id && assignment.unassignedAt !== null
    );
    pushResult(
      results,
      "responsibility.update_closes_old_assignment_with_unassignedAt",
      activePmAssignments.length === 1 && activePmAssignments[0]?.userId === pmUserV2.id && closedOldPmAssignment
    );

    const crossCompanyResponsibilityBlocked = await expectThrow(() =>
      updateServiceRequestResponsibilities(qaCompanyAdminSession as never, companyData.serviceRequestId, {
        pmUserId: foreignUser.id,
        smUserId: smUser.id,
        technicianUserId: technicianUser.id,
      })
    );
    pushResult(results, "responsibility.cross_company_user_blocked", crossCompanyResponsibilityBlocked);

    const inactiveResponsibilityBlocked = await expectThrow(() =>
      updateServiceRequestResponsibilities(qaCompanyAdminSession as never, companyData.serviceRequestId, {
        pmUserId: inactiveUser.id,
        smUserId: smUser.id,
        technicianUserId: technicianUser.id,
      })
    );
    pushResult(results, "responsibility.inactive_user_blocked", inactiveResponsibilityBlocked);

    const readOnlyCanReadResponsibility = await hasPermission(
      readOnlySession as never,
      "service_requests.responsibility.read"
    );
    const readOnlyCanUpdateResponsibility = await hasPermission(
      readOnlySession as never,
      "service_requests.responsibility.update"
    );
    const readOnlyViewData = await getServiceRequestResponsibilities(readOnlySession as never, companyData.serviceRequestId);
    pushResult(results, "responsibility.read_only_user_can_view", readOnlyCanReadResponsibility && Boolean(readOnlyViewData));
    pushResult(results, "responsibility.read_only_user_cannot_update", !readOnlyCanUpdateResponsibility);

    const companyCrossTenantResponsibilityBlocked = await expectThrow(() =>
      updateServiceRequestResponsibilities(qaCompanyAdminSession as never, foreignData.serviceRequestId, {
        pmUserId: pmUserV2.id,
        smUserId: smUser.id,
        technicianUserId: technicianUser.id,
      })
    );
    pushResult(results, "tenant.company_admin_cannot_update_foreign_service_request_responsibility", companyCrossTenantResponsibilityBlocked);

    await updateServiceRequestResponsibilities(superSession as never, companyData.serviceRequestId, {
      pmUserId: pmUserV2.id,
      smUserId: smUser.id,
      technicianUserId: technicianUser.id,
    });
    pushResult(results, "tenant.super_admin_can_update_responsibility_platform_wide", true);

    const superCrossTenantAssigneeBlocked = await expectThrow(() =>
      updateServiceRequestResponsibilities(superSession as never, companyData.serviceRequestId, {
        pmUserId: foreignUser.id,
        smUserId: smUser.id,
        technicianUserId: technicianUser.id,
      })
    );
    pushResult(results, "tenant.super_admin_mismatched_responsibility_user_blocked", superCrossTenantAssigneeBlocked);

    const createdTask = await createTask(qaCompanyAdminSession as never, {
      serviceRequestId: companyData.serviceRequestId,
      title: `${QA_PREFIX} work item A`,
      description: "QA create path",
      assigneeUserId: pmUserV2.id,
      status: TaskStatus.YET_TO_START,
      startDate: undefined,
      dueDate: undefined,
    });
    pushResult(
      results,
      "work_items.create_under_service_request",
      createdTask.serviceRequestId === companyData.serviceRequestId
    );
    pushResult(
      results,
      "work_items.service_partner_matches_service_request",
      createdTask.servicePartnerId === companyData.servicePartnerId
    );
    pushResult(results, "work_items.assignee_same_tenant_allowed", createdTask.assigneeUserId === pmUserV2.id);

    const crossCompanyTaskCreateBlocked = await expectThrow(() =>
      createTask(qaCompanyAdminSession as never, {
        serviceRequestId: companyData.serviceRequestId,
        title: `${QA_PREFIX} cross tenant create`,
        description: "cross tenant assignee",
        assigneeUserId: foreignUser.id,
        status: TaskStatus.YET_TO_START,
        startDate: undefined,
        dueDate: undefined,
      })
    );
    pushResult(results, "work_items.cross_company_assignee_blocked", crossCompanyTaskCreateBlocked);

    const inactiveTaskCreateBlocked = await expectThrow(() =>
      createTask(qaCompanyAdminSession as never, {
        serviceRequestId: companyData.serviceRequestId,
        title: `${QA_PREFIX} inactive assignee create`,
        description: "inactive assignee",
        assigneeUserId: inactiveUser.id,
        status: TaskStatus.YET_TO_START,
        startDate: undefined,
        dueDate: undefined,
      })
    );
    pushResult(results, "work_items.inactive_assignee_blocked", inactiveTaskCreateBlocked);

    const updatedTask = await updateTask(qaCompanyAdminSession as never, createdTask.id, {
      title: `${QA_PREFIX} work item A updated`,
      description: "QA update path",
      assigneeUserId: technicianUser.id,
      status: TaskStatus.IN_PROGRESS,
      startDate: undefined,
      dueDate: undefined,
    });
    pushResult(results, "work_items.update_works", updatedTask.title.endsWith("updated") && updatedTask.assigneeUserId === technicianUser.id);

    const crossCompanyTaskUpdateBlocked = await expectThrow(() =>
      updateTask(qaCompanyAdminSession as never, createdTask.id, {
        title: `${QA_PREFIX} blocked cross update`,
        description: "blocked",
        assigneeUserId: foreignUser.id,
        status: TaskStatus.IN_PROGRESS,
        startDate: undefined,
        dueDate: undefined,
      })
    );
    pushResult(results, "work_items.cross_company_assignee_update_blocked", crossCompanyTaskUpdateBlocked);

    const inactiveTaskUpdateBlocked = await expectThrow(() =>
      updateTask(qaCompanyAdminSession as never, createdTask.id, {
        title: `${QA_PREFIX} blocked inactive update`,
        description: "blocked",
        assigneeUserId: inactiveUser.id,
        status: TaskStatus.IN_PROGRESS,
        startDate: undefined,
        dueDate: undefined,
      })
    );
    pushResult(results, "work_items.inactive_assignee_update_blocked", inactiveTaskUpdateBlocked);

    const completedTask = await updateTaskStatus(qaCompanyAdminSession as never, createdTask.id, {
      status: TaskStatus.COMPLETED,
    });
    pushResult(results, "work_items.status_update_works", completedTask.status === TaskStatus.COMPLETED);
    pushResult(results, "work_items.completed_status_sets_completedAt", Boolean(completedTask.completedAt));

    const reopenedTask = await updateTaskStatus(qaCompanyAdminSession as never, createdTask.id, {
      status: TaskStatus.REOPENED,
    });
    pushResult(results, "work_items.non_completed_status_clears_completedAt", reopenedTask.completedAt === null);

    const secondTask = await createTask(qaCompanyAdminSession as never, {
      serviceRequestId: companyData.serviceRequestId,
      title: `${QA_PREFIX} work item B`,
      description: "QA soft delete path",
      assigneeUserId: technicianUser.id,
      status: TaskStatus.YET_TO_START,
      startDate: undefined,
      dueDate: undefined,
    });
    await softDeleteTask(qaCompanyAdminSession as never, secondTask.id);
    const listedAfterDelete = await listTasksForServiceRequest(qaCompanyAdminSession as never, companyData.serviceRequestId);
    const listedIds = new Set(listedAfterDelete.tasks.map((task) => task.id));
    pushResult(results, "work_items.soft_delete_excluded_from_list", !listedIds.has(secondTask.id) && listedIds.has(createdTask.id));

    const noTaskOpsCanCreate = await hasPermission(noTaskOpsSession as never, "tasks.create");
    const noTaskOpsCanUpdate = await hasPermission(noTaskOpsSession as never, "tasks.update");
    const noTaskOpsCanStatusUpdate = await hasPermission(noTaskOpsSession as never, "tasks.status.update");
    const noTaskOpsCanDelete = await hasPermission(noTaskOpsSession as never, "tasks.delete");
    pushResult(results, "permissions.user_without_tasks_create_cannot_create", !noTaskOpsCanCreate);
    pushResult(results, "permissions.user_without_tasks_update_cannot_update", !noTaskOpsCanUpdate);
    pushResult(results, "permissions.user_without_tasks_status_update_cannot_update_status", !noTaskOpsCanStatusUpdate);
    pushResult(results, "permissions.user_without_tasks_delete_cannot_delete", !noTaskOpsCanDelete);

    const responsibilityActionSource = readFileSync(
      "features/service-requests/actions/service-request-responsibility.actions.ts",
      "utf8"
    );
    const taskActionSource = readFileSync("features/tasks/actions/task.actions.ts", "utf8");
    pushResult(
      results,
      "permissions.responsibility_action_has_server_guard",
      responsibilityActionSource.includes('requirePermission("service_requests.responsibility.update")')
    );
    pushResult(
      results,
      "permissions.task_action_has_create_guard",
      taskActionSource.includes('requirePermission("tasks.create")')
    );
    pushResult(
      results,
      "permissions.task_action_has_update_guard",
      taskActionSource.includes('requirePermission("tasks.update")')
    );
    pushResult(
      results,
      "permissions.task_action_has_status_guard",
      taskActionSource.includes('requirePermission("tasks.status.update")')
    );
    pushResult(
      results,
      "permissions.task_action_has_delete_guard",
      taskActionSource.includes('requirePermission("tasks.delete")')
    );

    const companyCrossTenantTaskBlocked = await expectThrow(() =>
      createTask(qaCompanyAdminSession as never, {
        serviceRequestId: foreignData.serviceRequestId,
        title: `${QA_PREFIX} company cross tenant`,
        description: "blocked by tenant scope",
        assigneeUserId: foreignUser.id,
        status: TaskStatus.YET_TO_START,
        startDate: undefined,
        dueDate: undefined,
      })
    );
    pushResult(results, "tenant.company_admin_cannot_access_foreign_service_request_tasks", companyCrossTenantTaskBlocked);

    const superValidTask = await createTask(superSession as never, {
      serviceRequestId: foreignData.serviceRequestId,
      title: `${QA_PREFIX} super foreign valid`,
      description: "super tenant-wide valid create",
      assigneeUserId: foreignUser.id,
      status: TaskStatus.YET_TO_START,
      startDate: undefined,
      dueDate: undefined,
    });
    pushResult(
      results,
      "tenant.super_admin_can_operate_platform_wide",
      superValidTask.serviceRequestId === foreignData.serviceRequestId
    );

    const superInvalidTaskAssigneeBlocked = await expectThrow(() =>
      createTask(superSession as never, {
        serviceRequestId: companyData.serviceRequestId,
        title: `${QA_PREFIX} super invalid tenant assignee`,
        description: "blocked mismatch",
        assigneeUserId: foreignUser.id,
        status: TaskStatus.YET_TO_START,
        startDate: undefined,
        dueDate: undefined,
      })
    );
    pushResult(results, "tenant.super_admin_mismatched_task_assignee_blocked", superInvalidTaskAssigneeBlocked);

    const srBeforeStatusUpdate = await getServiceRequestById(qaCompanyAdminSession as never, companyData.serviceRequestId);
    if (!srBeforeStatusUpdate) {
      throw new Error("QA service request missing before status update check.");
    }
    const historyBefore = srBeforeStatusUpdate.statusHistory.length;
    const nextStatus =
      srBeforeStatusUpdate.status === ServiceRequestStatus.IN_PROGRESS
        ? ServiceRequestStatus.BLOCKED
        : ServiceRequestStatus.IN_PROGRESS;
    await updateServiceRequestStatus(qaCompanyAdminSession as never, companyData.serviceRequestId, {
      status: nextStatus,
      remarks: "QA regression status update",
    });

    const srAfterStatusUpdate = await getServiceRequestById(qaCompanyAdminSession as never, companyData.serviceRequestId);
    const historyAfter = srAfterStatusUpdate?.statusHistory.length ?? 0;
    pushResult(results, "integration.service_request_status_history_still_works", historyAfter > historyBefore);

    const detailServiceRequest = await getServiceRequestById(qaCompanyAdminSession as never, companyData.serviceRequestId);
    const detailResponsibilities = await getServiceRequestResponsibilities(
      qaCompanyAdminSession as never,
      companyData.serviceRequestId
    );
    const detailTasks = await listTasksForServiceRequest(qaCompanyAdminSession as never, companyData.serviceRequestId);
    pushResult(results, "integration.service_request_detail_fetch_includes_responsibility", Boolean(detailResponsibilities));
    pushResult(results, "integration.service_request_detail_fetch_includes_work_items", detailTasks.tasks.length >= 1);
    pushResult(results, "integration.service_request_detail_fetch_includes_timeline", Boolean(detailServiceRequest));

    const qaCompanyAdminPermissionKeys = await getUserPermissions(qaCompanyAdmin.id, [companyAdminRole.key]);
    pushResult(
      results,
      "permissions.company_admin_has_required_work_item_and_responsibility_permissions",
      ["service_requests.responsibility.update", "tasks.create", "tasks.update", "tasks.status.update"].every((key) =>
        qaCompanyAdminPermissionKeys.includes(key)
      )
    );

    const hasTasksPage = existsSync("app/(dashboard)/tasks/page.tsx");
    const companyAdminNav = await getNavigationForSession(qaCompanyAdminSession as never);
    const companyAdminNavKeys = flattenNavKeys(companyAdminNav);
    pushResult(
      results,
      "regression.no_tasks_nav_when_no_tasks_page",
      hasTasksPage ? true : !companyAdminNavKeys.includes("tasks")
    );
  } finally {
    await cleanupQaRecords({
      companyServiceRequestId,
      foreignServiceRequestId,
    });
  }

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
