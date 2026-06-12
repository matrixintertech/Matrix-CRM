import type { ReactNode } from "react";

import { VendorStatus } from "@prisma/client";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { deleteVendorAction } from "@/features/vendors/actions/vendor.actions";
import {
  getVendorOverview,
  listVendorTypeOptions,
  listVendors,
} from "@/features/vendors/services/vendor.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type VendorsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type VendorsResult = Awaited<ReturnType<typeof listVendors>>;
type VendorRow = VendorsResult["vendors"][number];

const pageSizeOptions = [8, 16, 24];

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Vendor deleted successfully.";
  }
  return undefined;
}

function buildVendorsHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/vendors?${query}` : "/vendors";
}

function getPageTokens(page: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: Array<number | string> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    tokens.push("left-gap");
  }

  for (let current = start; current <= end; current += 1) {
    tokens.push(current);
  }

  if (end < totalPages - 1) {
    tokens.push("right-gap");
  }

  tokens.push(totalPages);
  return tokens;
}

function formatRelativeUpdate(value: Date | null) {
  if (!value) {
    return "No recent updates";
  }

  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes < 60) {
    return `Last updated: ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Last updated: ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Last updated: ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatShortDate(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function getStatusMeta(status: VendorStatus) {
  if (status === "ACTIVE") {
    return {
      label: "Active",
      tone: "bg-[#eaf8ef] text-[#1d9d57]",
    };
  }
  if (status === "PENDING_VERIFICATION") {
    return {
      label: "Pending",
      tone: "bg-[#fff4e5] text-[#e7881d]",
    };
  }
  if (status === "INACTIVE") {
    return {
      label: "Inactive",
      tone: "bg-[#fff1f1] text-[#ff4f5e]",
    };
  }
  return {
    label: "Rejected",
    tone: "bg-[#f3eaff] text-[#8d5bff]",
  };
}

function getAvatarTone(value: string) {
  const tones = [
    "from-[#5b5df8] to-[#4137d8]",
    "from-[#1f9bf0] to-[#1a77f2]",
    "from-[#11b981] to-[#149c67]",
    "from-[#f97316] to-[#ea580c]",
    "from-[#8b5cf6] to-[#6d28d9]",
  ];
  const total = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function getInitials(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  trend,
  trendTone,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  subtitle: string;
  trend: string;
  trendTone: string;
}) {
  return (
    <article className="rounded-[24px] border border-[#e8edf7] bg-white/95 p-5 shadow-[0_16px_40px_rgba(23,52,110,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/70 bg-gradient-to-br from-[#f8f9ff] to-[#eef3ff] text-[#315cff] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          {icon}
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${trendTone}`}>{trend}</span>
      </div>
      <p className="mt-4 text-sm font-medium text-[#63759b]">{title}</p>
      <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value.toLocaleString("en-IN")}</p>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
  );
}

function QuickActionCard({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
}) {
  return (
    <PrefetchLink href={href} className="flex items-center gap-4 rounded-[18px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4 transition hover:border-[#d9e3ff] hover:bg-white">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-[#315cff] shadow-[0_8px_18px_rgba(49,92,255,0.10)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#122449]">{title}</span>
        <span className="mt-1 block text-xs text-[#8092b2]">{subtitle}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#94a4c0]" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </PrefetchLink>
  );
}

function RowActionIcon({ kind }: { kind: "view" | "edit" | "delete" | "more" }) {
  if (kind === "view") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (kind === "edit") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4Z" />
      </svg>
    );
  }

  if (kind === "delete") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M5 7h14" />
        <path d="M9 7V5h6v2" />
        <path d="M7 7l1 12h8l1-12" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function VendorPagination({
  page,
  totalPages,
  currentFilters,
}: {
  page: number;
  totalPages: number;
  currentFilters: Record<string, string | number | undefined>;
}) {
  const visiblePages = getPageTokens(page, totalPages);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <PrefetchLink href={buildVendorsHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildVendorsHref({ ...currentFilters, page: token })}
            className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${
              token === page
                ? "border-[#4f61ff] bg-gradient-to-r from-[#585eff] to-[#3267ff] text-white shadow-[0_12px_24px_rgba(50,103,255,0.24)]"
                : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
            }`}
          >
            {token}
          </PrefetchLink>
        ) : (
          <span key={token} className="px-1 text-sm text-[#8ea0bf]">
            ...
          </span>
        )
      )}
      {page < totalPages ? (
        <PrefetchLink href={buildVendorsHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function VendorsPage({ searchParams }: VendorsPageProps) {
  const session = await requirePermission("vendors.read");
  const [params, canCreate, canUpdate, canDelete, canCreateRfq, canCreatePo] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "vendors.create"),
    hasPermission(session, "vendors.update"),
    hasPermission(session, "vendors.delete"),
    hasPermission(session, "rfq.create"),
    hasPermission(session, "purchase_orders.create"),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(VendorStatus).find((value) => value === statusParam);
  const vendorType = getStringParam(params, "vendorType");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 8;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, vendorTypes] = await Promise.all([
    listVendors(session, { q, status, vendorType, page, pageSize }),
    getVendorOverview(session, { q, vendorType }),
    listVendorTypeOptions(session),
  ]);

  const currentFilters = {
    q,
    status,
    vendorType,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  const alertCards = [
    {
      label: "Pending Supplier Approvals",
      subtitle: "Suppliers awaiting verification",
      count: overview.pendingVerificationSuppliers,
      tone: "text-[#8d5bff] bg-[#f3eaff]",
    },
    {
      label: "Missing GST Details",
      subtitle: "Suppliers with incomplete GST info",
      count: overview.missingGstDetails,
      tone: "text-[#ff4f5e] bg-[#fff1f1]",
    },
    {
      label: "Inactive Suppliers",
      subtitle: "Inactive or deactivated suppliers",
      count: overview.inactiveSuppliers,
      tone: "text-[#ff8f1f] bg-[#fff4e5]",
    },
    {
      label: "Pending Vendor Documents",
      subtitle: "Documents awaiting submission",
      count: overview.pendingVendorDocuments,
      tone: "text-[#315cff] bg-[#edf3ff]",
    },
    {
      label: "Rejected Suppliers",
      subtitle: "Supplier records needing review",
      count: overview.rejectedSuppliers,
      tone: "text-[#19b56b] bg-[#eaf8ef]",
    },
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Supplier Management</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Manage vendors and procurement partners across all companies.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(overview.latestUpdatedAt)}</p>
          {canCreate ? (
            <PrefetchLink href="/vendors/new" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>Add Supplier</span>
            </PrefetchLink>
          ) : null}
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M6 20V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14" />
              <path d="M4 20h16" />
              <path d="M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1" />
            </svg>
          }
          title="Total Suppliers"
          value={overview.totalSuppliers}
          subtitle="All suppliers"
          trend={`${overview.totalSuppliers ? Math.round((overview.activeSuppliers / overview.totalSuppliers) * 100) : 0}% active`}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="8" r="3" />
              <path d="M6 19c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            </svg>
          }
          title="Active Suppliers"
          value={overview.activeSuppliers}
          subtitle="Currently active"
          trend={`${overview.totalSuppliers ? Math.round((overview.activeSuppliers / overview.totalSuppliers) * 100) : 0}%`}
          trendTone="bg-[#edf3ff] text-[#315cff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M7 4h10M9 4v3l-4 5a5 5 0 0 0 4 8h6a5 5 0 0 0 4-8l-4-5V4" />
            </svg>
          }
          title="Pending Verification"
          value={overview.pendingVerificationSuppliers}
          subtitle="Awaiting approval"
          trend={`${overview.totalSuppliers ? Math.round((overview.pendingVerificationSuppliers / overview.totalSuppliers) * 100) : 0}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="10" r="4" />
              <path d="m8.8 14.2-1.3 5 4.5-2.7 4.5 2.7-1.3-5" />
            </svg>
          }
          title="Preferred Suppliers"
          value={overview.preferredSuppliers}
          subtitle="Verified vendors"
          trend={`${overview.totalSuppliers ? Math.round((overview.preferredSuppliers / overview.totalSuppliers) * 100) : 0}%`}
          trendTone="bg-[#eaf8ef] text-[#1d9d57]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m8 8 8 8" />
            </svg>
          }
          title="Inactive Suppliers"
          value={overview.inactiveSuppliers}
          subtitle="Currently inactive"
          trend={`${overview.totalSuppliers ? Math.round((overview.inactiveSuppliers / overview.totalSuppliers) * 100) : 0}%`}
          trendTone="bg-[#fff1f1] text-[#ff4f5e]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="m12 4 1.9 3.8L18 10l-4.1 2.2L12 16l-1.9-3.8L6 10l4.1-2.2L12 4Z" />
            </svg>
          }
          title="New This Month"
          value={overview.newThisMonth}
          subtitle="Added this month"
          trend={`${overview.totalSuppliers ? Math.round((overview.newThisMonth / overview.totalSuppliers) * 100) : 0}%`}
          trendTone="bg-[#edf3ff] text-[#315cff]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">All Suppliers</h2>
          </div>

          <div className="border-b border-[#edf2fb] px-4 py-4 sm:px-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_1fr_1fr_auto] xl:items-end">
              <input type="hidden" name="pageSize" value={result.pageSize} />

              <label className="block">
                <span className="relative block">
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Search suppliers by name, code, contact or city..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
                <select
                  name="status"
                  defaultValue={status ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Status</option>
                  <option value={VendorStatus.ACTIVE}>Active</option>
                  <option value={VendorStatus.PENDING_VERIFICATION}>Pending</option>
                  <option value={VendorStatus.INACTIVE}>Inactive</option>
                  <option value={VendorStatus.REJECTED}>Rejected</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Categories</span>
                <select
                  name="vendorType"
                  defaultValue={vendorType ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Categories</option>
                  {vendorTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#d9e3ff] bg-[#f7f9ff] px-5 text-sm font-semibold text-[#315cff] transition hover:bg-white">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" />
                  </svg>
                  <span>Filters</span>
                </button>
                <PrefetchLink href="/vendors" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                    <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
                  </svg>
                  <span>Reset</span>
                </PrefetchLink>
              </div>
            </form>
          </div>

          {result.vendors.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No suppliers found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi supplier record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">Supplier Code</th>
                      <th className="px-4 py-4">Company Name</th>
                      <th className="px-4 py-4">Contact Person</th>
                      <th className="px-4 py-4">Category</th>
                      <th className="px-4 py-4">City</th>
                      <th className="px-4 py-4">State</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Last RFQ / Last PO</th>
                      <th className="px-5 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.vendors.map((vendor) => {
                      const statusMeta = getStatusMeta(vendor.status);
                      const latestRfq = vendor.rfqVendors[0];
                      const latestPo = vendor.purchaseOrders[0];
                      const contactLabel = vendor.email || vendor.phone || "No contact";

                      return (
                        <tr key={vendor.id} className="transition hover:bg-[#fbfcff]">
                          <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{vendor.code}</td>
                          <td className="px-4 py-4">
                            <div>
                              <PrefetchLink href={`/vendors/${vendor.id}`} className="text-sm font-semibold text-[#122449] hover:text-[#315cff]">
                                {vendor.name}
                              </PrefetchLink>
                              <p className="mt-1 text-xs text-[#8092b2]">
                                {vendor.gstNumber?.trim() ? vendor.gstNumber : vendor.servicePartner.name}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div>
                              <p className="text-sm font-medium text-[#173260]">{contactLabel}</p>
                              <p className="mt-1 text-xs text-[#8092b2]">{vendor.phone || vendor.email || "No phone"}</p>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex rounded-full bg-[#edf3ff] px-3 py-1 text-xs font-semibold text-[#315cff]">
                              {vendor.vendorType?.trim() || "General"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{vendor.city?.trim() || "-"}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{vendor.state?.trim() || "-"}</td>
                          <td className="px-4 py-4">
                            <div className="space-y-1">
                              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                              <p className="text-xs text-[#8092b2]">{vendor.isVerified ? "Verified" : "Verification pending"}</p>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="space-y-1 text-sm text-[#24406f]">
                              <p>{latestRfq ? formatShortDate(latestRfq.createdAt) : "-"}</p>
                              <p className="text-xs text-[#8092b2]">{latestPo ? latestPo.poNumber : latestRfq?.rfq.rfqNumber || "No recent RFQ / PO"}</p>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <PrefetchLink href={`/vendors/${vendor.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${vendor.name}`}>
                                <RowActionIcon kind="view" />
                              </PrefetchLink>
                              {canUpdate ? (
                                <PrefetchLink href={`/vendors/${vendor.id}/edit`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${vendor.name}`}>
                                  <RowActionIcon kind="edit" />
                                </PrefetchLink>
                              ) : null}
                              {canDelete ? (
                                <form action={deleteVendorAction.bind(null, vendor.id)}>
                                  <input type="hidden" name="redirectTo" value="/vendors" />
                                  <button type="submit" className="grid h-9 w-9 place-items-center rounded-xl border border-[#ffe1e1] bg-[#fff8f8] text-[#ff5a5a] transition hover:bg-[#fff0f0]" aria-label={`Delete ${vendor.name}`}>
                                    <RowActionIcon kind="delete" />
                                  </button>
                                </form>
                              ) : (
                                <PrefetchLink href={`/vendors/${vendor.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#6f82a4] transition hover:bg-[#f6f8ff]" aria-label={`More ${vendor.name}`}>
                                  <RowActionIcon kind="more" />
                                </PrefetchLink>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 p-4 lg:hidden">
                {result.vendors.map((vendor) => {
                  const statusMeta = getStatusMeta(vendor.status);

                  return (
                    <article key={vendor.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#122449]">{vendor.name}</p>
                          <p className="mt-1 truncate text-xs text-[#8092b2]">{vendor.code}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Contact</p>
                          <p className="mt-1 text-sm text-[#16315f]">{vendor.email || vendor.phone || "No contact"}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Category</p>
                          <p className="mt-1 text-sm text-[#16315f]">{vendor.vendorType?.trim() || "General"}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">City</p>
                          <p className="mt-1 text-sm text-[#16315f]">{vendor.city?.trim() || "-"}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">State</p>
                          <p className="mt-1 text-sm text-[#16315f]">{vendor.state?.trim() || "-"}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <PrefetchLink href={`/vendors/${vendor.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="view" />
                          <span>View</span>
                        </PrefetchLink>
                        {canUpdate ? (
                          <PrefetchLink href={`/vendors/${vendor.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                            <RowActionIcon kind="edit" />
                            <span>Edit</span>
                          </PrefetchLink>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {result.total} suppliers
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildVendorsHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                </div>

                <VendorPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Quick Actions</h2>
            </div>
            <div className="grid gap-3 px-5 py-5">
              {canCreate ? (
                <QuickActionCard
                  href="/vendors/new"
                  title="Add Supplier"
                  subtitle="Create a new supplier record"
                  icon={
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <circle cx="11" cy="8" r="3" />
                      <path d="M5 19c0-3 2.7-5.5 6-5.5" />
                      <path d="M18 11v8M14 15h8" />
                    </svg>
                  }
                />
              ) : null}
              {canCreateRfq ? (
                <QuickActionCard
                  href="/rfqs/new"
                  title="Create RFQ"
                  subtitle="Create new request for quotation"
                  icon={
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <rect x="5" y="3" width="12" height="18" rx="2.5" />
                      <path d="M8 8h6M8 12h6M8 16h4" />
                      <path d="M19 8v8M15 12h8" />
                    </svg>
                  }
                />
              ) : null}
              {canCreatePo ? (
                <QuickActionCard
                  href="/purchase-orders/new"
                  title="New Purchase Order"
                  subtitle="Create a new purchase order"
                  icon={
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d="M7 3h8l4 4v14H7z" />
                      <path d="M15 3v5h4" />
                      <path d="M10 12h6M10 16h6" />
                    </svg>
                  }
                />
              ) : null}
              <QuickActionCard
                href="/vendors"
                title="Import Suppliers"
                subtitle="Review and manage supplier data"
                icon={
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M12 4v11" />
                    <path d="m8 11 4 4 4-4" />
                    <path d="M5 20h14" />
                  </svg>
                }
              />
              <QuickActionCard
                href="/vendors"
                title="Export Supplier List"
                subtitle="Open supplier directory"
                icon={
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M12 20V9" />
                    <path d="m8 13 4-4 4 4" />
                    <path d="M5 4h14" />
                  </svg>
                }
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Alerts / Pending Actions</h2>
              <PrefetchLink href="/vendors" className="text-sm font-semibold text-[#315cff]">
                View all
              </PrefetchLink>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {alertCards.map((alert) => (
                <div key={alert.label} className="flex items-center gap-4 px-5 py-4">
                  <div className={`grid h-11 w-11 place-items-center rounded-full ${alert.tone}`}>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#122449]">{alert.label}</p>
                    <p className="mt-1 text-xs text-[#8092b2]">{alert.subtitle}</p>
                  </div>
                  <span className={`rounded-2xl px-3 py-1 text-sm font-semibold ${alert.tone}`}>{alert.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Top Supplier Categories</h2>
          <PrefetchLink href="/vendors" className="text-sm font-semibold text-[#315cff]">
            View all categories
          </PrefetchLink>
        </div>
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-8">
          {overview.categoryDistribution.map((category) => (
            <article key={category.id} className="rounded-[22px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${getAvatarTone(category.name)} text-sm font-semibold text-white`}>
                  {getInitials(category.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#122449]">{category.name}</p>
                  <p className="mt-1 text-xs text-[#8092b2]">{category.count} Suppliers</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
