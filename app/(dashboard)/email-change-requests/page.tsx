import type { ReactNode } from "react";

import { EmailChangeRequestStatus } from "@prisma/client";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { approveEmailChangeRequestAction, rejectEmailChangeRequestAction } from "@/features/users/actions/email-change.actions";
import { listEmailChangeRequests } from "@/features/users/services/email-change.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EmailChangeRequestsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type RequestRow = Awaited<ReturnType<typeof listEmailChangeRequests>>[number];

const PAGE_SIZE = 10;

function getMessage(params: SearchParamsInput) {
  const success = getStringParam(params, "success");
  const error = getStringParam(params, "error");

  if (success === "approved") {
    return { type: "success" as const, text: "Email change request approved and OTP sent to the new email." };
  }
  if (success === "rejected") {
    return { type: "success" as const, text: "Email change request rejected." };
  }
  if (error) {
    return { type: "error" as const, text: "Unable to update the email change request." };
  }

  return null;
}

function formatDate(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

function formatRelativeTime(value: Date | null) {
  if (!value) {
    return "No activity yet";
  }

  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function parseDateParam(value?: string, endOfDay?: boolean) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function getInitials(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarTone(value: string) {
  const tones = [
    "from-[#ede9fe] to-[#ddd6fe] text-[#5b46ff]",
    "from-[#dbeafe] to-[#bfdbfe] text-[#2153ff]",
    "from-[#dcfce7] to-[#bbf7d0] text-[#14804a]",
    "from-[#ffe4e6] to-[#fecdd3] text-[#e11d48]",
    "from-[#fef3c7] to-[#fde68a] text-[#b45309]",
  ];
  const index = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length;
  return tones[index];
}

function getStatusMeta(status: EmailChangeRequestStatus) {
  if (status === EmailChangeRequestStatus.PENDING_APPROVAL) {
    return {
      label: "Pending",
      cardLabel: "Pending Approval",
      tone: "bg-[#fff4e8] text-[#f28c28]",
      iconTone: "text-[#315cff]",
      iconBg: "bg-[#eef2ff]",
      trendTone: "text-[#16a34a]",
    };
  }
  if (status === EmailChangeRequestStatus.APPROVED || status === EmailChangeRequestStatus.OTP_SENT) {
    return {
      label: "Approved",
      cardLabel: "Approved",
      tone: "bg-[#eaf8ef] text-[#18a957]",
      iconTone: "text-[#18a957]",
      iconBg: "bg-[#ecfbf2]",
      trendTone: "text-[#16a34a]",
    };
  }
  if (status === EmailChangeRequestStatus.VERIFIED) {
    return {
      label: "Completed",
      cardLabel: "Completed",
      tone: "bg-[#edf3ff] text-[#315cff]",
      iconTone: "text-[#18a957]",
      iconBg: "bg-[#ecfbf2]",
      trendTone: "text-[#16a34a]",
    };
  }

  return {
    label:
      status === EmailChangeRequestStatus.EXPIRED
        ? "Expired"
        : status === EmailChangeRequestStatus.CANCELLED
          ? "Cancelled"
          : "Rejected",
    cardLabel: "Rejected",
    tone: "bg-[#fff1f1] text-[#ff4f5e]",
    iconTone: "text-[#ff4f5e]",
    iconBg: "bg-[#fff4f4]",
    trendTone: "text-[#ff4f5e]",
  };
}

function inferReason(row: RequestRow) {
  const oldParts = row.oldEmail.toLowerCase().split("@");
  const newParts = row.newEmail.toLowerCase().split("@");
  const oldLocal = oldParts[0] ?? "";
  const newLocal = newParts[0] ?? "";
  const oldDomain = oldParts[1] ?? "";
  const newDomain = newParts[1] ?? "";
  const publicDomains = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com"]);

  if (oldDomain && newDomain && oldDomain !== newDomain) {
    if (publicDomains.has(oldDomain) && !publicDomains.has(newDomain)) {
      return "Organization email update";
    }
    if (!publicDomains.has(oldDomain) && !publicDomains.has(newDomain)) {
      return "Updated domain email";
    }
    return "Domain migration";
  }

  if (oldLocal !== newLocal) {
    return publicDomains.has(newDomain) ? "Personal email update" : "Official email change";
  }

  return "Work email update";
}

function buildRequestsHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/email-change-requests?${query}` : "/email-change-requests";
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

function buildPublicRequestId(row: RequestRow, index: number) {
  return `ECR-${row.requestedAt.getFullYear()}-${String(index + 1).padStart(4, "0")}`;
}

function buildCsv(rows: RequestRow[]) {
  const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

  const header = [
    "Request ID",
    "User",
    "Current Email",
    "New Email",
    "Reason",
    "Requested At",
    "Status",
  ];

  const lines = rows.map((row, index) =>
    [
      buildPublicRequestId(row, index),
      row.user.name?.trim() || row.user.email || row.user.id,
      row.oldEmail,
      row.newEmail,
      inferReason(row),
      formatDateTime(row.requestedAt),
      getStatusMeta(row.status).label,
    ]
      .map(escapeCell)
      .join(",")
  );

  return `data:text/csv;charset=utf-8,${encodeURIComponent([header.map(escapeCell).join(","), ...lines].join("\n"))}`;
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  iconTone,
  iconBg,
  trend,
  trendTone,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  subtitle: string;
  iconTone: string;
  iconBg: string;
  trend?: string;
  trendTone?: string;
}) {
  return (
    <article className="rounded-[22px] border border-[#e8edf7] bg-white px-5 py-5 shadow-[0_14px_30px_rgba(22,49,100,0.05)]">
      <div className="flex items-start gap-4">
        <div className={`grid h-12 w-12 place-items-center rounded-2xl ${iconBg} ${iconTone}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#66789f]">{title}</p>
          <p className="mt-2 text-[2rem] font-semibold leading-none tracking-[-0.05em] text-[#10244b]">{value.toLocaleString("en-IN")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-[#93a2bd]">{subtitle}</span>
            {trend ? <span className={`text-sm font-semibold ${trendTone}`}>{trend}</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function RowIconButton({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "success" | "danger";
  children: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "border-[#d8f0df] text-[#1d9d57] hover:bg-[#f3fff6]"
      : tone === "danger"
        ? "border-[#ffe1e1] text-[#ff5a5a] hover:bg-[#fff8f8]"
        : "border-[#e4eaf5] text-[#4b5f87] hover:bg-[#f8fbff]";

  return (
    <button
      type="submit"
      title={title}
      aria-label={title}
      className={`grid h-9 w-9 place-items-center rounded-xl border bg-white transition ${toneClass}`}
    >
      {children}
    </button>
  );
}

function Pagination({
  page,
  totalPages,
  currentFilters,
}: {
  page: number;
  totalPages: number;
  currentFilters: Record<string, string | number | undefined>;
}) {
  const tokens = getPageTokens(page, totalPages);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrefetchLink
        href={buildRequestsHref({ ...currentFilters, page: Math.max(1, page - 1) })}
        aria-disabled={page <= 1}
        className={`grid h-10 w-10 place-items-center rounded-xl border transition ${
          page <= 1 ? "pointer-events-none border-[#edf2fb] text-[#c1cbde]" : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 6-6 6 6 6" />
        </svg>
      </PrefetchLink>
      {tokens.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildRequestsHref({ ...currentFilters, page: token })}
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
      <PrefetchLink
        href={buildRequestsHref({ ...currentFilters, page: Math.min(totalPages, page + 1) })}
        aria-disabled={page >= totalPages}
        className={`grid h-10 w-10 place-items-center rounded-xl border transition ${
          page >= totalPages ? "pointer-events-none border-[#edf2fb] text-[#c1cbde]" : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </PrefetchLink>
    </div>
  );
}

export default async function EmailChangeRequestsPage({ searchParams }: EmailChangeRequestsPageProps) {
  const session = await requirePermission("email_change_requests.read");
  const [params, canApprove, canReject] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "email_change_requests.approve"),
    hasPermission(session, "email_change_requests.reject"),
  ]);

  const message = getMessage(params);
  const allRows = await listEmailChangeRequests(session, {});
  const q = getStringParam(params, "q")?.trim() ?? "";
  const statusParam = getStringParam(params, "status");
  const userId = getStringParam(params, "userId");
  const from = getStringParam(params, "from");
  const to = getStringParam(params, "to");
  const pageParam = getNumberParam(params, "page") ?? 1;
  const fromDate = parseDateParam(from);
  const toDate = parseDateParam(to, true);
  const normalizedQuery = q.toLowerCase();

  const filteredRows = allRows.filter((row, index) => {
    if (statusParam && row.status !== statusParam) {
      return false;
    }
    if (userId && row.user.id !== userId) {
      return false;
    }
    if (fromDate && row.requestedAt < fromDate) {
      return false;
    }
    if (toDate && row.requestedAt > toDate) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    const requestId = buildPublicRequestId(row, index).toLowerCase();
    const haystacks = [
      requestId,
      row.user.name?.toLowerCase() ?? "",
      row.user.email?.toLowerCase() ?? "",
      row.oldEmail.toLowerCase(),
      row.newEmail.toLowerCase(),
      row.servicePartner.name.toLowerCase(),
      inferReason(row).toLowerCase(),
    ];

    return haystacks.some((value) => value.includes(normalizedQuery));
  });

  const sortedUsers = Array.from(
    new Map(
      allRows.map((row) => [
        row.user.id,
        {
          id: row.user.id,
          label: row.user.name?.trim() || row.user.email || row.user.id,
        },
      ])
    ).values()
  ).sort((left, right) => left.label.localeCompare(right.label));

  const totalRequests = allRows.length;
  const pendingCount = allRows.filter((row) => row.status === EmailChangeRequestStatus.PENDING_APPROVAL).length;
  const approvedCount = allRows.filter((row) => row.status === EmailChangeRequestStatus.APPROVED || row.status === EmailChangeRequestStatus.OTP_SENT).length;
  const rejectedCount = allRows.filter((row) =>
    [EmailChangeRequestStatus.REJECTED, EmailChangeRequestStatus.CANCELLED, EmailChangeRequestStatus.EXPIRED].some(
      (statusValue) => statusValue === row.status
    )
  ).length;
  const completedCount = allRows.filter((row) => row.status === EmailChangeRequestStatus.VERIFIED).length;

  const currentPage = Math.max(1, pageParam);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(startIndex, startIndex + PAGE_SIZE);
  const lastIndex = startIndex + pageRows.length;

  const currentFilters = {
    q: q || undefined,
    status: statusParam || undefined,
    userId: userId || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const csvHref = buildCsv(filteredRows);
  const selectedRange =
    fromDate && toDate
      ? `${formatDate(fromDate)} - ${formatDate(toDate)}`
      : fromDate
        ? `${formatDate(fromDate)} onwards`
        : toDate
          ? `Up to ${formatDate(toDate)}`
          : allRows.length > 0
            ? `${formatDate(allRows[allRows.length - 1]?.requestedAt ?? null)} - ${formatDate(allRows[0]?.requestedAt ?? null)}`
            : "All time";

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Email Change Requests</h1>
          <p className="mt-2 text-sm text-[#7082a6] sm:text-base">Review and manage all requested email change operations.</p>
        </div>
        <PrefetchLink
          href="/profile"
          className="inline-flex h-12 items-center justify-center gap-2 self-start rounded-2xl bg-gradient-to-r from-[#585efc] to-[#3367ff] px-5 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(50,103,255,0.24)] transition hover:brightness-105"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 4v12M4 10h12" />
          </svg>
          <span>New Email Change Request</span>
        </PrefetchLink>
      </div>

      {message ? <p className={message.type === "success" ? "crm-alert crm-alert--success" : "crm-alert crm-alert--error"}>{message.text}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Total Requests"
          value={totalRequests}
          subtitle="All time"
          iconBg="bg-[#f2f4ff]"
          iconTone="text-[#315cff]"
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="5" y="3" width="14" height="18" rx="2.8" />
              <path d="M8 8h8M8 12h8M8 16h5" />
            </svg>
          }
        />
        <StatCard
          title="Pending Approval"
          value={pendingCount}
          subtitle="Open queue"
          trend={`${Math.round((pendingCount / Math.max(totalRequests, 1)) * 100)}% of total`}
          trendTone="text-[#16a34a]"
          iconBg="bg-[#eef2ff]"
          iconTone="text-[#315cff]"
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="6" y="4.5" width="12" height="15" rx="2.5" />
              <path d="M9 8.5h6M9 12h4" />
              <path d="m12 14.5 1.8 1.8 3.2-3.2" />
            </svg>
          }
        />
        <StatCard
          title="Approved"
          value={approvedCount}
          subtitle="OTP flow active"
          trend={`${Math.round((approvedCount / Math.max(totalRequests, 1)) * 100)}% of total`}
          trendTone="text-[#16a34a]"
          iconBg="bg-[#ecfbf2]"
          iconTone="text-[#18a957]"
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m8.5 12.2 2.4 2.4 4.6-5" />
            </svg>
          }
        />
        <StatCard
          title="Rejected"
          value={rejectedCount}
          subtitle="Closed unsuccessful"
          trend={`${Math.round((rejectedCount / Math.max(totalRequests, 1)) * 100)}% of total`}
          trendTone="text-[#ff4f5e]"
          iconBg="bg-[#fff4f4]"
          iconTone="text-[#ff4f5e]"
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m9 9 6 6M15 9l-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Completed"
          value={completedCount}
          subtitle="Verified successfully"
          trend={`${Math.round((completedCount / Math.max(totalRequests, 1)) * 100)}% of total`}
          trendTone="text-[#16a34a]"
          iconBg="bg-[#ecfbf2]"
          iconTone="text-[#18a957]"
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m8.5 12.2 2.4 2.4 4.6-5" />
            </svg>
          }
        />
      </div>

      <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <div className="border-b border-[#edf2fb] px-4 py-4 sm:px-5">
          <form className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_180px_180px_260px_auto_auto_auto] xl:items-center">
            <label className="relative block">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search by user, current email, new email..."
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              />
            </label>

            <select
              name="status"
              defaultValue={statusParam ?? ""}
              className="h-12 rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Status</option>
              <option value={EmailChangeRequestStatus.PENDING_APPROVAL}>Pending Approval</option>
              <option value={EmailChangeRequestStatus.APPROVED}>Approved</option>
              <option value={EmailChangeRequestStatus.OTP_SENT}>OTP Sent</option>
              <option value={EmailChangeRequestStatus.VERIFIED}>Completed</option>
              <option value={EmailChangeRequestStatus.REJECTED}>Rejected</option>
              <option value={EmailChangeRequestStatus.EXPIRED}>Expired</option>
              <option value={EmailChangeRequestStatus.CANCELLED}>Cancelled</option>
            </select>

            <select
              name="userId"
              defaultValue={userId ?? ""}
              className="h-12 rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Users</option>
              {sortedUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.label}
                </option>
              ))}
            </select>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <div className="relative">
                <input
                  type="date"
                  name="from"
                  defaultValue={from ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </div>
              <div className="relative hidden xl:block">
                <input
                  type="date"
                  name="to"
                  defaultValue={to ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </div>
            </div>

            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#d9e3ff] bg-white px-4 text-sm font-semibold text-[#274c9e] transition hover:bg-[#f8fbff]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" />
              </svg>
              <span>Filter</span>
            </button>

            <PrefetchLink
              href="/email-change-requests"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#e3e9f4] bg-white px-4 text-sm font-semibold text-[#5f7398] transition hover:bg-[#f8fbff]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
              </svg>
              <span>Reset</span>
            </PrefetchLink>

            <a
              href={csvHref}
              download="email-change-requests.csv"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#e3e9f4] bg-white px-4 text-sm font-semibold text-[#274c9e] transition hover:bg-[#f8fbff]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 4v10" />
                <path d="m8 10 4 4 4-4" />
                <path d="M5 19h14" />
              </svg>
              <span>Export</span>
            </a>
          </form>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-[#7f91b2]">
            <p>{filteredRows.length.toLocaleString("en-IN")} matching requests</p>
            <p>{selectedRange}</p>
          </div>
        </div>

        {pageRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </div>
            <h2 className="mt-5 text-xl font-semibold text-[#122449]">No email change requests found</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
              Current filters ke hisab se koi request record nahi mila. Search ya filters reset karke dobara check karein.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full text-left">
                <thead className="border-b border-[#eef2f8] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8192af]">
                  <tr>
                    <th className="px-5 py-5">Request ID</th>
                    <th className="px-4 py-5">User</th>
                    <th className="px-4 py-5">Current Email</th>
                    <th className="px-4 py-5">New Email</th>
                    <th className="px-4 py-5">Reason</th>
                    <th className="px-4 py-5">Requested At</th>
                    <th className="px-4 py-5">Status</th>
                    <th className="px-5 py-5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf2fb]">
                  {pageRows.map((row) => {
                    const statusMeta = getStatusMeta(row.status);
                    const displayName = row.user.name?.trim() || row.user.email || row.user.id;
                    const initials = getInitials(displayName);
                    const publicId = buildPublicRequestId(row, allRows.findIndex((candidate) => candidate.id === row.id));

                    return (
                      <tr key={row.id} className="align-top transition hover:bg-[#fbfcff]">
                        <td className="px-5 py-4">
                          <span className="text-sm font-semibold text-[#315cff]">{publicId}</span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br text-sm font-semibold ${getAvatarTone(displayName)}`}>
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[#122449]">{displayName}</p>
                              <p className="mt-0.5 text-xs text-[#8da0bf]">Client User</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-[#21395f]">{row.oldEmail}</td>
                        <td className="px-4 py-4 text-sm text-[#21395f]">{row.newEmail}</td>
                        <td className="px-4 py-4 text-sm text-[#21395f]">{inferReason(row)}</td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-medium text-[#21395f]">{formatDateTime(row.requestedAt)}</p>
                          <p className="mt-1 text-xs text-[#8da0bf]">{formatRelativeTime(row.requestedAt)}</p>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-center gap-2">
                            <a
                              href={`mailto:${row.newEmail}`}
                              title="Email new address"
                              aria-label="Email new address"
                              className="grid h-9 w-9 place-items-center rounded-xl border border-[#e4eaf5] bg-white text-[#4b5f87] transition hover:bg-[#f8fbff]"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                                <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </a>

                            {canApprove &&
                            [EmailChangeRequestStatus.PENDING_APPROVAL, EmailChangeRequestStatus.APPROVED].some(
                              (statusValue) => statusValue === row.status
                            ) ? (
                              <form action={approveEmailChangeRequestAction}>
                                <input type="hidden" name="requestId" value={row.id} />
                                <RowIconButton title="Approve request" tone="success">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="m5 13 4 4L19 7" />
                                  </svg>
                                </RowIconButton>
                              </form>
                            ) : null}

                            {canReject &&
                            [EmailChangeRequestStatus.PENDING_APPROVAL, EmailChangeRequestStatus.APPROVED, EmailChangeRequestStatus.OTP_SENT].some(
                              (statusValue) => statusValue === row.status
                            ) ? (
                              <form action={rejectEmailChangeRequestAction}>
                                <input type="hidden" name="requestId" value={row.id} />
                                <input type="hidden" name="rejectionReason" value="" />
                                <RowIconButton title="Reject request" tone="danger">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="m6 6 12 12M18 6 6 18" />
                                  </svg>
                                </RowIconButton>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 p-4 lg:hidden">
              {pageRows.map((row) => {
                const statusMeta = getStatusMeta(row.status);
                const displayName = row.user.name?.trim() || row.user.email || row.user.id;
                const publicId = buildPublicRequestId(row, allRows.findIndex((candidate) => candidate.id === row.id));

                return (
                  <article key={row.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#315cff]">{publicId}</p>
                        <p className="mt-2 text-base font-semibold text-[#122449]">{displayName}</p>
                        <p className="mt-0.5 text-xs text-[#8da0bf]">Client User</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Current Email</p>
                        <p className="mt-1 break-all text-sm text-[#16315f]">{row.oldEmail}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">New Email</p>
                        <p className="mt-1 break-all text-sm text-[#16315f]">{row.newEmail}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Reason</p>
                        <p className="mt-1 text-sm text-[#16315f]">{inferReason(row)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Requested At</p>
                        <p className="mt-1 text-sm text-[#16315f]">{formatDateTime(row.requestedAt)}</p>
                        <p className="mt-1 text-xs text-[#8da0bf]">{formatRelativeTime(row.requestedAt)}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <a
                        href={`mailto:${row.newEmail}`}
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-[#e4eaf5] bg-white px-3 text-sm font-semibold text-[#4b5f87]"
                      >
                        View
                      </a>

                      {canApprove &&
                      [EmailChangeRequestStatus.PENDING_APPROVAL, EmailChangeRequestStatus.APPROVED].some(
                        (statusValue) => statusValue === row.status
                      ) ? (
                        <form action={approveEmailChangeRequestAction}>
                          <input type="hidden" name="requestId" value={row.id} />
                          <button
                            type="submit"
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-[#d8f0df] bg-[#f3fff6] px-4 text-sm font-semibold text-[#1d9d57]"
                          >
                            Approve
                          </button>
                        </form>
                      ) : null}

                      {canReject &&
                      [EmailChangeRequestStatus.PENDING_APPROVAL, EmailChangeRequestStatus.APPROVED, EmailChangeRequestStatus.OTP_SENT].some(
                        (statusValue) => statusValue === row.status
                      ) ? (
                        <form action={rejectEmailChangeRequestAction}>
                          <input type="hidden" name="requestId" value={row.id} />
                          <input type="hidden" name="rejectionReason" value="" />
                          <button
                            type="submit"
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-[#ffe1e1] bg-[#fff8f8] px-4 text-sm font-semibold text-[#ff5a5a]"
                          >
                            Reject
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm text-[#7082a6]">
                Showing {filteredRows.length === 0 ? 0 : startIndex + 1} to {lastIndex} of {filteredRows.length.toLocaleString("en-IN")} requests
              </p>
              <Pagination page={safePage} totalPages={totalPages} currentFilters={currentFilters} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
