import { AssignmentRole } from "@prisma/client";
import type { Session } from "next-auth";

import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

const responsibilityRoles = [AssignmentRole.PM, AssignmentRole.SM, AssignmentRole.TECHNICIAN] as const;

type ResponsibilityUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roleLabel: string;
};

export type ResponsibilityAssignment = {
  assignmentId: string;
  role: AssignmentRole;
  assignedAt: Date;
  user: ResponsibilityUser;
};

export type ResponsibilitySnapshot = Record<AssignmentRole, ResponsibilityAssignment | null>;

export type ResponsibilityCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roleLabel: string;
};

type ResponsibilityUpdateInput = {
  pmUserId: string | null;
  smUserId: string | null;
  technicianUserId: string | null;
};

function emptyResponsibilitySnapshot(): ResponsibilitySnapshot {
  return {
    [AssignmentRole.PM]: null,
    [AssignmentRole.SM]: null,
    [AssignmentRole.TECHNICIAN]: null,
  };
}

async function getServiceRequestTenantScoped(session: Session, serviceRequestId: string) {
  return prisma.serviceRequest.findFirst({
    where: {
      id: serviceRequestId,
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    select: {
      id: true,
      servicePartnerId: true,
    },
  });
}

function getUserRoleLabel(roles: { role: { name: string; key: string } }[]) {
  const role = roles[0]?.role;
  if (!role) {
    return "User";
  }
  return `${role.name} (${role.key})`;
}

export async function listResponsibilityCandidates(session: Session, servicePartnerId: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  const users = await prisma.user.findMany({
    where: {
      servicePartnerId: resolvedServicePartnerId,
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
            },
          },
        },
      },
    },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roleLabel: getUserRoleLabel(user.roles),
  })) satisfies ResponsibilityCandidate[];
}

export async function getServiceRequestResponsibilities(session: Session, serviceRequestId: string) {
  const serviceRequest = await getServiceRequestTenantScoped(session, serviceRequestId);
  if (!serviceRequest) {
    return null;
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      serviceRequestId: serviceRequest.id,
      servicePartnerId: serviceRequest.servicePartnerId,
      unassignedAt: null,
      role: {
        in: [...responsibilityRoles],
      },
    },
    orderBy: [{ assignedAt: "desc" }],
    select: {
      id: true,
      role: true,
      assignedAt: true,
      user: {
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
                },
              },
            },
          },
        },
      },
    },
  });

  const snapshot = emptyResponsibilitySnapshot();

  for (const assignment of assignments) {
    if (snapshot[assignment.role]) {
      continue;
    }

    snapshot[assignment.role] = {
      assignmentId: assignment.id,
      role: assignment.role,
      assignedAt: assignment.assignedAt,
      user: {
        id: assignment.user.id,
        name: assignment.user.name,
        email: assignment.user.email,
        phone: assignment.user.phone,
        roleLabel: getUserRoleLabel(assignment.user.roles),
      },
    };
  }

  return {
    serviceRequestId: serviceRequest.id,
    servicePartnerId: serviceRequest.servicePartnerId,
    snapshot,
  };
}

async function assertCandidateUser(servicePartnerId: string, userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      servicePartnerId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new Error("Selected user is invalid for this service request tenant.");
  }
}

function normalizeResponsibilityInput(input: ResponsibilityUpdateInput): Record<AssignmentRole, string | null> {
  return {
    [AssignmentRole.PM]: input.pmUserId,
    [AssignmentRole.SM]: input.smUserId,
    [AssignmentRole.TECHNICIAN]: input.technicianUserId,
  };
}

export async function updateServiceRequestResponsibilities(
  session: Session,
  serviceRequestId: string,
  input: ResponsibilityUpdateInput
) {
  const serviceRequest = await getServiceRequestTenantScoped(session, serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  const requestedAssignments = normalizeResponsibilityInput(input);
  const requestedUserIds = Array.from(
    new Set(
      Object.values(requestedAssignments).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  );

  for (const userId of requestedUserIds) {
    await assertCandidateUser(serviceRequest.servicePartnerId, userId);
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const role of responsibilityRoles) {
      await tx.assignment.updateMany({
        where: {
          serviceRequestId: serviceRequest.id,
          servicePartnerId: serviceRequest.servicePartnerId,
          role,
          unassignedAt: null,
        },
        data: {
          unassignedAt: now,
        },
      });

      const selectedUserId = requestedAssignments[role];
      if (selectedUserId) {
        await tx.assignment.create({
          data: {
            servicePartnerId: serviceRequest.servicePartnerId,
            serviceRequestId: serviceRequest.id,
            userId: selectedUserId,
            role,
          },
        });
      }
    }
  });

  const refreshed = await getServiceRequestResponsibilities(session, serviceRequest.id);
  if (!refreshed) {
    throw new Error("Unable to refresh service request responsibility.");
  }
  return refreshed;
}
