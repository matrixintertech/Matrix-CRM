import Link from "next/link";

import type { ExportModuleKey } from "@/features/export/services/export.service";

type ExportActionsProps = {
  moduleKey: ExportModuleKey;
  query?: Record<string, string | undefined>;
};

function buildHref(moduleKey: ExportModuleKey, format: "csv" | "excel" | "pdf", query?: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  params.set("format", format);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) {
      params.set(key, value);
    }
  }

  return `/api/exports/${moduleKey}?${params.toString()}`;
}

export function ExportActions({ moduleKey, query }: ExportActionsProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Link href={buildHref(moduleKey, "csv", query)} prefetch={false} className="rounded-xl border border-[var(--border)] px-3 py-2.5 text-center text-sm font-medium">
        Export CSV
      </Link>
      <Link href={buildHref(moduleKey, "excel", query)} prefetch={false} className="rounded-xl border border-[var(--border)] px-3 py-2.5 text-center text-sm font-medium">
        Export Excel
      </Link>
      <Link href={buildHref(moduleKey, "pdf", query)} prefetch={false} className="rounded-xl border border-[var(--border)] px-3 py-2.5 text-center text-sm font-medium">
        Export PDF
      </Link>
    </div>
  );
}
