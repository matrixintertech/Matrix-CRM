"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createVendor,
  getServicePartnerIdForVendorWrite,
  getVendorById,
  softDeleteVendor,
  updateVendor,
  updateVendorStatus,
} from "@/features/vendors/services/vendor.service";
import { vendorStatusSchema, vendorUpsertSchema } from "@/features/vendors/validations";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseVendorInput(formData: FormData) {
  return vendorUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    email: getFormString(formData, "email"),
    phone: getFormString(formData, "phone"),
    status: getFormString(formData, "status"),
    isVerified: getFormString(formData, "isVerified"),
    gstNumber: getFormString(formData, "gstNumber"),
    panNumber: getFormString(formData, "panNumber"),
    address: getFormString(formData, "address"),
    city: getFormString(formData, "city"),
    state: getFormString(formData, "state"),
    country: getFormString(formData, "country"),
    postalCode: getFormString(formData, "postalCode"),
    vendorType: getFormString(formData, "vendorType"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidateVendorPaths(vendorId: string) {
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
}

export async function createVendorAction(formData: FormData) {
  const session = await requirePermission("vendors.create");
  const parsed = parseVendorInput(formData);

  if (!parsed.success) {
    redirect("/vendors/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForVendorWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/vendors/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const vendor = await createVendor(session, parsed.data);
    await logActivity({
      action: "vendor.create",
      module: "vendors",
      entityType: "OTHER",
      entityId: vendor.id,
      message: "Vendor created",
      metadata: {
        code: vendor.code,
        status: vendor.status,
      },
      servicePartnerId: vendor.servicePartnerId,
    });

    revalidatePath("/vendors");
    redirect(`/vendors/${vendor.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/vendors/new?error=duplicate");
    }
    throw error;
  }
}

export async function updateVendorAction(id: string, formData: FormData) {
  const session = await requirePermission("vendors.update");
  const parsed = parseVendorInput(formData);

  if (!parsed.success) {
    redirect(`/vendors/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForVendorWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/vendors/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const vendor = await updateVendor(session, id, parsed.data);
    await logActivity({
      action: "vendor.update",
      module: "vendors",
      entityType: "OTHER",
      entityId: vendor.id,
      message: "Vendor updated",
      metadata: {
        code: vendor.code,
        status: vendor.status,
      },
      servicePartnerId: vendor.servicePartnerId,
    });

    revalidateVendorPaths(vendor.id);
    redirect(`/vendors/${vendor.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/vendors/${id}/edit?error=duplicate`);
    }
    throw error;
  }
}

export async function updateVendorStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("vendors.update");
  const parsed = vendorStatusSchema.safeParse({
    status: getFormString(formData, "status"),
    isVerified: getFormString(formData, "isVerified"),
  });

  if (!parsed.success) {
    redirect(`/vendors/${id}?error=validation`);
  }

  const vendor = await getVendorById(session, id);
  if (!vendor) {
    throw new Error("Vendor not found.");
  }

  await requireTenantAccess(vendor.servicePartnerId);

  await updateVendorStatus(id, parsed.data.status, parsed.data.isVerified);
  await logActivity({
    action: "vendor.status_change",
    module: "vendors",
    entityType: "OTHER",
    entityId: id,
    message: `Vendor status changed to ${parsed.data.status}`,
    metadata: {
      status: parsed.data.status,
      isVerified: parsed.data.isVerified ?? vendor.isVerified,
    },
    servicePartnerId: vendor.servicePartnerId,
  });

  revalidateVendorPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/vendors/${id}`));
}

export async function deleteVendorAction(id: string, formData: FormData) {
  const session = await requirePermission("vendors.delete");
  const vendor = await getVendorById(session, id);

  if (!vendor) {
    throw new Error("Vendor not found.");
  }

  await requireTenantAccess(vendor.servicePartnerId);

  await softDeleteVendor(id);
  await logActivity({
    action: "vendor.delete",
    module: "vendors",
    entityType: "OTHER",
    entityId: id,
    message: "Vendor soft deleted",
    servicePartnerId: vendor.servicePartnerId,
  });

  revalidateVendorPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/vendors?success=deleted"));
}
