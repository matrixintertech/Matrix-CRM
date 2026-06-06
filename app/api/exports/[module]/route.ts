import { NextRequest, NextResponse } from "next/server";

import { getExportPermissionKey, getExportRows, type ExportModuleKey } from "@/features/export/services/export.service";
import { getCurrentSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { buildCsv } from "@/lib/export/csv";
import { buildExcelWorkbook } from "@/lib/export/excel";
import { buildPdfDocument } from "@/lib/export/pdf";
import { measureServerTiming, withServerTimingHeaders, type ServerTimingMetric } from "@/lib/observability/server-timing";

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
  const metrics: ServerTimingMetric[] = [];
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
  const timedRows = await measureServerTiming("export-rows", () => getExportRows(session as never, moduleKey, request.nextUrl.searchParams), "export rows");
  const rows = timedRows.result;
  metrics.push(timedRows.metric);
  const filenameBase = `${moduleKey}-${new Date().toISOString().slice(0, 10)}`;

  if (format === "excel") {
    const timedWorkbook = await measureServerTiming("export-excel", async () => buildExcelWorkbook(rows, moduleKey), "excel build");
    const workbook = timedWorkbook.result;
    metrics.push(timedWorkbook.metric);
    return new NextResponse(workbook, {
      headers: withServerTimingHeaders({
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.xls"`,
      }, metrics),
    });
  }

  if (format === "pdf") {
    const timedPdf = await measureServerTiming("export-pdf", async () => buildPdfDocument(moduleKey, rows), "pdf build");
    const pdf = timedPdf.result;
    metrics.push(timedPdf.metric);
    return new NextResponse(pdf, {
      headers: withServerTimingHeaders({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
      }, metrics),
    });
  }

  const timedCsv = await measureServerTiming("export-csv", async () => buildCsv(rows), "csv build");
  metrics.push(timedCsv.metric);

  return new NextResponse(timedCsv.result, {
    headers: withServerTimingHeaders({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    }, metrics),
  });
}
