import Link from "next/link";
import type { ReactNode } from "react";

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
      <div className="overflow-x-auto">
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
                          <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9db4ff]">
                            {column.cell(row)}
                            {index === 0 ? <span className="sr-only">Open details</span> : null}
                          </Link>
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
