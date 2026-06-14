import Link from "next/link";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { listUoms } from "@/features/uoms/services/uom.service";

type UomsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "UOM created successfully.";
  }
  if (code === "created-all") {
    return "UOM created for all service partners.";
  }
  return undefined;
}

export default async function UomsPage({ searchParams }: UomsPageProps) {
  const session = await requirePermission("items.read");
  const [params, canCreate] = await Promise.all([resolveSearchParams(searchParams), hasPermission(session, "items.create")]);
  const q = getStringParam(params, "q");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));
  const uoms = await listUoms(session, { q });

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-[#10244b]">Unit of Measurement</h1>
          <p className="mt-2 text-sm text-[#7082a6]">Manage reusable UOM masters for item creation.</p>
        </div>
        {canCreate ? (
          <PrefetchLink href="/uoms/new" className="inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)]">
            Add UOM
          </PrefetchLink>
        ) : null}
      </div>

      <div>
        <Link href="/items" className="text-sm text-[var(--muted)] underline">
          Back to items
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="rounded-[24px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <form action="" className="flex flex-col gap-3 sm:flex-row">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search UOMs..."
            className="h-11 flex-1 rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
          />
          <button type="submit" className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d9e3ff] bg-[#f7f9ff] px-5 text-sm font-semibold text-[#315cff]">
            Apply
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <table className="min-w-full text-left">
          <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
            <tr>
              <th className="px-5 py-4">Code</th>
              <th className="px-4 py-4">Name</th>
              <th className="px-4 py-4">Symbol</th>
              <th className="px-4 py-4">Company</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4">Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf2fb]">
            {uoms.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-[#7486a8]">
                  No UOMs found.
                </td>
              </tr>
            ) : (
              uoms.map((uom) => (
                <tr key={uom.id} className="transition hover:bg-[#fbfcff]">
                  <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{uom.code}</td>
                  <td className="px-4 py-4 text-sm text-[#122449]">{uom.name}</td>
                  <td className="px-4 py-4 text-sm text-[#24406f]">{uom.symbol}</td>
                  <td className="px-4 py-4 text-sm text-[#24406f]">
                    {uom.servicePartner.name} ({uom.servicePartner.code})
                  </td>
                  <td className="px-4 py-4 text-sm text-[#24406f]">{uom.active ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-4 text-sm text-[#24406f]">{uom._count.items}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
