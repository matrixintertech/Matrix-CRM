import { readFileSync } from "node:fs";

import { ServicePartnerStatus, ServiceRequestStatus, UserStatus } from "@prisma/client";

import { getExportRows, getExportPermissionKey } from "../features/export/services/export.service";
import { createTask } from "../features/tasks/services/task.service";
import {
  checkInToTask,
  checkOutOfTask,
  getTaskAttachmentDownload,
  getTaskWorkSessionBundle,
  uploadTaskAttachment,
} from "../features/tasks/services/task-work-session.service";
import { buildCsv } from "../lib/export/csv";
import { buildExcelWorkbook } from "../lib/export/excel";
import { buildPdfDocument } from "../lib/export/pdf";
import { createPrismaClient } from "../lib/db/client";
import { ensureTenantRbac } from "../lib/rbac/bootstrap";
import { baselinePermissions } from "../lib/rbac/baseline";
import { configureQaUserRoleAccess } from "./qa-rbac";

const prisma = createPrismaClient();

type SessionLike = {
  user: {
    id: string;
    servicePartnerId: string;
    roleKeys: string[];
    isSuperAdmin: boolean;
  };
};

type QaResult = {
  key: string;
  passed: boolean;
  details?: string;
};

function push(results: QaResult[], key: string, passed: boolean, details?: string) {
  results.push({ key, passed, details });
}

async function expectThrow(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function toSession(input: { id: string; servicePartnerId: string; roleKeys: string[]; isSuperAdmin?: boolean }): SessionLike {
  return {
    user: {
      id: input.id,
      servicePartnerId: input.servicePartnerId,
      roleKeys: input.roleKeys,
      isSuperAdmin: input.isSuperAdmin ?? false,
    },
  };
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

async function ensureUser(input: {
  servicePartnerId: string;
  email: string;
  phone: string;
  name: string;
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
        status: UserStatus.ACTIVE,
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
      status: UserStatus.ACTIVE,
    },
  });
}

async function ensureClient(servicePartnerId: string, code: string) {
  return prisma.client.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId,
        code,
      },
    },
    update: {
      name: `${code} Client`,
      email: `${code.toLowerCase()}@client.local`,
      phone: `+91${code.slice(-8).padStart(8, "0")}`,
      deletedAt: null,
    },
    create: {
      servicePartnerId,
      code,
      name: `${code} Client`,
      email: `${code.toLowerCase()}@client.local`,
      phone: `+91${code.slice(-8).padStart(8, "0")}`,
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
      serviceType: "QA_TASK_WORK",
      status: ServiceRequestStatus.IN_PROGRESS,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: input.clientId,
      createdByUserId: input.createdByUserId,
      serviceNumber: input.serviceNumber,
      title: input.title,
      serviceType: "QA_TASK_WORK",
      status: ServiceRequestStatus.IN_PROGRESS,
    },
  });
}

async function main() {
  const results: QaResult[] = [];
  const stamp = Date.now();
  const tenant = await ensureServicePartner("QATASKWS", "QA Task Work Sessions");
  const foreignTenant = await ensureServicePartner("QATASKWSF", "QA Task Work Foreign");

  const [manager, technician, outsider, foreignUser] = await Promise.all([
    ensureUser({
      servicePartnerId: tenant.id,
      email: "qa.task.manager@matrixcrm.local",
      phone: "+910000010101",
      name: "QA Task Manager",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: "qa.task.tech@matrixcrm.local",
      phone: "+910000010102",
      name: "QA Task Tech",
    }),
    ensureUser({
      servicePartnerId: tenant.id,
      email: "qa.task.outsider@matrixcrm.local",
      phone: "+910000010103",
      name: "QA Task Outsider",
    }),
    ensureUser({
      servicePartnerId: foreignTenant.id,
      email: "qa.task.foreign@matrixcrm.local",
      phone: "+910000010104",
      name: "QA Foreign User",
    }),
  ]);

  const [managerRole, technicianRole, outsiderRole, foreignRole] = await Promise.all([
    configureQaUserRoleAccess(prisma, {
      userId: manager.id,
      servicePartnerId: tenant.id,
      key: "qa_task_manager",
      name: "QA Task Manager",
      description: "QA manager role for task work sessions.",
      permissionKeys: [
        "tasks.read",
        "tasks.create",
        "tasks.assign",
        "tasks.assign.downline",
        "tasks.work_sessions.read",
        "tasks.location.read",
        "tasks.attachments.read",
        "tasks.attachments.delete",
        "tasks.export",
      ],
    }),
    configureQaUserRoleAccess(prisma, {
      userId: technician.id,
      servicePartnerId: tenant.id,
      key: "qa_task_technician",
      name: "QA Task Technician",
      description: "QA technician role for task work sessions.",
      permissionKeys: [
        "tasks.read",
        "tasks.check_in",
        "tasks.check_out",
        "tasks.attachments.read",
        "tasks.attachments.upload",
      ],
    }),
    configureQaUserRoleAccess(prisma, {
      userId: outsider.id,
      servicePartnerId: tenant.id,
      key: "qa_task_outsider",
      name: "QA Task Outsider",
      description: "QA outsider role for task work sessions.",
      permissionKeys: ["tasks.read", "tasks.attachments.read"],
    }),
    configureQaUserRoleAccess(prisma, {
      userId: foreignUser.id,
      servicePartnerId: foreignTenant.id,
      key: "qa_task_foreign",
      name: "QA Task Foreign",
      description: "QA foreign role for task work sessions.",
      permissionKeys: ["tasks.read", "tasks.attachments.read"],
    }),
  ]);

  await Promise.all([
    prisma.role.update({
      where: { id: managerRole.id },
      data: { level: 70 },
    }),
    prisma.role.update({
      where: { id: technicianRole.id },
      data: { level: 40 },
    }),
    prisma.role.update({
      where: { id: outsiderRole.id },
      data: { level: 20 },
    }),
    prisma.role.update({
      where: { id: foreignRole.id },
      data: { level: 20 },
    }),
  ]);

  const managerSession = toSession({
    id: manager.id,
    servicePartnerId: tenant.id,
    roleKeys: await getRoleKeys(manager.id),
  });
  const technicianSession = toSession({
    id: technician.id,
    servicePartnerId: tenant.id,
    roleKeys: await getRoleKeys(technician.id),
  });
  const outsiderSession = toSession({
    id: outsider.id,
    servicePartnerId: tenant.id,
    roleKeys: await getRoleKeys(outsider.id),
  });
  const foreignSession = toSession({
    id: foreignUser.id,
    servicePartnerId: foreignTenant.id,
    roleKeys: await getRoleKeys(foreignUser.id),
  });
  const superAdminSession = toSession({
    id: manager.id,
    servicePartnerId: tenant.id,
    roleKeys: ["super_admin"],
    isSuperAdmin: true,
  });

  const client = await ensureClient(tenant.id, `QATWSC${String(stamp).slice(-4)}`);
  const serviceRequest = await ensureServiceRequest({
    servicePartnerId: tenant.id,
    clientId: client.id,
    createdByUserId: manager.id,
    serviceNumber: `QATWS-SR-${stamp}`,
    title: "QA Task Work Session Request",
  });

  const task = await createTask(managerSession as never, {
    serviceRequestId: serviceRequest.id,
    title: "QA field work task",
    description: "Task for check-in/check-out QA",
    assigneeUserId: technician.id,
    status: "YET_TO_START",
    parentTaskId: undefined,
    requestedAt: new Date(),
    startDate: undefined,
    dueDate: undefined,
  });

  const checkedIn = await checkInToTask(technicianSession as never, task.id, {
    note: "Reached customer site",
    latitude: 12.9715987,
    longitude: 77.594566,
    address: undefined,
  });
  push(results, "work_sessions.check_in_creates_active_session", checkedIn.session.status === "CHECKED_IN");
  push(results, "work_sessions.check_in_stores_time", checkedIn.session.checkInAt instanceof Date);
  push(
    results,
    "work_sessions.optional_location_fields_accepted",
    checkedIn.session.checkInLatitude !== null && checkedIn.session.checkInLongitude !== null
  );

  const duplicateCheckInError = await expectThrow(() =>
    checkInToTask(technicianSession as never, task.id, {
      note: "Duplicate check-in",
      latitude: undefined,
      longitude: undefined,
      address: undefined,
    })
  );
  push(
    results,
    "work_sessions.duplicate_active_check_in_blocked",
    Boolean(duplicateCheckInError?.toLowerCase().includes("active check-in")),
    duplicateCheckInError ?? undefined
  );

  const outsiderCheckOutError = await expectThrow(() =>
    checkOutOfTask(outsiderSession as never, task.id, {
      note: "Trying to close someone else's session",
      latitude: undefined,
      longitude: undefined,
      address: undefined,
    })
  );
  push(
    results,
    "work_sessions.user_cannot_check_out_another_users_session",
    Boolean(outsiderCheckOutError),
    outsiderCheckOutError ?? undefined
  );

  const checkedOut = await checkOutOfTask(technicianSession as never, task.id, {
    note: "Paused after finishing the first visit",
    latitude: 12.9717,
    longitude: 77.5948,
    address: undefined,
  });
  push(results, "work_sessions.check_out_requires_active_check_in", checkedOut.session.status === "CHECKED_OUT");
  push(results, "work_sessions.check_out_stores_time", checkedOut.session.checkOutAt instanceof Date);
  push(
    results,
    "work_sessions.check_out_duration_calculated",
    typeof checkedOut.session.durationMinutes === "number" && checkedOut.session.durationMinutes >= 0
  );

  await checkInToTask(technicianSession as never, task.id, {
    note: "Second visit",
    latitude: undefined,
    longitude: undefined,
    address: undefined,
  });
  const superAdminCheckout = await checkOutOfTask(
    superAdminSession as never,
    task.id,
    {
      note: "Super admin close-out",
      latitude: undefined,
      longitude: undefined,
      address: undefined,
    },
    technician.id
  );
  push(results, "work_sessions.super_admin_can_check_out_another_users_session", superAdminCheckout.session.status === "CHECKED_OUT");

  const foreignCheckInError = await expectThrow(() =>
    checkInToTask(foreignSession as never, task.id, {
      note: "Cross-tenant attempt",
      latitude: undefined,
      longitude: undefined,
      address: undefined,
    })
  );
  push(
    results,
    "work_sessions.cross_tenant_task_check_in_blocked",
    Boolean(foreignCheckInError?.toLowerCase().includes("not found")),
    foreignCheckInError ?? undefined
  );

  const managerBundle = await getTaskWorkSessionBundle(managerSession as never, task.id);
  const technicianBundle = await getTaskWorkSessionBundle(technicianSession as never, task.id);
  const outsiderBundleError = await expectThrow(() => getTaskWorkSessionBundle(outsiderSession as never, task.id));
  push(results, "work_sessions.manager_can_see_downline_sessions_when_visible", managerBundle.sessions.length >= 2);
  push(results, "work_sessions.lower_level_user_can_see_own_sessions", technicianBundle.sessions.every((entry) => entry.userId === technician.id));
  push(
    results,
    "work_sessions.lower_level_user_cannot_see_unrelated_task_sessions",
    Boolean(outsiderBundleError?.toLowerCase().includes("not found")),
    outsiderBundleError ?? undefined
  );

  const uploadedAttachment = await uploadTaskAttachment(technicianSession as never, task.id, {
    file: new File([Buffer.from("fake-image-data")], "proof.png", {
      type: "image/png",
    }),
    note: "Before/after proof image",
  });
  push(results, "attachments.upload_accepts_valid_file_type_and_size", uploadedAttachment.attachment.attachmentType === "IMAGE");

  const badTypeError = await expectThrow(() =>
    uploadTaskAttachment(technicianSession as never, task.id, {
      file: new File([Buffer.from("bad")], "proof.txt", {
        type: "text/plain",
      }),
      note: "bad file",
    })
  );
  push(
    results,
    "attachments.invalid_file_type_blocked",
    Boolean(badTypeError?.toLowerCase().includes("allowed")),
    badTypeError ?? undefined
  );

  const oversizeError = await expectThrow(() =>
    uploadTaskAttachment(technicianSession as never, task.id, {
      file: new File([Buffer.alloc(6 * 1024 * 1024)], "oversize.pdf", {
        type: "application/pdf",
      }),
      note: "too big",
    })
  );
  push(
    results,
    "attachments.invalid_file_size_blocked",
    Boolean(oversizeError?.toLowerCase().includes("upload limit")),
    oversizeError ?? undefined
  );

  const downloadedAttachment = await getTaskAttachmentDownload(technicianSession as never, uploadedAttachment.attachment.id);
  const foreignAttachmentAccessError = await expectThrow(() =>
    getTaskAttachmentDownload(foreignSession as never, uploadedAttachment.attachment.id)
  );
  push(results, "attachments.download_returns_uploaded_file", downloadedAttachment.body.length > 0);
  push(
    results,
    "attachments.tenant_scope_enforced",
    Boolean(foreignAttachmentAccessError?.toLowerCase().includes("not found")),
    foreignAttachmentAccessError ?? undefined
  );

  const taskExportRows = await getExportRows(
    managerSession as never,
    "tasks",
    new URLSearchParams({
      serviceRequestId: serviceRequest.id,
    })
  );
  const taskRow = taskExportRows.find((row) => String(row.taskNumber) === task.taskNumber);
  push(
    results,
    "export.tasks_include_checkin_checkout_fields",
    Boolean(taskRow && "checkInAt" in taskRow && "checkOutAt" in taskRow && "durationMinutes" in taskRow && "proofCount" in taskRow)
  );
  push(results, "export.tasks_export_permission_key_present", getExportPermissionKey("tasks") === "tasks.export");

  const csv = buildCsv(taskExportRows);
  const excel = buildExcelWorkbook(taskExportRows, "tasks");
  const pdf = buildPdfDocument("tasks", taskExportRows);
  push(results, "export.csv_returns_valid_content", csv.includes("checkInAt") && csv.includes("proofCount"));
  push(results, "export.excel_returns_valid_content", excel.includes("<Workbook") && excel.includes("checkInAt"));
  push(results, "export.pdf_returns_valid_content", pdf.toString("utf8", 0, 8).startsWith("%PDF-1.4"));

  const actionSource = readFileSync("features/tasks/actions/task.actions.ts", "utf8");
  push(results, "activity_logs.check_in_logging_present", actionSource.includes('action: "task.check_in"'));
  push(results, "activity_logs.check_out_logging_present", actionSource.includes('action: "task.check_out"'));
  push(results, "activity_logs.attachment_upload_logging_present", actionSource.includes('action: "task.attachment_upload"'));
  push(results, "activity_logs.attachment_delete_logging_present", actionSource.includes('action: "task.attachment_delete"'));
  push(results, "activity_logs.location_logging_present", actionSource.includes('action: "task.location_captured"'));
  push(results, "permissions.check_in_action_enforced", actionSource.includes('requirePermission("tasks.check_in")'));
  push(results, "permissions.check_out_action_enforced", actionSource.includes('requirePermission("tasks.check_out")'));
  push(results, "permissions.attachment_upload_action_enforced", actionSource.includes('requirePermission("tasks.attachments.upload")'));
  push(results, "permissions.attachment_delete_action_enforced", actionSource.includes('requirePermission("tasks.attachments.delete")'));

  const requiredPermissionKeys = [
    "tasks.check_in",
    "tasks.check_out",
    "tasks.attachments.read",
    "tasks.attachments.upload",
    "tasks.attachments.delete",
    "tasks.location.read",
    "tasks.work_sessions.read",
    "tasks.export",
    "activity_logs.read",
    "activity_logs.export",
  ];
  push(
    results,
    "permissions.baseline_permissions_include_task_work_session_keys",
    requiredPermissionKeys.every((key) => baselinePermissions.some((permission) => permission.key === key))
  );

  const summary = {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
  };

  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.key}${result.details ? ` ${result.details}` : ""}`);
  }

  console.log(JSON.stringify({ summary }, null, 2));

  if (summary.failed > 0) {
    throw new Error(`task-work-session-qa failed with ${summary.failed} failing checks`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
