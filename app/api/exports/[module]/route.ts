import { NextRequest, NextResponse } from "next/server";

import { getExportPermissionKey, getExportRows, type ExportModuleKey } from "@/features/export/services/export.service";
import { getCurrentSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { buildCsv } from "@/lib/export/csv";
import { buildExcelWorkbook } from "@/lib/export/excel";
import { buildPdfDocument } from "@/lib/export/pdf";

const supportedModules = new Set<ExportModuleKey>([
  "activity-logs",
  "clients",
  "service-requests",
  "tasks",
  "quotations",
  "purchase-orders",
  "invoices",
  "payments",
  "ledger",
  "vendor-payments",
  "finance-reports",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ module: string }> }
) {
  const session = await getCurrentSession();
  if (!session?.user?.id || !session.user.servicePartnerId) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  const { module } = await params;
  if (!supportedModules.has(module as ExportModuleKey)) {
    return NextResponse.json({ ok: false, error: { message: "Unsupported export module." } }, { status: 404 });
  }

  const moduleKey = module as ExportModuleKey;
  const permissionKey = getExportPermissionKey(moduleKey);
  const allowed = await hasPermission(session as never, permissionKey);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: { message: "Export permission denied." } }, { status: 403 });
  }

  const format = request.nextUrl.searchParams.get("format") ?? "csv";
  const rows = await getExportRows(session as never, moduleKey, request.nextUrl.searchParams);
  const filenameBase = `${moduleKey}-${new Date().toISOString().slice(0, 10)}`;

  if (format === "excel") {
    const workbook = buildExcelWorkbook(rows, moduleKey);
    return new NextResponse(workbook, {
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.xls"`,
      },
    });
  }

  if (format === "pdf") {
    const pdf = buildPdfDocument(moduleKey, rows);
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
      },
    });
  }

  return new NextResponse(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
