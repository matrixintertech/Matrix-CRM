"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import {
  createClient,
  getClientById,
  getServicePartnerIdForClientWrite,
  softDeleteClient,
  updateClient,
  updateClientStatus,
} from "@/features/clients/services/client.service";
import { clientStatusSchema, clientUpsertSchema } from "@/features/clients/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseClientInput(formData: FormData) {
  return clientUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    legalName: getFormString(formData, "legalName"),
    email: getFormString(formData, "email"),
    phone: getFormString(formData, "phone"),
    address: getFormString(formData, "address"),
    city: getFormString(formData, "city"),
    state: getFormString(formData, "state"),
    country: getFormString(formData, "country"),
    postalCode: getFormString(formData, "postalCode"),
    status: getFormString(formData, "status"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidateClientPaths(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function createClientAction(formData: FormData) {
  const session = await requirePermission("clients.create");
  const parsed = parseClientInput(formData);

  if (!parsed.success) {
    redirect("/clients/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForClientWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/clients/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const client = await createClient(session, parsed.data);
    await logActivity({
      action: "client.create",
      module: "clients",
      entityType: "CLIENT",
      entityId: client.id,
      message: "Client created",
      servicePartnerId: client.servicePartnerId,
    });
    revalidatePath("/clients");
    redirect(`/clients/${client.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/clients/new?error=duplicate");
    }
    throw error;
  }
}

export async function updateClientAction(id: string, formData: FormData) {
  const session = await requirePermission("clients.update");
  const parsed = parseClientInput(formData);

  if (!parsed.success) {
    redirect(`/clients/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForClientWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/clients/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const client = await updateClient(session, id, parsed.data);
    await logActivity({
      action: "client.update",
      module: "clients",
      entityType: "CLIENT",
      entityId: client.id,
      message: "Client updated",
      servicePartnerId: client.servicePartnerId,
    });
    revalidateClientPaths(client.id);
    redirect(`/clients/${client.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/clients/${id}/edit?error=duplicate`);
    }
    throw error;
  }
}

export async function updateClientStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("clients.update");
  const parsed = clientStatusSchema.safeParse({ status: getFormString(formData, "status") });

  if (!parsed.success) {
    redirect(`/clients/${id}?error=validation`);
  }

  const client = await getClientById(session, id);
  if (!client) {
    throw new Error("Client not found.");
  }

  await requireTenantAccess(client.servicePartnerId);

  await updateClientStatus(id, parsed.data.status);
  await logActivity({
    action: "client.status_change",
    module: "clients",
    entityType: "CLIENT",
    entityId: id,
    message: `Client status changed to ${parsed.data.status}`,
    servicePartnerId: client.servicePartnerId,
  });

  revalidateClientPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/clients/${id}`));
}

export async function deleteClientAction(id: string, formData: FormData) {
  const session = await requirePermission("clients.delete");
  const client = await getClientById(session, id);

  if (!client) {
    throw new Error("Client not found.");
  }

  await requireTenantAccess(client.servicePartnerId);

  await softDeleteClient(id);
  await logActivity({
    action: "client.delete",
    module: "clients",
    entityType: "CLIENT",
    entityId: id,
    message: "Client soft deleted",
    servicePartnerId: client.servicePartnerId,
  });

  revalidateClientPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/clients?success=deleted"));
}
