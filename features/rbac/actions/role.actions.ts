"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import {
  assignPermissionToRole,
  createRole,
  getServicePartnerIdForRoleWrite,
  replaceRolePermissions,
  removePermissionFromRole,
  softDeleteRole,
  updateRole,
} from "@/features/rbac/services/role.service";
import { rolePermissionSchema, roleUpsertSchema } from "@/features/rbac/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseRoleInput(formData: FormData) {
  return roleUpsertSchema.safeParse({
    name: getFormString(formData, "name"),
    key: getFormString(formData, "key"),
    description: getFormString(formData, "description"),
    scope: getFormString(formData, "scope"),
    servicePartnerId: getFormString(formData, "servicePartnerId"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidateRolePaths(roleId: string) {
  revalidatePath("/roles");
  revalidatePath(`/roles/${roleId}`);
}

export async function createRoleAction(formData: FormData) {
  const session = await requirePermission("roles.create");
  const parsed = parseRoleInput(formData);
  if (!parsed.success) {
    redirect("/roles/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForRoleWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/roles/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const role = await createRole(session, parsed.data);
    await logActivity({
      action: "role.create",
      module: "roles",
      entityType: "OTHER",
      entityId: role.id,
      message: "Role created",
      servicePartnerId: role.servicePartnerId,
    });
    revalidatePath("/roles");
    redirect(`/roles/${role.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/roles/new?error=duplicate");
    }
    throw error;
  }
}

export async function updateRoleAction(id: string, formData: FormData) {
  const session = await requirePermission("roles.update");
  const parsed = parseRoleInput(formData);
  if (!parsed.success) {
    redirect(`/roles/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForRoleWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/roles/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const role = await updateRole(session, id, parsed.data);
    await logActivity({
      action: "role.update",
      module: "roles",
      entityType: "OTHER",
      entityId: role.id,
      message: "Role updated",
      servicePartnerId: role.servicePartnerId,
    });
    revalidateRolePaths(role.id);
    redirect(`/roles/${role.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/roles/${id}/edit?error=duplicate`);
    }
    if (
      error instanceof Error &&
      (error.message.includes("cannot be edited") || error.message.includes("System roles cannot be edited"))
    ) {
      redirect(`/roles/${id}?error=protected`);
    }
    throw error;
  }
}

export async function deleteRoleAction(id: string, formData: FormData) {
  const session = await requirePermission("roles.delete");

  try {
    const role = await softDeleteRole(session, id);
    await logActivity({
      action: "role.delete",
      module: "roles",
      entityType: "OTHER",
      entityId: role.id,
      message: "Role soft deleted",
      servicePartnerId: role.servicePartnerId,
    });
    revalidateRolePaths(role.id);
    redirect(getSafeRedirectPath(formData.get("redirectTo"), "/roles?success=deleted"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("Protected role")) {
      redirect(`/roles/${id}?error=protected`);
    }
    throw error;
  }
}

export async function assignRolePermissionAction(roleId: string, formData: FormData) {
  const session = await requirePermission("roles.assign");
  const parsed = rolePermissionSchema.safeParse({ permissionId: getFormString(formData, "permissionId") });
  if (!parsed.success) {
    redirect(`/roles/${roleId}?error=validation`);
  }

  try {
    const { role, permission } = await assignPermissionToRole(session, roleId, parsed.data.permissionId);
    await logActivity({
      action: "role.permission_assign",
      module: "roles",
      entityType: "OTHER",
      entityId: role.id,
      message: `Permission assigned: ${permission.key}`,
      servicePartnerId: role.servicePartnerId,
    });
    revalidateRolePaths(role.id);
    redirect(`/roles/${role.id}?success=permission-assigned`);
  } catch (error) {
    if (error instanceof Error && (error.message.includes("protected") || error.message.includes("cannot grant"))) {
      redirect(`/roles/${roleId}?error=protected`);
    }
    throw error;
  }
}

export async function removeRolePermissionAction(roleId: string, formData: FormData) {
  const session = await requirePermission("roles.assign");
  const parsed = rolePermissionSchema.safeParse({ permissionId: getFormString(formData, "permissionId") });
  if (!parsed.success) {
    redirect(`/roles/${roleId}?error=validation`);
  }

  try {
    const { role, permission } = await removePermissionFromRole(session, roleId, parsed.data.permissionId);
    await logActivity({
      action: "role.permission_remove",
      module: "roles",
      entityType: "OTHER",
      entityId: role.id,
      message: `Permission removed: ${permission.key}`,
      servicePartnerId: role.servicePartnerId,
    });
    revalidateRolePaths(role.id);
    redirect(`/roles/${role.id}?success=permission-removed`);
  } catch (error) {
    if (error instanceof Error && (error.message.includes("protected") || error.message.includes("cannot grant"))) {
      redirect(`/roles/${roleId}?error=protected`);
    }
    throw error;
  }
}

export async function updateRolePermissionsAction(roleId: string, formData: FormData) {
  const session = await requirePermission("roles.assign");
  const permissionIds = formData
    .getAll("permissionIds")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  try {
    const role = await replaceRolePermissions(session, roleId, permissionIds);
    await logActivity({
      action: "role.permissions_replace",
      module: "roles",
      entityType: "OTHER",
      entityId: role.id,
      message: `Role permissions updated (${permissionIds.length} selected)`,
      servicePartnerId: role.servicePartnerId,
    });
    revalidateRolePaths(role.id);
    redirect(`/roles/${role.id}?success=permission-updated`);
  } catch (error) {
    if (error instanceof Error && (error.message.includes("protected") || error.message.includes("cannot grant"))) {
      redirect(`/roles/${roleId}?error=protected`);
    }
    throw error;
  }
}
