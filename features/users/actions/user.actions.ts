"use server";

import { Prisma, UserStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { hasPermission } from "@/lib/auth/permissions";
import { requireAnyPermission, requirePermission } from "@/lib/auth/rbac";
import { requireAuth } from "@/lib/auth/session";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import {
  countActiveCompanyAdminsWithPermissions,
  countActiveSuperAdmins,
  countUserSuperAdminRoles,
  createUser,
  getServicePartnerIdForWrite,
  getUserById,
  replaceUserDirectPermissions,
  resolveGrantablePermissionIds,
  updateUser,
} from "@/features/users/services/user.service";
import { userRoleSchema, userStatusSchema, userUpsertSchema } from "@/features/users/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function toUserInput(formData: FormData) {
  return userUpsertSchema.safeParse({
    name: getFormString(formData, "name"),
    email: getFormString(formData, "email"),
    phone: getFormString(formData, "phone"),
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    status: getFormString(formData, "status") || UserStatus.ACTIVE,
  });
}

function getPermissionIds(formData: FormData) {
  return formData
    .getAll("permissionIds")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidateUserPaths(userId: string) {
  revalidatePath("/users");
  revalidatePath(`/users/${userId}`);
}

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

async function assertCanChangeOwnDirectPermissions(input: {
  sessionUserId: string;
  targetUser: {
    id: string;
    servicePartnerId: string;
    roles: { role: { key: string } }[];
  };
  permissionIds: string[];
}) {
  const { targetUser, sessionUserId, permissionIds } = input;
  if (!targetUser || targetUser.id !== sessionUserId) {
    return;
  }

  const isCompanyAdmin = targetUser.roles.some((entry) => entry.role.key === "company_admin");
  if (!isCompanyAdmin) {
    return;
  }

  const selectedPermissions = permissionIds.length
    ? await prisma.permission.findMany({
        where: {
          id: {
            in: permissionIds,
          },
        },
        select: {
          key: true,
        },
      })
    : [];
  const selectedPermissionKeys = new Set(selectedPermissions.map((permission) => permission.key));

  const mandatoryOwnKeys = ["dashboard.read", "users.read", "users.update"];
  const hasLostMandatoryOwnAccess = mandatoryOwnKeys.some((permissionKey) => !selectedPermissionKeys.has(permissionKey));

  if (!hasLostMandatoryOwnAccess) {
    return;
  }

  const backupAdminCount = await countActiveCompanyAdminsWithPermissions({
    servicePartnerId: targetUser.servicePartnerId,
    excludeUserId: targetUser.id,
    permissionKeys: mandatoryOwnKeys,
  });

  if (backupAdminCount <= 0) {
    throw new Error("Cannot remove own critical access as the only active company admin.");
  }
}

export async function createUserAction(formData: FormData) {
  const session = await requirePermission("users.create");
  const errorRedirect = getSafeRedirectPath(formData.get("errorRedirect"), "/users/new");
  const successRedirectOverride = getSafeRedirectPath(formData.get("successRedirect"), "");
  const selectedRoleId = getFormString(formData, "roleId");
  const requestedPermissionIds = getPermissionIds(formData);
  const parsed = toUserInput(formData);

  if (!parsed.success) {
    redirect(withErrorCode(errorRedirect, "validation"));
  }

  const servicePartnerId = getServicePartnerIdForWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(withErrorCode(errorRedirect, "service-partner"));
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const user = await createUser(session, parsed.data);
    let effectiveRoleId: string | null = null;

    if (selectedRoleId) {
      const canAssignRoles =
        (await hasPermission(session, "roles.assign")) || (await hasPermission(session, "users.roles.assign"));

      if (!canAssignRoles) {
        redirect(withErrorCode(errorRedirect, "role-permission"));
      }

      const role = await prisma.role.findFirst({
        where: {
          id: selectedRoleId,
          deletedAt: null,
          servicePartnerId: user.servicePartnerId,
          ...(session.user.isSuperAdmin ? {} : { scope: "TENANT" }),
        },
        select: {
          id: true,
          key: true,
        },
      });

      if (!role) {
        redirect(withErrorCode(errorRedirect, "role"));
      }

      await prisma.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId: role.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId: role.id,
        },
      });
      effectiveRoleId = role.id;
    }

    let permissionIdsToAssign = requestedPermissionIds;
    if (permissionIdsToAssign.length === 0 && effectiveRoleId) {
      const roleTemplatePermissions = await prisma.rolePermission.findMany({
        where: { roleId: effectiveRoleId },
        select: { permissionId: true },
      });
      permissionIdsToAssign = roleTemplatePermissions.map((entry) => entry.permissionId);
    }

    const grantablePermissionIds = await resolveGrantablePermissionIds(session, permissionIdsToAssign);
    await replaceUserDirectPermissions({
      userId: user.id,
      servicePartnerId: user.servicePartnerId,
      permissionIds: grantablePermissionIds,
      assignedByUserId: session.user.id,
    });

    await logActivity({
      action: "user.create",
      module: "users",
      entityType: "USER",
      entityId: user.id,
      message: "User created",
      servicePartnerId: user.servicePartnerId,
    });
    revalidatePath("/users");
    if (successRedirectOverride) {
      redirect(getSafeRedirectPath(successRedirectOverride, `/users/${user.id}?success=created`));
    }
    redirect(`/users/${user.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(withErrorCode(errorRedirect, "duplicate"));
    }
    if (error instanceof Error && error.message.includes("cannot grant permissions")) {
      redirect(withErrorCode(errorRedirect, "permission-grant"));
    }
    throw error;
  }
}

export async function updateUserAction(id: string, formData: FormData) {
  const session = await requirePermission("users.update");
  const parsed = toUserInput(formData);
  const selectedRoleId = getFormString(formData, "roleId");
  const requestedPermissionIds = getPermissionIds(formData);

  if (!parsed.success) {
    redirect(`/users/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/users/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const existingUser = await getUserById(session, id);
    if (!existingUser) {
      throw new Error("User not found.");
    }

    const user = await updateUser(session, id, parsed.data);

    if (selectedRoleId) {
      const canAssignRoles =
        (await hasPermission(session, "roles.assign")) || (await hasPermission(session, "users.roles.assign"));
      if (!canAssignRoles) {
        redirect(`/users/${id}/edit?error=role-permission`);
      }

      const role = await prisma.role.findFirst({
        where: {
          id: selectedRoleId,
          deletedAt: null,
          servicePartnerId: user.servicePartnerId,
          ...(session.user.isSuperAdmin ? {} : { scope: "TENANT" }),
        },
        select: {
          id: true,
        },
      });

      if (!role) {
        redirect(`/users/${id}/edit?error=role`);
      }

      await prisma.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId: role.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId: role.id,
        },
      });
    }

    const grantablePermissionIds = await resolveGrantablePermissionIds(session, requestedPermissionIds);
    await assertCanChangeOwnDirectPermissions({
      sessionUserId: session.user.id,
      targetUser: existingUser,
      permissionIds: grantablePermissionIds,
    });
    await replaceUserDirectPermissions({
      userId: user.id,
      servicePartnerId: user.servicePartnerId,
      permissionIds: grantablePermissionIds,
      assignedByUserId: session.user.id,
    });

    await logActivity({
      action: "user.update",
      module: "users",
      entityType: "USER",
      entityId: user.id,
      message: "User updated",
      servicePartnerId: user.servicePartnerId,
    });
    revalidateUserPaths(user.id);
    redirect(`/users/${user.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/users/${id}/edit?error=duplicate`);
    }
    if (error instanceof Error && error.message.includes("cannot grant permissions")) {
      redirect(`/users/${id}/edit?error=permission-grant`);
    }
    if (error instanceof Error && error.message.includes("Cannot remove own critical access")) {
      redirect(`/users/${id}/edit?error=self-lockout`);
    }
    throw error;
  }
}

async function assertCanChangeOwnCriticalState(targetUserId: string, nextStatus?: UserStatus, deleting = false) {
  const session = await requireAuth();
  if (targetUserId !== session.user.id) {
    return;
  }

  const superAdminRoles = await countUserSuperAdminRoles(targetUserId);
  if (superAdminRoles === 0) {
    return;
  }

  const activeSuperAdmins = await countActiveSuperAdmins();
  if (activeSuperAdmins <= 1 && (deleting || nextStatus !== "ACTIVE")) {
    throw new Error("Cannot lock out the only active super admin.");
  }
}

export async function updateUserStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("users.update");
  const parsed = userStatusSchema.safeParse({ status: getFormString(formData, "status") });

  if (!parsed.success) {
    redirect(`/users/${id}?error=validation`);
  }

  const user = await getUserById(session, id);
  if (!user) {
    throw new Error("User not found.");
  }

  try {
    await requireTenantAccess(user.servicePartnerId);
    await assertCanChangeOwnCriticalState(id, parsed.data.status);

    await prisma.user.update({ where: { id }, data: { status: parsed.data.status } });
    await logActivity({
      action: "user.status_change",
      module: "users",
      entityType: "USER",
      entityId: id,
      message: `User status changed to ${parsed.data.status}`,
      servicePartnerId: user.servicePartnerId,
    });

    revalidateUserPaths(id);
    redirect(getSafeRedirectPath(formData.get("redirectTo"), `/users/${id}`));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot lock out")) {
      redirect(`/users/${id}?error=self-lockout`);
    }
    throw error;
  }
}

export async function deleteUserAction(id: string, formData: FormData) {
  const session = await requirePermission("users.delete");
  const user = await getUserById(session, id);

  if (!user) {
    throw new Error("User not found.");
  }

  try {
    await requireTenantAccess(user.servicePartnerId);
    await assertCanChangeOwnCriticalState(id, undefined, true);

    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: "INACTIVE",
      },
    });

    await logActivity({
      action: "user.delete",
      module: "users",
      entityType: "USER",
      entityId: id,
      message: "User soft deleted",
      servicePartnerId: user.servicePartnerId,
    });

    revalidateUserPaths(id);
    redirect(getSafeRedirectPath(formData.get("redirectTo"), "/users"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot lock out")) {
      redirect(`/users/${id}?error=self-lockout`);
    }
    throw error;
  }
}

export async function assignUserRoleAction(id: string, formData: FormData) {
  const session = await requireAnyPermission(["roles.assign", "users.roles.assign"]);
  const parsed = userRoleSchema.safeParse({ roleId: getFormString(formData, "roleId") });
  if (!parsed.success) {
    redirect(`/users/${id}?error=validation`);
  }

  const user = await getUserById(session, id);
  if (!user) {
    throw new Error("User not found.");
  }

  await requireTenantAccess(user.servicePartnerId);

  const role = await prisma.role.findFirst({
    where: {
      id: parsed.data.roleId,
      deletedAt: null,
      ...(session.user.isSuperAdmin ? {} : { servicePartnerId: session.user.servicePartnerId, scope: "TENANT" }),
    },
  });

  if (!role || role.servicePartnerId !== user.servicePartnerId) {
    throw new Error("Role not found.");
  }

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: id, roleId: role.id } },
    update: {},
    create: { userId: id, roleId: role.id },
  });

  await logActivity({
    action: "user.role_assign",
    module: "users",
    entityType: "USER",
    entityId: id,
    message: `Role assigned: ${role.key}`,
    servicePartnerId: user.servicePartnerId,
  });

  revalidateUserPaths(id);
  redirect(`/users/${id}?success=role-assigned`);
}

export async function removeUserRoleAction(id: string, formData: FormData) {
  const session = await requireAnyPermission(["roles.assign", "users.roles.assign"]);
  const parsed = userRoleSchema.safeParse({ roleId: getFormString(formData, "roleId") });
  if (!parsed.success) {
    redirect(`/users/${id}?error=validation`);
  }

  const user = await getUserById(session, id);
  if (!user) {
    throw new Error("User not found.");
  }

  await requireTenantAccess(user.servicePartnerId);

  const role = await prisma.role.findFirst({
    where: {
      id: parsed.data.roleId,
      deletedAt: null,
      ...(session.user.isSuperAdmin ? {} : { servicePartnerId: session.user.servicePartnerId, scope: "TENANT" }),
    },
  });

  if (!role || role.servicePartnerId !== user.servicePartnerId) {
    throw new Error("Role not found.");
  }

  try {
    if (id === session.user.id && role.key === "super_admin") {
      const ownSuperAdminRoles = await countUserSuperAdminRoles(id);
      if (ownSuperAdminRoles <= 1) {
        throw new Error("Cannot remove your own last super admin role.");
      }
    }

    await prisma.userRole.deleteMany({ where: { userId: id, roleId: parsed.data.roleId } });

    await logActivity({
      action: "user.role_remove",
      module: "users",
      entityType: "USER",
      entityId: id,
      message: `Role removed: ${role.key}`,
      servicePartnerId: user.servicePartnerId,
    });

    revalidateUserPaths(id);
    redirect(`/users/${id}?success=role-removed`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot remove your own last super admin role")) {
      redirect(`/users/${id}?error=self-lockout`);
    }
    throw error;
  }
}
