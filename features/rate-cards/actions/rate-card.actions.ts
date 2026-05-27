"use server";

import { Prisma, RateCardStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createRateCard,
  getRateCardById,
  getServicePartnerIdForRateCardWrite,
  softDeleteRateCard,
  summarizeRateCardLines,
  updateRateCard,
  updateRateCardStatus,
} from "@/features/rate-cards/services/rate-card.service";
import { rateCardStatusSchema, rateCardUpsertSchema } from "@/features/rate-cards/validations";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseLinesJson(formData: FormData) {
  const raw = getFormString(formData, "linesJson");
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

function parseRateCardInput(formData: FormData) {
  return rateCardUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    clientId: getFormString(formData, "clientId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    effectiveFrom: getFormString(formData, "effectiveFrom"),
    effectiveTo: getFormString(formData, "effectiveTo"),
    status: getFormString(formData, "status"),
    lines: parseLinesJson(formData),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isTenantMismatchError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("mismatch") ||
      error.message.includes("not found") ||
      error.message.includes("Duplicate item line"))
  );
}

function revalidateRateCardPaths(rateCardId: string) {
  revalidatePath("/rate-cards");
  revalidatePath(`/rate-cards/${rateCardId}`);
}

function asLineKey(line: { itemId: string; rate: number; taxPercent?: number | null }) {
  return `${line.itemId}:${line.rate}:${line.taxPercent ?? ""}`;
}

export async function createRateCardAction(formData: FormData) {
  const session = await requirePermission("rate_cards.create");
  const parsed = parseRateCardInput(formData);

  if (!parsed.success) {
    redirect("/rate-cards/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForRateCardWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/rate-cards/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const rateCard = await createRateCard(session, parsed.data);
    const summary = summarizeRateCardLines(parsed.data.lines);

    await logActivity({
      action: "rate_card.create",
      module: "rate_cards",
      entityType: "OTHER",
      entityId: rateCard.id,
      message: "Rate card created",
      metadata: { lineCount: summary.lineCount, totalRate: summary.totalRate },
      servicePartnerId: rateCard.servicePartnerId,
    });

    for (const line of parsed.data.lines) {
      await logActivity({
        action: "rate_card.line_add",
        module: "rate_cards",
        entityType: "OTHER",
        entityId: rateCard.id,
        message: `Rate card line added for item ${line.itemId}`,
        metadata: { itemId: line.itemId, rate: line.rate, taxPercent: line.taxPercent ?? null },
        servicePartnerId: rateCard.servicePartnerId,
      });
    }

    revalidatePath("/rate-cards");
    redirect(`/rate-cards/${rateCard.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/rate-cards/new?error=duplicate");
    }
    if (isTenantMismatchError(error)) {
      redirect("/rate-cards/new?error=mismatch");
    }
    throw error;
  }
}

export async function updateRateCardAction(id: string, formData: FormData) {
  const session = await requirePermission("rate_cards.update");
  const parsed = parseRateCardInput(formData);

  if (!parsed.success) {
    redirect(`/rate-cards/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForRateCardWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/rate-cards/${id}/edit?error=service-partner`);
  }

  const existing = await getRateCardById(session, id);
  if (!existing) {
    throw new Error("Rate card not found.");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const rateCard = await updateRateCard(session, id, parsed.data);
    const summary = summarizeRateCardLines(parsed.data.lines);

    await logActivity({
      action: "rate_card.update",
      module: "rate_cards",
      entityType: "OTHER",
      entityId: rateCard.id,
      message: "Rate card updated",
      metadata: { lineCount: summary.lineCount, totalRate: summary.totalRate },
      servicePartnerId: rateCard.servicePartnerId,
    });

    const beforeLines = new Map(
      existing.lines.map((line) => [
        line.itemId,
        {
          itemId: line.itemId,
          rate: Number(line.rate),
          taxPercent: line.taxPercent === null ? null : Number(line.taxPercent),
        },
      ])
    );
    const afterLines = new Map(parsed.data.lines.map((line) => [line.itemId, line]));

    for (const [itemId, line] of afterLines.entries()) {
      if (!beforeLines.has(itemId)) {
        await logActivity({
          action: "rate_card.line_add",
          module: "rate_cards",
          entityType: "OTHER",
          entityId: rateCard.id,
          message: `Rate card line added for item ${itemId}`,
          metadata: { itemId, rate: line.rate, taxPercent: line.taxPercent ?? null },
          servicePartnerId: rateCard.servicePartnerId,
        });
        continue;
      }

      const before = beforeLines.get(itemId);
      if (!before) {
        continue;
      }

      if (asLineKey(before) !== asLineKey(line)) {
        await logActivity({
          action: "rate_card.line_update",
          module: "rate_cards",
          entityType: "OTHER",
          entityId: rateCard.id,
          message: `Rate card line updated for item ${itemId}`,
          metadata: {
            itemId,
            previousRate: before.rate,
            previousTaxPercent: before.taxPercent,
            rate: line.rate,
            taxPercent: line.taxPercent ?? null,
          },
          servicePartnerId: rateCard.servicePartnerId,
        });
      }
    }

    for (const [itemId, line] of beforeLines.entries()) {
      if (afterLines.has(itemId)) {
        continue;
      }
      await logActivity({
        action: "rate_card.line_delete",
        module: "rate_cards",
        entityType: "OTHER",
        entityId: rateCard.id,
        message: `Rate card line removed for item ${itemId}`,
        metadata: { itemId, rate: line.rate, taxPercent: line.taxPercent ?? null },
        servicePartnerId: rateCard.servicePartnerId,
      });
    }

    revalidateRateCardPaths(rateCard.id);
    redirect(`/rate-cards/${rateCard.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/rate-cards/${id}/edit?error=duplicate`);
    }
    if (isTenantMismatchError(error)) {
      redirect(`/rate-cards/${id}/edit?error=mismatch`);
    }
    throw error;
  }
}

export async function updateRateCardStatusAction(id: string, formData: FormData) {
  const parsed = rateCardStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(`/rate-cards/${id}?error=validation`);
  }

  const session =
    parsed.data.status === RateCardStatus.ACTIVE
      ? await requirePermission("rate_cards.publish")
      : await requirePermission("rate_cards.update");
  const rateCard = await getRateCardById(session, id);

  if (!rateCard) {
    throw new Error("Rate card not found.");
  }

  await requireTenantAccess(rateCard.servicePartnerId);

  await updateRateCardStatus(id, parsed.data.status);
  await logActivity({
    action: "rate_card.status_change",
    module: "rate_cards",
    entityType: "OTHER",
    entityId: id,
    message: `Rate card status changed to ${parsed.data.status}`,
    metadata: { status: parsed.data.status },
    servicePartnerId: rateCard.servicePartnerId,
  });

  revalidateRateCardPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/rate-cards/${id}`));
}

export async function deleteRateCardAction(id: string, formData: FormData) {
  const session = await requirePermission("rate_cards.delete");
  const rateCard = await getRateCardById(session, id);

  if (!rateCard) {
    throw new Error("Rate card not found.");
  }

  await requireTenantAccess(rateCard.servicePartnerId);

  await softDeleteRateCard(id);
  await logActivity({
    action: "rate_card.delete",
    module: "rate_cards",
    entityType: "OTHER",
    entityId: id,
    message: "Rate card soft deleted",
    servicePartnerId: rateCard.servicePartnerId,
  });

  revalidateRateCardPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/rate-cards?success=deleted"));
}
