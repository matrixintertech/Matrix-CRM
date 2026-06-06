import type { ReactNode } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";

type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  rows: T[];
  columns: Column<T>[];
  getRowHref?: (row: T) => string;
  getRowKey: (row: T) => string;
};

export function DataTable<T>({ rows, columns, getRowHref, getRowKey }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#dbe5f4] bg-white shadow-[0_12px_30px_rgba(18,49,105,0.06)]">
      <div className="crm-mobile-card-grid border-b border-[#edf2fb] p-3 md:hidden">
        {rows.map((row) => {
          const rowKey = getRowKey(row);
          const href = getRowHref?.(row);
          const primaryColumn = columns[0];

          return (
            <article key={rowKey} className="crm-mobile-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8eaf]">{primaryColumn?.header}</p>
                  <div className="mt-2 min-w-0 text-sm font-semibold text-[#10254b]">{primaryColumn?.cell(row)}</div>
                </div>
                {href ? (
                  <PrefetchLink
                    href={href}
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-[#dbe5f4] px-3 text-sm font-semibold text-[#2854e8]"
                  >
                    Open
                  </PrefetchLink>
                ) : null}
              </div>

              {columns.length > 1 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {columns.slice(1).map((column) => (
                    <div key={column.header} className="min-w-0 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7d8eaf]">{column.header}</p>
                      <div className="min-w-0 text-sm text-[#10254b]">{column.cell(row)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="crm-scroll-shell hidden md:block">
        <table className="min-w-full divide-y divide-[#e8eef8] text-sm">
          <thead className="bg-[#f7faff] text-left text-[11px] uppercase tracking-[0.16em] text-[#627aa6]">
            <tr>
              {columns.map((column) => (
                <th key={column.header} className={`whitespace-nowrap px-5 py-3.5 font-semibold ${column.className ?? ""}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf2fb]">
            {rows.map((row) => {
              const content = columns.map((column) => (
                <td key={column.header} className={`px-5 py-4 align-top text-[#10254b] ${column.className ?? ""}`}>
                  {column.cell(row)}
                </td>
              ));

              const rowKey = getRowKey(row);
              const href = getRowHref?.(row);

              return (
                <tr key={rowKey} className="transition hover:bg-[#f7faff]">
                  {href ? (
                    <>
                      {columns.map((column, index) => (
                        <td key={column.header} className={`px-5 py-4 align-top text-[#10254b] ${column.className ?? ""}`}>
                          <PrefetchLink href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9db4ff]">
                            {column.cell(row)}
                            {index === 0 ? <span className="sr-only">Open details</span> : null}
                          </PrefetchLink>
                        </td>
                      ))}
                    </>
                  ) : (
                    content
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
