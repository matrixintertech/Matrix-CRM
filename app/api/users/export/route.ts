import { NextRequest, NextResponse } from "next/server";

import { exportUsers, normalizeUserManagementDateRange } from "@/features/users/services/user.service";
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

  const allowed = await hasPermission(session as never, "users.read");
  if (!allowed) {
    return NextResponse.json({ ok: false, error: { message: "Export permission denied." } }, { status: 403 });
  }

  const rows = await exportUsers(session as never, {
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    status: (request.nextUrl.searchParams.get("status") as never) ?? undefined,
    servicePartnerId: request.nextUrl.searchParams.get("servicePartnerId") ?? undefined,
    roleKey: request.nextUrl.searchParams.get("roleKey") ?? undefined,
    dateRange: normalizeUserManagementDateRange(request.nextUrl.searchParams.get("dateRange") ?? undefined),
  });

  return new NextResponse(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
