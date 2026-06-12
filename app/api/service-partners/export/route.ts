import { NextRequest, NextResponse } from "next/server";
import { ServicePartnerStatus } from "@prisma/client";

import { exportServicePartners, SERVICE_PARTNER_ONBOARDING_STAGES } from "@/features/service-partners/services/service-partner.service";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentSession, getCurrentUser } from "@/lib/auth/session";
import { buildCsv } from "@/lib/export/csv";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.user?.id || !session.user.servicePartnerId) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  const currentUser = await getCurrentUser(session);
  if (!currentUser) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  const allowed = await hasPermission(session as never, "service_partners.read");
  if (!allowed) {
    return NextResponse.json({ ok: false, error: { message: "Export permission denied." } }, { status: 403 });
  }

  const statusParam = request.nextUrl.searchParams.get("status");
  const status = Object.values(ServicePartnerStatus).find((value) => value === statusParam);
  const onboardingStageParam = request.nextUrl.searchParams.get("onboardingStage");
  const onboardingStage = SERVICE_PARTNER_ONBOARDING_STAGES.includes(
    onboardingStageParam as (typeof SERVICE_PARTNER_ONBOARDING_STAGES)[number]
  )
    ? (onboardingStageParam as (typeof SERVICE_PARTNER_ONBOARDING_STAGES)[number])
    : undefined;

  const rows = await exportServicePartners(session as never, {
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    status,
    state: request.nextUrl.searchParams.get("state") ?? undefined,
    city: request.nextUrl.searchParams.get("city") ?? undefined,
    onboardingStage,
  });

  return new NextResponse(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="service-partners-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
