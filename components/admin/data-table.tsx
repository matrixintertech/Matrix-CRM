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
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.header} className={`px-4 py-3 font-medium ${column.className ?? ""}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const content = columns.map((column) => (
                <td key={column.header} className={`px-4 py-3 align-top ${column.className ?? ""}`}>
                  {column.cell(row)}
                </td>
              ));

              const rowKey = getRowKey(row);
              const href = getRowHref?.(row);

              return (
                <tr key={rowKey} className="hover:bg-slate-50">
                  {href ? (
                    <>
                      {columns.map((column, index) => (
                        <td key={column.header} className={`px-4 py-3 align-top ${column.className ?? ""}`}>
                          <Link href={href} className="block">
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
