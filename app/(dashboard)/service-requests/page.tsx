import { ServiceRequestStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { ServiceRequestsTable } from "@/features/service-requests/components/service-requests-table";
import {
  listBranchesForServiceRequestForm,
  listClientsForServiceRequestForm,
  listServiceRequests,
} from "@/features/service-requests/services/service-request.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type ServiceRequestsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Service request deleted successfully.";
  }
  return undefined;
}

export default async function ServiceRequestsPage({ searchParams }: ServiceRequestsPageProps) {
  const session = await requirePermission("service_requests.read");
  const [params, canCreate] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "service_requests.create"),
  ]);

  const q = getStringParam(params, "q");
  const clientId = getStringParam(params, "clientId");
  const branchId = getStringParam(params, "branchId");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(ServiceRequestStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, clients, branches] = await Promise.all([
    listServiceRequests(session, { q, status, clientId, branchId, page, pageSize }),
    listClientsForServiceRequestForm(session),
    listBranchesForServiceRequestForm(session, undefined, clientId),
  ]);

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (status) {
      next.set("status", status);
    }
    if (clientId) {
      next.set("clientId", clientId);
    }
    if (branchId) {
      next.set("branchId", branchId);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/service-requests?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Service Requests"
        description="Manage tenant-scoped service requests, status transitions, and timeline history."
        action={canCreate ? { label: "New service request", href: "/service-requests/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <form
        className="grid gap-2 rounded-2xl border border-[#d8e3f4] bg-white p-3 shadow-[0_8px_24px_rgba(25,56,120,0.04)] md:grid-cols-5"
        action=""
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by number, title, client, branch, or type"
          className="h-10 min-w-0 rounded-xl border border-[#d2def1] bg-[#fcfdff] px-3 text-sm text-[#15305f] placeholder:text-[#8aa0c7] focus:border-[#3f64ff] focus:outline-none md:col-span-2"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-10 rounded-xl border border-[#d2def1] bg-[#fcfdff] px-3 text-sm text-[#15305f] focus:border-[#3f64ff] focus:outline-none"
        >
          <option value="">All statuses</option>
          {Object.values(ServiceRequestStatus).map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {statusValue}
            </option>
          ))}
        </select>
        <select
          name="clientId"
          defaultValue={clientId ?? ""}
          className="h-10 rounded-xl border border-[#d2def1] bg-[#fcfdff] px-3 text-sm text-[#15305f] focus:border-[#3f64ff] focus:outline-none"
        >
          <option value="">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name} ({client.code})
            </option>
          ))}
        </select>
        <select
          name="branchId"
          defaultValue={branchId ?? ""}
          className="h-10 rounded-xl border border-[#d2def1] bg-[#fcfdff] px-3 text-sm text-[#15305f] focus:border-[#3f64ff] focus:outline-none"
        >
          <option value="">All branches</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name} ({branch.code})
            </option>
          ))}
        </select>
        <div className="md:col-span-5">
          <button
            type="submit"
            className="h-10 rounded-xl border border-[#2f5ef8] bg-[#f4f7ff] px-4 text-sm font-semibold text-[#2754ef] transition hover:bg-[#ebf0ff]"
          >
            Apply
          </button>
        </div>
      </form>

      {result.serviceRequests.length === 0 ? (
        <EmptyState title="No service requests found" description="Try adjusting filters or create a new request." />
      ) : (
        <>
          <ServiceRequestsTable serviceRequests={result.serviceRequests} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} service requests)
            </p>
            <div className="flex items-center gap-2">
              {result.page > 1 ? (
                <Link href={buildPageHref(result.page - 1)} className="rounded-md border border-slate-200 px-3 py-2">
                  Previous
                </Link>
              ) : null}
              {result.page < result.totalPages ? (
                <Link href={buildPageHref(result.page + 1)} className="rounded-md border border-slate-200 px-3 py-2">
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
