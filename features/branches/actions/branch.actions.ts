"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import {
  createBranch,
  getBranchById,
  getServicePartnerIdForBranchWrite,
  softDeleteBranch,
  updateBranch,
} from "@/features/branches/services/branch.service";
import { branchUpsertSchema } from "@/features/branches/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseBranchInput(formData: FormData) {
  return branchUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    clientId: getFormString(formData, "clientId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    address: getFormString(formData, "address"),
    city: getFormString(formData, "city"),
    state: getFormString(formData, "state"),
    country: getFormString(formData, "country"),
    postalCode: getFormString(formData, "postalCode"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isClientTenantError(error: unknown) {
  return error instanceof Error && (error.message.includes("mismatch") || error.message.includes("Client not found"));
}

function revalidateBranchPaths(branchId: string) {
  revalidatePath("/branches");
  revalidatePath(`/branches/${branchId}`);
}

export async function createBranchAction(formData: FormData) {
  const session = await requirePermission("branches.create");
  const parsed = parseBranchInput(formData);

  if (!parsed.success) {
    redirect("/branches/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForBranchWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/branches/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const branch = await createBranch(session, parsed.data);
    await logActivity({
      action: "branch.create",
      module: "branches",
      entityType: "OTHER",
      entityId: branch.id,
      message: "Branch created",
      servicePartnerId: branch.servicePartnerId,
    });
    revalidatePath("/branches");
    redirect(`/branches/${branch.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/branches/new?error=duplicate");
    }
    if (isClientTenantError(error)) {
      redirect("/branches/new?error=mismatch");
    }
    throw error;
  }
}

export async function updateBranchAction(id: string, formData: FormData) {
  const session = await requirePermission("branches.update");
  const parsed = parseBranchInput(formData);

  if (!parsed.success) {
    redirect(`/branches/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForBranchWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/branches/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const branch = await updateBranch(session, id, parsed.data);
    await logActivity({
      action: "branch.update",
      module: "branches",
      entityType: "OTHER",
      entityId: branch.id,
      message: "Branch updated",
      servicePartnerId: branch.servicePartnerId,
    });
    revalidateBranchPaths(branch.id);
    redirect(`/branches/${branch.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/branches/${id}/edit?error=duplicate`);
    }
    if (isClientTenantError(error)) {
      redirect(`/branches/${id}/edit?error=mismatch`);
    }
    throw error;
  }
}

export async function deleteBranchAction(id: string, formData: FormData) {
  const session = await requirePermission("branches.delete");
  const branch = await getBranchById(session, id);

  if (!branch) {
    throw new Error("Branch not found.");
  }

  await requireTenantAccess(branch.servicePartnerId);

  await softDeleteBranch(id);
  await logActivity({
    action: "branch.delete",
    module: "branches",
    entityType: "OTHER",
    entityId: id,
    message: "Branch soft deleted",
    servicePartnerId: branch.servicePartnerId,
  });

  revalidateBranchPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/branches?success=deleted"));
}
