import { Prisma, TaskStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type {
  CreateTaskInput,
  CreateTaskRemarkInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from "@/features/tasks/validations";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { getOrLoadRuntimeCache } from "@/lib/cache/runtime-cache";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { getUserPermissions } from "@/lib/auth/permissions";
import { scopeByTenant } from "@/lib/auth/tenant";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { measurePerf } from "@/lib/observability/perf";

const COMPANY_ADMIN_LEVEL = 90;
const TASK_ACCESS_CONTEXT_CACHE_TTL_MS = 30_000;

function getDatabaseSchemaName() {
  try {
    const schema = new URL(env().DATABASE_URL).searchParams.get("schema")?.trim();
    if (schema && /^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      return schema;
    }
  } catch {
    // Ignore malformed URLs and fall back to the default schema.
  }

  return "public";
}

const TASK_TABLE_SQL = Prisma.raw(`"${getDatabaseSchemaName()}"."Task"`);

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
  take?: number;
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

type ListedTask = Prisma.TaskGetPayload<{
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
    _count: {
      select: {
        childTasks: true;
      };
    };
  };
}>;

type TaskListRecord = {
  id: string;
  servicePartnerId: string;
  serviceRequestId: string;
  parentTaskId: string | null;
  taskNumber: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  requestedAt: Date | null;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assigneeUserId: string | null;
  createdByUserId: string | null;
  assignedByUserId: string | null;
  serviceRequest: {
    id: string;
    serviceNumber: string;
    title: string;
    servicePartnerId: string;
  };
  _count: {
    childTasks: number;
  };
};

type TaskChainRecord = {
  id: string;
  parentTaskId: string | null;
  taskNumber: string;
  title: string;
  assigneeUserId: string | null;
  assignedByUserId: string | null;
  createdByUserId: string | null;
};

type TaskUserSummary = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

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

function getTaskListSelect() {
  return {
    id: true,
    servicePartnerId: true,
    serviceRequestId: true,
    parentTaskId: true,
    taskNumber: true,
    title: true,
    description: true,
    status: true,
    requestedAt: true,
    startDate: true,
    dueDate: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
    assigneeUserId: true,
    createdByUserId: true,
    assignedByUserId: true,
    serviceRequest: {
      select: {
        id: true,
        serviceNumber: true,
        title: true,
        servicePartnerId: true,
      },
    },
    _count: {
      select: {
        childTasks: {
          where: {
            deletedAt: null,
          },
        },
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
  return measurePerf("tasks.access_context", async () => {
    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId ?? "none",
      session.user.isSuperAdmin ? "super_admin" : session.user.roleKeys.slice().sort().join("|"),
    ].join(":");

    return getOrLoadRuntimeCache("tasks.access_context", cacheKey, TASK_ACCESS_CONTEXT_CACHE_TTL_MS, async () => {
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
    });
  });
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

async function getDirectAndDescendantTaskIds(userId: string, servicePartnerId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string; scope: string }>>(Prisma.sql`
    WITH RECURSIVE direct_tasks AS (
      SELECT "id"
      FROM ${TASK_TABLE_SQL}
      WHERE "servicePartnerId" = ${servicePartnerId}
        AND "deletedAt" IS NULL
        AND (
          "assigneeUserId" = ${userId}
          OR "createdByUserId" = ${userId}
          OR "assignedByUserId" = ${userId}
        )
    ),
    descendant_tasks AS (
      SELECT child."id"
      FROM ${TASK_TABLE_SQL} AS child
      INNER JOIN direct_tasks AS direct_task
        ON child."parentTaskId" = direct_task."id"
      WHERE child."servicePartnerId" = ${servicePartnerId}
        AND child."deletedAt" IS NULL
      UNION
      SELECT child."id"
      FROM ${TASK_TABLE_SQL} AS child
      INNER JOIN descendant_tasks AS descendant_task
        ON child."parentTaskId" = descendant_task."id"
      WHERE child."servicePartnerId" = ${servicePartnerId}
        AND child."deletedAt" IS NULL
    )
    SELECT "id", 'direct' AS "scope"
    FROM direct_tasks
    UNION ALL
    SELECT "id", 'descendant' AS "scope"
    FROM descendant_tasks
  `);

  const directIds = new Set<string>();
  const descendantIds = new Set<string>();

  for (const row of rows) {
    if (row.scope === "direct") {
      directIds.add(row.id);
      continue;
    }

    descendantIds.add(row.id);
  }

  return {
    directIds,
    descendantIds,
  };
}

async function getTaskVisibilitySnapshot(session: Session, context: TaskAccessContext): Promise<TaskVisibilitySnapshot | null> {
  if (context.isSuperAdmin || context.isCompanyWide) {
    return null;
  }

  const [responsibilityServiceRequestIds, taskVisibilityIds] = await Promise.all([
    getResponsibilityServiceRequestIds(context.userId, context.servicePartnerId),
    getDirectAndDescendantTaskIds(context.userId, context.servicePartnerId),
  ]);

  const directIds = taskVisibilityIds.directIds;
  const descendantIds = taskVisibilityIds.descendantIds;
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

async function loadAncestorGraph(servicePartnerId: string, tasks: Array<{ parentTaskId: string | null }>) {
  const ancestorMap = new Map<string, TaskChainNode>();
  let frontier = Array.from(
    new Set(
      tasks
        .map((task) => task.parentTaskId)
        .filter((parentTaskId): parentTaskId is string => Boolean(parentTaskId))
    )
  );

  while (frontier.length > 0) {
    const parents = await prisma.task.findMany({
      where: {
        id: {
          in: frontier,
        },
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

    frontier = [];
    for (const parent of parents) {
      if (ancestorMap.has(parent.id)) {
        continue;
      }

      ancestorMap.set(parent.id, parent);
      if (parent.parentTaskId && !ancestorMap.has(parent.parentTaskId)) {
        frontier.push(parent.parentTaskId);
      }
    }
  }

  return ancestorMap;
}

async function loadAncestorRecordGraph(servicePartnerId: string, tasks: Array<{ parentTaskId: string | null }>) {
  const ancestorMap = new Map<string, TaskChainRecord>();
  let frontier = Array.from(
    new Set(
      tasks
        .map((task) => task.parentTaskId)
        .filter((parentTaskId): parentTaskId is string => Boolean(parentTaskId))
    )
  );

  while (frontier.length > 0) {
    const parents = await prisma.task.findMany({
      where: {
        id: {
          in: frontier,
        },
        servicePartnerId,
        deletedAt: null,
      },
      select: {
        id: true,
        parentTaskId: true,
        taskNumber: true,
        title: true,
        assigneeUserId: true,
        assignedByUserId: true,
        createdByUserId: true,
      },
    });

    frontier = [];
    for (const parent of parents) {
      if (ancestorMap.has(parent.id)) {
        continue;
      }

      ancestorMap.set(parent.id, parent);
      if (parent.parentTaskId && !ancestorMap.has(parent.parentTaskId)) {
        frontier.push(parent.parentTaskId);
      }
    }
  }

  return ancestorMap;
}

function buildAncestorChainFromMap(task: { parentTaskId: string | null }, ancestorMap: Map<string, TaskChainNode>) {
  const ancestors: TaskChainNode[] = [];
  let currentParentId = task.parentTaskId;

  while (currentParentId) {
    const parent = ancestorMap.get(currentParentId);
    if (!parent) {
      break;
    }

    ancestors.push(parent);
    currentParentId = parent.parentTaskId;
  }

  return ancestors;
}

function buildAncestorRecordChain(task: { parentTaskId: string | null }, ancestorMap: Map<string, TaskChainRecord>) {
  const ancestors: TaskChainRecord[] = [];
  let currentParentId = task.parentTaskId;

  while (currentParentId) {
    const parent = ancestorMap.get(currentParentId);
    if (!parent) {
      break;
    }

    ancestors.push(parent);
    currentParentId = parent.parentTaskId;
  }

  return ancestors;
}

async function loadTaskUserMap(userIds: Iterable<string>) {
  const uniqueUserIds = Array.from(new Set(Array.from(userIds).filter(Boolean)));
  if (uniqueUserIds.length === 0) {
    return new Map<string, TaskUserSummary>();
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: uniqueUserIds,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
    },
  });

  return new Map(users.map((user) => [user.id, user]));
}

function mapTaskUser(userId: string | null, userMap: Map<string, TaskUserSummary>) {
  if (!userId) {
    return null;
  }

  return userMap.get(userId) ?? null;
}

function buildAssignmentChain(nodes: TaskChainNode[]) {
  return nodes.map((node) => {
    const assigner = userDisplayName(node.assignedBy ?? node.createdBy);
    const assignee = node.assignee ? userDisplayName(node.assignee) : "Unassigned";
    return `${node.taskNumber}: ${assigner} -> ${assignee}`;
  });
}

function groupTasksByServicePartner<T extends { servicePartnerId: string }>(tasks: T[]) {
  const groupedTasks = new Map<string, T[]>();

  for (const task of tasks) {
    const servicePartnerTasks = groupedTasks.get(task.servicePartnerId);
    if (servicePartnerTasks) {
      servicePartnerTasks.push(task);
      continue;
    }

    groupedTasks.set(task.servicePartnerId, [task]);
  }

  return groupedTasks;
}

async function decorateTasks(tasks: LoadedTask[]) {
  if (tasks.length === 0) {
    return [];
  }

  const ancestorMapsByServicePartner = new Map<string, Map<string, TaskChainNode>>();

  for (const [servicePartnerId, servicePartnerTasks] of groupTasksByServicePartner(tasks)) {
    ancestorMapsByServicePartner.set(servicePartnerId, await loadAncestorGraph(servicePartnerId, servicePartnerTasks));
  }

  return tasks.map((task) => {
    const ancestorMap = ancestorMapsByServicePartner.get(task.servicePartnerId) ?? new Map<string, TaskChainNode>();
    const ancestors = buildAncestorChainFromMap(task, ancestorMap);
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
  });
}

async function getLatestChildStatusMap(taskIds: string[]) {
  if (taskIds.length === 0) {
    return new Map<string, TaskStatus>();
  }

  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      parentTaskId: {
        in: taskIds,
      },
    },
    orderBy: [{ parentTaskId: "asc" }, { updatedAt: "desc" }],
    select: {
      parentTaskId: true,
      status: true,
    },
  });

  const statusMap = new Map<string, TaskStatus>();
  for (const row of rows) {
    if (!row.parentTaskId || statusMap.has(row.parentTaskId)) {
      continue;
    }
    statusMap.set(row.parentTaskId, row.status);
  }

  return statusMap;
}

async function decorateListedTasks(tasks: TaskListRecord[]) {
  if (tasks.length === 0) {
    return [];
  }

  const ancestorMapsByServicePartner = new Map<string, Map<string, TaskChainRecord>>();

  await measurePerf("tasks.list.decorate.ancestor_graph", async () => {
    for (const [servicePartnerId, servicePartnerTasks] of groupTasksByServicePartner(tasks)) {
      ancestorMapsByServicePartner.set(servicePartnerId, await loadAncestorRecordGraph(servicePartnerId, servicePartnerTasks));
    }
  });

  const latestChildStatusMap = await measurePerf(
    "tasks.list.decorate.child_statuses",
    () => getLatestChildStatusMap(tasks.map((task) => task.id))
  );
  const userMap = await measurePerf("tasks.list.decorate.user_map", () =>
    loadTaskUserMap(
      tasks
        .flatMap((task) => [task.assigneeUserId, task.createdByUserId, task.assignedByUserId])
        .filter((userId): userId is string => Boolean(userId))
        .concat(
        Array.from(ancestorMapsByServicePartner.values()).flatMap((ancestorMap) =>
          Array.from(ancestorMap.values()).flatMap((ancestor) => [
            ancestor.assigneeUserId,
            ancestor.createdByUserId,
            ancestor.assignedByUserId,
          ]).filter((userId): userId is string => Boolean(userId))
        )
      )
    )
  );

  return tasks.map((task) => {
    const ancestorMap = ancestorMapsByServicePartner.get(task.servicePartnerId) ?? new Map<string, TaskChainRecord>();
    const ancestors = buildAncestorRecordChain(task, ancestorMap);
    const hierarchyDepth = ancestors.length;
    const assignmentNodes: TaskChainNode[] = [...ancestors]
      .reverse()
      .map((ancestor) => ({
        id: ancestor.id,
        parentTaskId: ancestor.parentTaskId,
        taskNumber: ancestor.taskNumber,
        title: ancestor.title,
        assignee: mapTaskUser(ancestor.assigneeUserId, userMap),
        assignedBy: mapTaskUser(ancestor.assignedByUserId, userMap),
        createdBy: mapTaskUser(ancestor.createdByUserId, userMap),
      }))
      .concat([
        {
          id: task.id,
          parentTaskId: task.parentTaskId,
          taskNumber: task.taskNumber,
          title: task.title,
          assignee: mapTaskUser(task.assigneeUserId, userMap),
          assignedBy: mapTaskUser(task.assignedByUserId, userMap),
          createdBy: mapTaskUser(task.createdByUserId, userMap),
        },
      ]);
    const assignmentChain = buildAssignmentChain(assignmentNodes);
    const immediateParent = task.parentTaskId ? ancestorMap.get(task.parentTaskId) ?? null : null;

    return {
      ...task,
      assignee: mapTaskUser(task.assigneeUserId, userMap),
      createdBy: mapTaskUser(task.createdByUserId, userMap),
      assignedBy: mapTaskUser(task.assignedByUserId, userMap),
      hierarchyDepth,
      assignmentChain,
      childTaskCount: task._count.childTasks,
      latestChildStatus: latestChildStatusMap.get(task.id) ?? null,
      isSubTask: task.parentTaskId !== null,
      parentTaskSummary: immediateParent
        ? {
            id: immediateParent.id,
            taskNumber: immediateParent.taskNumber,
            title: immediateParent.title,
          }
        : null,
      serviceRequestSummary: {
        id: task.serviceRequest.id,
        serviceNumber: task.serviceRequest.serviceNumber,
        title: task.serviceRequest.title,
      },
    };
  });
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

  return getOrSetServerCache(
    "options.task_responsibility_users",
    `${session.user.id}:${parentTaskServicePartnerId}:${parentTaskId ?? "root"}`,
    async () => {
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
    },
    {
      ttlSeconds: 45,
      prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
    }
  );
}

export async function listTaskFilterUsers(session: Session) {
  return getOrSetServerCache(
    "options.task_filter_users",
    `${session.user.id}:${session.user.servicePartnerId}:${buildRoleSignature(session.user.roleKeys)}`,
    () =>
      prisma.user.findMany({
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
      }),
    {
      ttlSeconds: 45,
      prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
    }
  );
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

  return getOrSetServerCache(
    "options.task_service_requests",
    `${session.user.id}:${session.user.servicePartnerId}:${buildRoleSignature(session.user.roleKeys)}`,
    () =>
      prisma.serviceRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          serviceNumber: true,
          title: true,
        },
      }),
    {
      ttlSeconds: 45,
      prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
    }
  );
}

export async function listTasks(session: Session, input: ListTasksInput = {}) {
  return measurePerf("tasks.list", async () => {
    const context = await getTaskAccessContext(session);
    if (!context.canRead && !context.isSuperAdmin) {
      return {
        tasks: [],
        visibility: {
          canSeeCompanyScope: context.isCompanyWide,
        },
      };
    }

    const snapshot = await measurePerf("tasks.list.visibility", () => getTaskVisibilitySnapshot(session, context));
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

    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId,
      buildRoleSignature(session.user.roleKeys),
      buildFilterSignature({
        q: input.q?.trim() || null,
        status: input.status ?? null,
        assigneeUserId: input.assigneeUserId?.trim() || null,
        assignedByUserId: input.assignedByUserId?.trim() || null,
        serviceRequestId: input.serviceRequestId?.trim() || null,
        scope: input.scope ?? "all",
        requestedFrom: input.requestedFrom?.toISOString() ?? null,
        requestedTo: input.requestedTo?.toISOString() ?? null,
        dueFrom: input.dueFrom?.toISOString() ?? null,
        dueTo: input.dueTo?.toISOString() ?? null,
        overdue: input.overdue ?? false,
        take: input.take ?? null,
      }),
    ].join(":");

    const loadTasks = async () => {
      const tasks = await measurePerf("tasks.list.query", () =>
        prisma.task.findMany({
          where,
          take: input.take,
          orderBy: [{ createdAt: "asc" }],
          select: getTaskListSelect(),
        })
      );

      return {
        tasks: await measurePerf("tasks.list.decorate", () => decorateListedTasks(tasks)),
        visibility: {
          canSeeCompanyScope: context.isCompanyWide,
        },
      };
    };

    return getOrSetServerCache("tasks.list", cacheKey, loadTasks, {
      ttlSeconds: 20,
      prefixes: [cachePrefixes.tasks, `${cachePrefixes.tasks}:tenant:${session.user.servicePartnerId}`],
    });
  });
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
    if (parentTask.servicePartnerId !== serviceRequest.servicePartnerId) {
      throw new Error("Parent task must belong to the same tenant as the selected service request.");
    }
    if (parentTask.serviceRequestId !== serviceRequest.id) {
      serviceRequest = await getServiceRequestForTaskScope(session, parentTask.serviceRequestId);
      if (!serviceRequest) {
        throw new Error("Service request not found.");
      }
    }
  }

  await assertAssignableUser(context, serviceRequest.servicePartnerId, input.assigneeUserId);

  const taskNumber = await generateTaskNumber(serviceRequest.servicePartnerId);
  const created = await prisma.task.create({
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

  await invalidateTenantDataCaches(serviceRequest.servicePartnerId);
  return created;
}

export async function getTaskById(session: Session, taskId: string) {
  return measurePerf("tasks.get_by_id", async () => {
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
    const childIds = task.childTasks.map((child) => child.id);
    const loadedChildTasks =
      childIds.length > 0
        ? await prisma.task.findMany({
            where: {
              id: { in: childIds },
              deletedAt: null,
              ...scopeByTenant(session, {}),
            },
            include: getTaskSummaryInclude(),
          })
        : [];

    const visibleChildTasks = await Promise.all(
      loadedChildTasks.map(async (childTask) => {
        const childAllowed = await canViewTaskRecord(childTask, context, snapshot);
        return childAllowed ? (await decorateTasks([childTask]))[0] : null;
      })
    );

    return {
      ...decorated,
      childTasks: visibleChildTasks.filter((taskRow): taskRow is NonNullable<typeof taskRow> => Boolean(taskRow)),
    };
  });
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

  const updated = await prisma.task.update({
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

  await invalidateTenantDataCaches(task.servicePartnerId);
  return updated;
}

export async function updateTaskStatus(session: Session, taskId: string, input: UpdateTaskStatusInput) {
  const { task } = await assertTaskMutationAccess(session, taskId, "status");
  const completedAt = nextCompletedAt(task.completedAt, input.status);

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      status: input.status,
      completedAt,
    },
    include: getTaskSummaryInclude(),
  });

  await invalidateTenantDataCaches(task.servicePartnerId);
  return updated;
}

export async function softDeleteTask(session: Session, taskId: string) {
  const { task } = await assertTaskMutationAccess(session, taskId, "delete");
  const childTaskCount = await prisma.task.count({
    where: {
      servicePartnerId: task.servicePartnerId,
      parentTaskId: task.id,
      deletedAt: null,
    },
  });

  if (childTaskCount > 0) {
    throw new Error("Cannot delete a task that still has child tasks.");
  }

  const deleted = await prisma.task.update({
    where: { id: taskId },
    data: {
      deletedAt: new Date(),
    },
    include: getTaskSummaryInclude(),
  });

  await invalidateTenantDataCaches(task.servicePartnerId);
  return deleted;
}
