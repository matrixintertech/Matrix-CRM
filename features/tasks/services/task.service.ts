import { Prisma, TaskStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type {
  CreateTaskInput,
  CreateTaskRemarkInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from "@/features/tasks/validations";
import { getUserPermissions } from "@/lib/auth/permissions";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

const COMPANY_ADMIN_LEVEL = 90;

type TaskScopeFilter = "all" | "my" | "delegated" | "downline" | "company";

type ListTasksInput = {
  q?: string;
  status?: TaskStatus;
  assigneeUserId?: string;
  assignedByUserId?: string;
  serviceRequestId?: string;
  scope?: TaskScopeFilter;
  requestedFrom?: Date;
  requestedTo?: Date;
  dueFrom?: Date;
  dueTo?: Date;
  overdue?: boolean;
};

type TaskUserRecord = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: {
    role: {
      key: string;
      name: string;
      level: number;
    };
  }[];
};

type TaskVisibilitySnapshot = {
  directIds: Set<string>;
  descendantIds: Set<string>;
  responsibilityServiceRequestIds: Set<string>;
  visibleIds: Set<string>;
};

type TaskAccessContext = {
  permissions: Set<string>;
  userId: string;
  servicePartnerId: string;
  maxRoleLevel: number;
  isSuperAdmin: boolean;
  isCompanyWide: boolean;
  canAssign: boolean;
  canAssignAny: boolean;
  canAssignDownline: boolean;
  canDelegate: boolean;
  canHistoryRead: boolean;
  canRemarkCreate: boolean;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canStatusUpdate: boolean;
};

type TaskChainNode = {
  id: string;
  parentTaskId: string | null;
  taskNumber: string;
  title: string;
  assignee: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  assignedBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  createdBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

type LoadedTask = Prisma.TaskGetPayload<{
  include: {
    serviceRequest: {
      select: {
        id: true;
        serviceNumber: true;
        title: true;
        servicePartnerId: true;
      };
    };
    parentTask: {
      select: {
        id: true;
        taskNumber: true;
        title: true;
        parentTaskId: true;
        assignee: {
          select: {
            id: true;
            name: true;
            email: true;
            phone: true;
          };
        };
        assignedBy: {
          select: {
            id: true;
            name: true;
            email: true;
            phone: true;
          };
        };
        createdBy: {
          select: {
            id: true;
            name: true;
            email: true;
            phone: true;
          };
        };
      };
    };
    childTasks: {
      select: {
        id: true;
        taskNumber: true;
        title: true;
        status: true;
        parentTaskId: true;
        assignee: {
          select: {
            id: true;
            name: true;
            email: true;
            phone: true;
          };
        };
        assignedBy: {
          select: {
            id: true;
            name: true;
            email: true;
            phone: true;
          };
        };
      };
    };
    assignee: {
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
      };
    };
    createdBy: {
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
      };
    };
    assignedBy: {
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
      };
    };
  };
}>;

export type TaskHistoryEntry = {
  id: string;
  action: string;
  message: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  actor: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function toYyyyMmDd(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function getUserRoleLabel(roles: TaskUserRecord["roles"]) {
  const role = roles[0]?.role;
  if (!role) {
    return "User";
  }
  return `${role.name} (${role.key})`;
}

function getHighestRoleLevel(roles: TaskUserRecord["roles"]) {
  return roles.reduce((highest, entry) => Math.max(highest, entry.role.level), 0);
}

function userDisplayName(user: { name: string | null; email: string | null; phone: string | null } | null | undefined) {
  return user?.name?.trim() || user?.email || user?.phone || "Unknown user";
}

function isDirectlyInvolved(task: {
  assigneeUserId?: string | null;
  createdByUserId?: string | null;
  assignedByUserId?: string | null;
}, userId: string) {
  return task.assigneeUserId === userId || task.createdByUserId === userId || task.assignedByUserId === userId;
}

function getTaskSummaryInclude() {
  return {
    serviceRequest: {
      select: {
        id: true,
        serviceNumber: true,
        title: true,
        servicePartnerId: true,
      },
    },
    parentTask: {
      select: {
        id: true,
        taskNumber: true,
        title: true,
        parentTaskId: true,
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    },
    childTasks: {
      where: {
        deletedAt: null,
      },
      orderBy: [{ updatedAt: "desc" as const }],
      select: {
        id: true,
        taskNumber: true,
        title: true,
        status: true,
        parentTaskId: true,
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    },
    assignee: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    },
    createdBy: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    },
    assignedBy: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    },
  };
}

async function generateTaskNumber(servicePartnerId: string) {
  const servicePartner = await prisma.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `TSK-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await prisma.task.findFirst({
      where: {
        servicePartnerId,
        taskNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique task number.");
}

async function getServiceRequestForTaskScope(session: Session, serviceRequestId: string) {
  return prisma.serviceRequest.findFirst({
    where: {
      id: serviceRequestId,
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    select: {
      id: true,
      servicePartnerId: true,
      serviceNumber: true,
      title: true,
    },
  });
}

async function getTaskRecordById(taskId: string, session: Session) {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    include: getTaskSummaryInclude(),
  });
}

async function getTaskAccessContext(session: Session): Promise<TaskAccessContext> {
  const permissions = new Set(await getUserPermissions(session.user.id, session.user.roleKeys));
  const roleLevels = await prisma.userRole.findMany({
    where: {
      userId: session.user.id,
      role: {
        deletedAt: null,
      },
    },
    select: {
      role: {
        select: {
          level: true,
        },
      },
    },
  });
  const maxRoleLevel = session.user.isSuperAdmin
    ? Number.MAX_SAFE_INTEGER
    : roleLevels.reduce((highest, entry) => Math.max(highest, entry.role.level), 0);

  return {
    permissions,
    userId: session.user.id,
    servicePartnerId: session.user.servicePartnerId,
    maxRoleLevel,
    isSuperAdmin: session.user.isSuperAdmin,
    isCompanyWide: session.user.isSuperAdmin || maxRoleLevel >= COMPANY_ADMIN_LEVEL,
    canAssign: permissions.has("tasks.assign"),
    canAssignAny: permissions.has("tasks.assign.any"),
    canAssignDownline: permissions.has("tasks.assign.downline"),
    canDelegate: permissions.has("tasks.delegate"),
    canHistoryRead: permissions.has("tasks.history.read"),
    canRemarkCreate: permissions.has("tasks.remark.create"),
    canRead: permissions.has("tasks.read"),
    canCreate: permissions.has("tasks.create"),
    canUpdate: permissions.has("tasks.update"),
    canDelete: permissions.has("tasks.delete"),
    canStatusUpdate: permissions.has("tasks.status.update"),
  };
}

async function getResponsibilityServiceRequestIds(userId: string, servicePartnerId: string) {
  const rows = await prisma.assignment.findMany({
    where: {
      userId,
      servicePartnerId,
      unassignedAt: null,
    },
    select: {
      serviceRequestId: true,
    },
  });

  return new Set(rows.map((row) => row.serviceRequestId));
}

async function getDescendantTaskIds(servicePartnerId: string, rootIds: Iterable<string>) {
  const discovered = new Set<string>();
  let frontier = Array.from(new Set(Array.from(rootIds).filter(Boolean)));

  while (frontier.length > 0) {
    const children = await prisma.task.findMany({
      where: {
        servicePartnerId,
        deletedAt: null,
        parentTaskId: {
          in: frontier,
        },
      },
      select: {
        id: true,
      },
    });

    frontier = [];
    for (const child of children) {
      if (discovered.has(child.id)) {
        continue;
      }
      discovered.add(child.id);
      frontier.push(child.id);
    }
  }

  return discovered;
}

async function getTaskVisibilitySnapshot(session: Session, context: TaskAccessContext): Promise<TaskVisibilitySnapshot | null> {
  if (context.isSuperAdmin || context.isCompanyWide) {
    return null;
  }

  const [responsibilityServiceRequestIds, directTasks] = await Promise.all([
    getResponsibilityServiceRequestIds(context.userId, context.servicePartnerId),
    prisma.task.findMany({
      where: {
        servicePartnerId: context.servicePartnerId,
        deletedAt: null,
        OR: [
          { assigneeUserId: context.userId },
          { createdByUserId: context.userId },
          { assignedByUserId: context.userId },
        ],
      },
      select: {
        id: true,
      },
    }),
  ]);

  const directIds = new Set(directTasks.map((task) => task.id));
  const descendantIds = await getDescendantTaskIds(context.servicePartnerId, directIds);
  const visibleIds = new Set<string>([...directIds, ...descendantIds]);

  if (responsibilityServiceRequestIds.size > 0) {
    const responsibilityTasks = await prisma.task.findMany({
      where: {
        servicePartnerId: context.servicePartnerId,
        deletedAt: null,
        serviceRequestId: {
          in: Array.from(responsibilityServiceRequestIds),
        },
      },
      select: {
        id: true,
      },
    });

    for (const task of responsibilityTasks) {
      visibleIds.add(task.id);
    }
  }

  return {
    directIds,
    descendantIds,
    responsibilityServiceRequestIds,
    visibleIds,
  };
}

async function loadAncestors(servicePartnerId: string, task: { parentTaskId: string | null }) {
  const nodes: TaskChainNode[] = [];
  let currentParentId = task.parentTaskId;

  while (currentParentId) {
    const parent = await prisma.task.findFirst({
      where: {
        id: currentParentId,
        servicePartnerId,
        deletedAt: null,
      },
      select: {
        id: true,
        parentTaskId: true,
        taskNumber: true,
        title: true,
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        assignedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!parent) {
      break;
    }

    nodes.push(parent);
    currentParentId = parent.parentTaskId;
  }

  return nodes;
}

function buildAssignmentChain(nodes: TaskChainNode[]) {
  return nodes.map((node) => {
    const assigner = userDisplayName(node.assignedBy ?? node.createdBy);
    const assignee = node.assignee ? userDisplayName(node.assignee) : "Unassigned";
    return `${node.taskNumber}: ${assigner} -> ${assignee}`;
  });
}

async function decorateTasks(tasks: LoadedTask[]) {
  const ancestorCache = new Map<string, TaskChainNode[]>();

  return Promise.all(
    tasks.map(async (task) => {
      let ancestors = ancestorCache.get(task.id);
      if (!ancestors) {
        ancestors = await loadAncestors(task.servicePartnerId, task);
        ancestorCache.set(task.id, ancestors);
      }

      const hierarchyDepth = ancestors.length;
      const assignmentChain = buildAssignmentChain(
        [...ancestors].reverse().concat([
          {
            id: task.id,
            parentTaskId: task.parentTaskId,
            taskNumber: task.taskNumber,
            title: task.title,
            assignee: task.assignee,
            assignedBy: task.assignedBy,
            createdBy: task.createdBy,
          },
        ])
      );

      let latestChildStatus: TaskStatus | null = null;
      if (task.childTasks.length > 0) {
        latestChildStatus = task.childTasks[0]?.status ?? null;
      }

      return {
        ...task,
        hierarchyDepth,
        assignmentChain,
        childTaskCount: task.childTasks.length,
        latestChildStatus,
        isSubTask: task.parentTaskId !== null,
        parentTaskSummary: task.parentTask
          ? {
              id: task.parentTask.id,
              taskNumber: task.parentTask.taskNumber,
              title: task.parentTask.title,
            }
          : null,
        serviceRequestSummary: {
          id: task.serviceRequest.id,
          serviceNumber: task.serviceRequest.serviceNumber,
          title: task.serviceRequest.title,
        },
      };
    })
  );
}

async function canViewTaskRecord(task: LoadedTask, context: TaskAccessContext, snapshot?: TaskVisibilitySnapshot | null) {
  if (context.isSuperAdmin || context.isCompanyWide) {
    return true;
  }

  if (snapshot?.visibleIds.has(task.id)) {
    return true;
  }

  const ancestors = await loadAncestors(task.servicePartnerId, task);
  return ancestors.some((ancestor) => {
    const createdByUserId = ancestor.createdBy?.id ?? null;
    const assigneeUserId = ancestor.assignee?.id ?? null;
    const assignedByUserId = ancestor.assignedBy?.id ?? null;
    return [createdByUserId, assigneeUserId, assignedByUserId].includes(context.userId);
  });
}

async function assertTaskVisible(session: Session, context: TaskAccessContext, taskId: string) {
  const task = await getTaskRecordById(taskId, session);
  if (!task) {
    throw new Error("Task not found.");
  }

  const snapshot = await getTaskVisibilitySnapshot(session, context);
  const allowed = await canViewTaskRecord(task, context, snapshot);
  if (!allowed) {
    throw new Error("Task not found.");
  }

  return task;
}

async function assertAssignableUser(
  context: TaskAccessContext,
  servicePartnerId: string,
  assigneeUserId?: string | null
) {
  if (!assigneeUserId) {
    return null;
  }

  const assignee = await prisma.user.findFirst({
    where: {
      id: assigneeUserId,
      servicePartnerId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      name: true,
      email: true,
      phone: true,
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        select: {
          role: {
            select: {
              key: true,
              name: true,
              level: true,
            },
          },
        },
      },
    },
  });

  if (!assignee) {
    throw new Error("Task assignee is invalid for this tenant.");
  }

  if (context.isSuperAdmin || context.canAssignAny || context.isCompanyWide) {
    return assignee;
  }

  if (assignee.id === context.userId) {
    return assignee;
  }

  if (!context.canAssign) {
    throw new Error("You do not have permission to assign tasks.");
  }

  if (!context.canAssignDownline) {
    throw new Error("You can only assign tasks to yourself unless you have downline assignment permission.");
  }

  const assigneeLevel = getHighestRoleLevel(assignee.roles);
  if (context.maxRoleLevel <= assigneeLevel) {
    throw new Error("Tasks can only be assigned to a lower-level user unless you have tenant-wide assignment permission.");
  }

  return assignee;
}

async function assertParentTaskAccess(session: Session, context: TaskAccessContext, parentTaskId: string) {
  const parentTask = await assertTaskVisible(session, context, parentTaskId);
  if (context.isSuperAdmin || context.canAssignAny || context.isCompanyWide) {
    return parentTask;
  }

  if (!context.canDelegate) {
    throw new Error("You do not have permission to delegate sub-tasks.");
  }

  if (!isDirectlyInvolved(parentTask, context.userId)) {
    throw new Error("You must be directly involved in the parent task to delegate work.");
  }

  return parentTask;
}

function applyTaskFilters(where: Prisma.TaskWhereInput, input: ListTasksInput, context: TaskAccessContext, snapshot: TaskVisibilitySnapshot | null) {
  if (input.status) {
    where.status = input.status;
  }

  if (input.assigneeUserId) {
    where.assigneeUserId = input.assigneeUserId;
  }

  if (input.assignedByUserId) {
    where.assignedByUserId = input.assignedByUserId;
  }

  if (input.serviceRequestId) {
    where.serviceRequestId = input.serviceRequestId;
  }

  if (input.requestedFrom || input.requestedTo) {
    where.requestedAt = {};
    if (input.requestedFrom) {
      where.requestedAt.gte = startOfDay(input.requestedFrom);
    }
    if (input.requestedTo) {
      where.requestedAt.lte = endOfDay(input.requestedTo);
    }
  }

  if (input.dueFrom || input.dueTo || input.overdue) {
    where.dueDate = {};
    if (input.dueFrom) {
      where.dueDate.gte = startOfDay(input.dueFrom);
    }
    if (input.dueTo) {
      where.dueDate.lte = endOfDay(input.dueTo);
    }
    if (input.overdue) {
      where.dueDate.lt = new Date();
    }
  }

  if (input.scope === "my") {
    where.assigneeUserId = context.userId;
  } else if (input.scope === "delegated") {
    where.assignedByUserId = context.userId;
  } else if (input.scope === "downline") {
    if (context.isSuperAdmin || context.isCompanyWide) {
      where.parentTaskId = { not: null };
    } else {
      where.id = {
        in: Array.from(snapshot?.descendantIds ?? []),
      };
    }
  } else if (input.scope === "company") {
    if (!context.isSuperAdmin && !context.isCompanyWide) {
      where.id = {
        in: [],
      };
    }
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { taskNumber: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
      { assignee: { name: { contains: q, mode: "insensitive" } } },
      { assignedBy: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
}

export async function listTaskResponsibilityUsers(session: Session, servicePartnerId: string, parentTaskId?: string | null) {
  const context = await getTaskAccessContext(session);
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;
  let parentTaskServicePartnerId = resolvedServicePartnerId;

  if (parentTaskId) {
    const parentTask = await assertParentTaskAccess(session, context, parentTaskId);
    parentTaskServicePartnerId = parentTask.servicePartnerId;
  }

  const users = await prisma.user.findMany({
    where: {
      servicePartnerId: parentTaskServicePartnerId,
      status: "ACTIVE",
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }, { email: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        select: {
          role: {
            select: {
              key: true,
              name: true,
              level: true,
            },
          },
        },
      },
    },
  });

  return users
    .filter((user) => {
      if (context.isSuperAdmin || context.canAssignAny || context.isCompanyWide) {
        return true;
      }
      if (user.id === context.userId) {
        return true;
      }
      if (!context.canAssignDownline) {
        return false;
      }
      return context.maxRoleLevel > getHighestRoleLevel(user.roles);
    })
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      highestRoleLevel: getHighestRoleLevel(user.roles),
      roles: user.roles,
      roleLabel: getUserRoleLabel(user.roles),
    }));
}

export async function listTaskFilterUsers(session: Session) {
  return prisma.user.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }, { email: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        select: {
          role: {
            select: {
              key: true,
              name: true,
              level: true,
            },
          },
        },
      },
    },
  });
}

export async function listTaskServiceRequestOptions(session: Session) {
  const context = await getTaskAccessContext(session);
  const snapshot = await getTaskVisibilitySnapshot(session, context);

  const where: Prisma.ServiceRequestWhereInput = {
    deletedAt: null,
    ...scopeByTenant(session, {}),
  };

  if (snapshot) {
    where.tasks = {
      some: {
        id: {
          in: Array.from(snapshot.visibleIds),
        },
      },
    };
  }

  return prisma.serviceRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      serviceNumber: true,
      title: true,
    },
  });
}

export async function listTasks(session: Session, input: ListTasksInput = {}) {
  const context = await getTaskAccessContext(session);
  if (!context.canRead && !context.isSuperAdmin) {
    return {
      tasks: [],
      visibility: {
        canSeeCompanyScope: context.isCompanyWide,
      },
    };
  }

  const snapshot = await getTaskVisibilitySnapshot(session, context);
  const where: Prisma.TaskWhereInput = {
    deletedAt: null,
    ...scopeByTenant(session, {}),
  };

  if (snapshot) {
    where.id = {
      in: Array.from(snapshot.visibleIds),
    };
  }

  applyTaskFilters(where, input, context, snapshot);

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    include: getTaskSummaryInclude(),
  });

  return {
    tasks: await decorateTasks(tasks),
    visibility: {
      canSeeCompanyScope: context.isCompanyWide,
    },
  };
}

export async function listTasksForServiceRequest(session: Session, serviceRequestId: string) {
  const serviceRequest = await getServiceRequestForTaskScope(session, serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  const context = await getTaskAccessContext(session);
  const snapshot = await getTaskVisibilitySnapshot(session, context);
  const where: Prisma.TaskWhereInput = {
    serviceRequestId: serviceRequest.id,
    servicePartnerId: serviceRequest.servicePartnerId,
    deletedAt: null,
  };

  if (snapshot) {
    where.id = {
      in: Array.from(snapshot.visibleIds),
    };
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    include: getTaskSummaryInclude(),
  });

  return {
    serviceRequest,
    tasks: await decorateTasks(tasks),
  };
}

export async function createTask(session: Session, input: CreateTaskInput) {
  const context = await getTaskAccessContext(session);
  const isDelegatedSubTask = Boolean(input.parentTaskId);

  if (!context.isSuperAdmin) {
    if (isDelegatedSubTask) {
      if (!context.canDelegate && !context.canCreate) {
        throw new Error("You do not have permission to delegate tasks.");
      }
    } else if (!context.canCreate) {
      throw new Error("You do not have permission to create tasks.");
    }
  }

  let serviceRequest = await getServiceRequestForTaskScope(session, input.serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  let parentTask = null;
  if (input.parentTaskId) {
    parentTask = await assertParentTaskAccess(session, context, input.parentTaskId);
    if (parentTask.serviceRequestId !== serviceRequest.id) {
      serviceRequest = await getServiceRequestForTaskScope(session, parentTask.serviceRequestId);
      if (!serviceRequest) {
        throw new Error("Service request not found.");
      }
    }
  }

  await assertAssignableUser(context, serviceRequest.servicePartnerId, input.assigneeUserId);

  const taskNumber = await generateTaskNumber(serviceRequest.servicePartnerId);
  return prisma.task.create({
    data: {
      servicePartnerId: serviceRequest.servicePartnerId,
      serviceRequestId: serviceRequest.id,
      parentTaskId: parentTask?.id ?? null,
      taskNumber,
      title: input.title.trim(),
      description: normalizeOptionalString(input.description),
      assigneeUserId: input.assigneeUserId ?? null,
      status: input.status,
      requestedAt: input.requestedAt ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      completedAt: input.status === TaskStatus.COMPLETED ? new Date() : null,
      createdByUserId: session.user.id,
      assignedByUserId: session.user.id,
    },
    include: getTaskSummaryInclude(),
  });
}

export async function getTaskById(session: Session, taskId: string) {
  const context = await getTaskAccessContext(session);
  const task = await getTaskRecordById(taskId, session);
  if (!task) {
    return null;
  }

  const snapshot = await getTaskVisibilitySnapshot(session, context);
  const allowed = await canViewTaskRecord(task, context, snapshot);
  if (!allowed) {
    return null;
  }

  const decorated = (await decorateTasks([task]))[0];
  const visibleChildTasks = await Promise.all(
    task.childTasks.map(async (child) => {
      const loadedChild = await getTaskRecordById(child.id, session);
      if (!loadedChild) {
        return null;
      }
      const childAllowed = await canViewTaskRecord(loadedChild, context, snapshot);
      return childAllowed ? (await decorateTasks([loadedChild]))[0] : null;
    })
  );

  return {
    ...decorated,
    childTasks: visibleChildTasks.filter((taskRow): taskRow is NonNullable<typeof taskRow> => Boolean(taskRow)),
  };
}

export async function getTaskHistoryEntries(session: Session, taskId: string): Promise<TaskHistoryEntry[]> {
  const context = await getTaskAccessContext(session);
  if (!context.canHistoryRead && !context.isSuperAdmin) {
    return [];
  }

  const task = await assertTaskVisible(session, context, taskId);
  const rows = await prisma.activityLog.findMany({
    where: {
      servicePartnerId: task.servicePartnerId,
      entityType: "TASK",
      entityId: task.id,
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.createdAt,
    actor: row.actor,
  }));
}

export async function createTaskRemark(session: Session, taskId: string, input: CreateTaskRemarkInput) {
  const context = await getTaskAccessContext(session);
  if (!context.canRemarkCreate && !context.isSuperAdmin) {
    throw new Error("You do not have permission to add task remarks.");
  }

  return assertTaskVisible(session, context, taskId);
}

function nextCompletedAt(currentCompletedAt: Date | null, status: TaskStatus) {
  if (status === TaskStatus.COMPLETED) {
    return currentCompletedAt ?? new Date();
  }
  if (
    status === TaskStatus.REOPENED ||
    status === TaskStatus.YET_TO_START ||
    status === TaskStatus.IN_PROGRESS ||
    status === TaskStatus.BLOCKED
  ) {
    return null;
  }
  return currentCompletedAt;
}

async function assertTaskMutationAccess(
  session: Session,
  taskId: string,
  permission: "update" | "delete" | "status"
) {
  const context = await getTaskAccessContext(session);
  const task = await assertTaskVisible(session, context, taskId);

  if (context.isSuperAdmin) {
    return { task, context };
  }

  if (permission === "update" && !context.canUpdate) {
    throw new Error("You do not have permission to update tasks.");
  }
  if (permission === "delete" && !context.canDelete) {
    throw new Error("You do not have permission to delete tasks.");
  }
  if (permission === "status" && !context.canStatusUpdate) {
    throw new Error("You do not have permission to update task status.");
  }

  if (context.isCompanyWide) {
    return { task, context };
  }

  if (isDirectlyInvolved(task, context.userId)) {
    return { task, context };
  }

  const responsibilityIds = await getResponsibilityServiceRequestIds(context.userId, context.servicePartnerId);
  if (responsibilityIds.has(task.serviceRequestId)) {
    return { task, context };
  }

  const ancestors = await loadAncestors(task.servicePartnerId, task);
  const hasAncestorOversight = ancestors.some(
    (ancestor) => ancestor.assignedBy?.id === context.userId || ancestor.createdBy?.id === context.userId
  );
  if (hasAncestorOversight) {
    return { task, context };
  }

  throw new Error("Task not found.");
}

export async function updateTask(session: Session, taskId: string, input: UpdateTaskInput) {
  const { task, context } = await assertTaskMutationAccess(session, taskId, "update");

  await assertAssignableUser(context, task.servicePartnerId, input.assigneeUserId);

  const completedAt = nextCompletedAt(task.completedAt, input.status);

  return prisma.task.update({
    where: { id: taskId },
    data: {
      title: input.title.trim(),
      description: normalizeOptionalString(input.description),
      assigneeUserId: input.assigneeUserId ?? null,
      assignedByUserId:
        input.assigneeUserId !== task.assigneeUserId && input.assigneeUserId ? session.user.id : task.assignedByUserId,
      status: input.status,
      requestedAt: input.requestedAt ?? null,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      completedAt,
    },
    include: getTaskSummaryInclude(),
  });
}

export async function updateTaskStatus(session: Session, taskId: string, input: UpdateTaskStatusInput) {
  const { task } = await assertTaskMutationAccess(session, taskId, "status");
  const completedAt = nextCompletedAt(task.completedAt, input.status);

  return prisma.task.update({
    where: { id: taskId },
    data: {
      status: input.status,
      completedAt,
    },
    include: getTaskSummaryInclude(),
  });
}

export async function softDeleteTask(session: Session, taskId: string) {
  const { task } = await assertTaskMutationAccess(session, taskId, "delete");

  return prisma.task.update({
    where: { id: taskId },
    data: {
      deletedAt: new Date(),
    },
    include: getTaskSummaryInclude(),
  });
}
