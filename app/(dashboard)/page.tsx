import {
  AssignmentRole,
  EmailChangeRequestStatus,
  InvoiceStatus,
  PaymentStatus,
  ServicePartnerStatus,
  ServiceRequestStatus,
  TaskStatus,
  UserStatus,
} from "@prisma/client";

import { EmptyState } from "@/components/admin/empty-state";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { getUserPermissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { scopeByTenant } from "@/lib/auth/tenant";
import { buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db/prisma";
import { measurePerf } from "@/lib/observability/perf";
import { formatDateTime } from "@/lib/utils/format";

type QuickAction = {
  group: "Organization" | "Inventory & Services" | "Service Requests" | "Procurement" | "Finance" | "Reports";
  title: string;
  subtitle: string;
  href: string;
  permission: string;
  superAdminOnly?: boolean;
};

type FocusMetric = {
  id: string;
  title: string;
  value: number;
  note: string;
  href: string;
  icon: "building" | "users" | "headset" | "tasks" | "invoice" | "wallet" | "clock" | "clients";
  tone: "violet" | "blue" | "green" | "amber" | "orange" | "red";
};

type RingLegendItem = {
  label: string;
  value: number;
  color: string;
};

type AlertCard = {
  title: string;
  subtitle: string;
  count: number;
  href: string;
  icon: FocusMetric["icon"];
  tone: FocusMetric["tone"];
};

const openServiceStatuses: ServiceRequestStatus[] = [
  ServiceRequestStatus.RAISED,
  ServiceRequestStatus.TRIAGED,
  ServiceRequestStatus.PM_ASSIGNED,
  ServiceRequestStatus.SM_ASSIGNED,
  ServiceRequestStatus.QUOTE_PREPARING,
  ServiceRequestStatus.QUOTE_SUBMITTED,
  ServiceRequestStatus.QUOTE_APPROVED,
  ServiceRequestStatus.QUOTE_REJECTED,
  ServiceRequestStatus.IN_PROGRESS,
  ServiceRequestStatus.BLOCKED,
];

const taskOpenStatuses: TaskStatus[] = [
  TaskStatus.YET_TO_START,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.REOPENED,
];

const invoicePendingStatuses: InvoiceStatus[] = [InvoiceStatus.SUBMITTED, InvoiceStatus.APPROVAL_PENDING];
const vendorPaymentPendingStatuses: PaymentStatus[] = [
  PaymentStatus.REQUESTED,
  PaymentStatus.APPROVAL_PENDING,
  PaymentStatus.APPROVED,
  PaymentStatus.PARTIALLY_PAID,
];

const quickActionDefinitions: QuickAction[] = [
  { group: "Organization", title: "Add Company", subtitle: "Create service partner", href: "/service-partners/new", permission: "service_partners.create", superAdminOnly: true },
  { group: "Organization", title: "Add Company Admin", subtitle: "Open company and create admin", href: "/service-partners", permission: "users.create", superAdminOnly: true },
  { group: "Organization", title: "Add User", subtitle: "Create user", href: "/users/new", permission: "users.create" },
  { group: "Organization", title: "Add Role", subtitle: "Create role", href: "/roles/new", permission: "roles.create" },
  { group: "Organization", title: "Add Client", subtitle: "Create client", href: "/clients/new", permission: "clients.create" },
  { group: "Organization", title: "Add Branch", subtitle: "Create branch", href: "/branches/new", permission: "branches.create" },
  { group: "Inventory & Services", title: "Add Category", subtitle: "Create category", href: "/categories/new", permission: "categories.create" },
  { group: "Inventory & Services", title: "Add Item", subtitle: "Create item", href: "/items/new", permission: "items.create" },
  { group: "Inventory & Services", title: "Add Rate Card", subtitle: "Create rate card", href: "/rate-cards/new", permission: "rate_cards.create" },
  { group: "Service Requests", title: "New Service Request", subtitle: "Create request", href: "/service-requests/new", permission: "service_requests.create" },
  { group: "Procurement", title: "Add Vendor", subtitle: "Create vendor", href: "/vendors/new", permission: "vendors.create" },
  { group: "Procurement", title: "New RFQ", subtitle: "Create RFQ", href: "/rfqs/new", permission: "rfq.create" },
  { group: "Finance", title: "Record Vendor Invoice", subtitle: "Add received invoice", href: "/invoices/new", permission: "invoices.create" },
  { group: "Finance", title: "New Vendor Payment", subtitle: "Record vendor payment", href: "/vendor-payments/new", permission: "vendor_payments.create" },
  { group: "Reports", title: "Finance Reports", subtitle: "View finance reports", href: "/finance-reports", permission: "reports.read" },
];

function formatCount(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function getStatusCount(rows: Array<{ status: string; _count: { _all: number } }>, status: string) {
  return rows.find((row) => row.status === status)?._count._all ?? 0;
}

function getServiceRequestOwnerLabel(
  assignments: Array<{ role: AssignmentRole; user: { name: string | null; email: string | null; phone: string | null } }>
) {
  const preferred =
    assignments.find((assignment) => assignment.role === AssignmentRole.PM) ??
    assignments.find((assignment) => assignment.role === AssignmentRole.SM) ??
    assignments.find((assignment) => assignment.role === AssignmentRole.TECHNICIAN) ??
    assignments[0];

  if (!preferred) {
    return "Unassigned";
  }

  return preferred.user.name?.trim() || preferred.user.email || preferred.user.phone || "Assigned";
}

function getInitials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function toneClasses(tone: FocusMetric["tone"]) {
  switch (tone) {
    case "violet":
      return {
        iconWrap: "bg-violet-50 text-violet-600 ring-violet-100",
        soft: "text-violet-700 bg-violet-50",
      };
    case "green":
      return {
        iconWrap: "bg-emerald-50 text-emerald-600 ring-emerald-100",
        soft: "text-emerald-700 bg-emerald-50",
      };
    case "amber":
      return {
        iconWrap: "bg-amber-50 text-amber-600 ring-amber-100",
        soft: "text-amber-700 bg-amber-50",
      };
    case "orange":
      return {
        iconWrap: "bg-orange-50 text-orange-600 ring-orange-100",
        soft: "text-orange-700 bg-orange-50",
      };
    case "red":
      return {
        iconWrap: "bg-rose-50 text-rose-600 ring-rose-100",
        soft: "text-rose-700 bg-rose-50",
      };
    case "blue":
    default:
      return {
        iconWrap: "bg-blue-50 text-blue-600 ring-blue-100",
        soft: "text-blue-700 bg-blue-50",
      };
  }
}

function DashboardIcon({ icon }: { icon: FocusMetric["icon"] }) {
  if (icon === "building") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M4 20h16" />
        <path d="M7 20V5l5-2 5 2v15" />
        <path d="M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01" />
      </svg>
    );
  }

  if (icon === "users" || icon === "clients") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <circle cx="17" cy="8.5" r="2.5" />
        <path d="M14.5 18.5a4.4 4.4 0 0 1 6 0" />
      </svg>
    );
  }

  if (icon === "headset") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M5 12a7 7 0 0 1 14 0v5" />
        <rect x="4" y="12" width="4" height="6" rx="2" />
        <rect x="16" y="12" width="4" height="6" rx="2" />
        <path d="M20 17a2 2 0 0 1-2 2h-2" />
      </svg>
    );
  }

  if (icon === "tasks" || icon === "clock") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
      </svg>
    );
  }

  if (icon === "invoice") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5M10 12h6M10 16h6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 12h10" />
    </svg>
  );
}

function MetricCard({ metric }: { metric: FocusMetric }) {
  const tones = toneClasses(metric.tone);

  return (
    <PrefetchLink
      href={metric.href}
      className="group rounded-[24px] border border-[#e6ecf6] bg-white px-4 py-4 shadow-[0_16px_34px_rgba(15,35,71,0.06)] transition hover:-translate-y-0.5 hover:border-[#cfdaf0] hover:shadow-[0_18px_36px_rgba(15,35,71,0.09)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`grid h-12 w-12 place-items-center rounded-2xl ring-1 ${tones.iconWrap}`}>
          <DashboardIcon icon={metric.icon} />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones.soft}`}>Live</span>
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-sm font-medium text-[#6c7f9e]">{metric.title}</p>
        <p className="text-[2rem] font-semibold leading-none tracking-tight text-[#102341]">{formatCount(metric.value)}</p>
        <p className="text-sm text-[#7f8fa8]">{metric.note}</p>
      </div>
    </PrefetchLink>
  );
}

function buildRingBackground(items: RingLegendItem[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return "conic-gradient(#e8eef8 0deg 360deg)";
  }

  let current = 0;
  const stops = items
    .filter((item) => item.value > 0)
    .map((item) => {
      const start = (current / total) * 360;
      current += item.value;
      const end = (current / total) * 360;
      return `${item.color} ${start}deg ${end}deg`;
    });

  return `conic-gradient(${stops.join(", ")})`;
}

function HealthRing({
  title,
  metricValue,
  metricLabel,
  legend,
}: {
  title: string;
  metricValue: number;
  metricLabel: string;
  legend: RingLegendItem[];
}) {
  return (
    <div className="grid gap-4 border-b border-[#edf1f7] pb-5 last:border-b-0 last:pb-0 sm:grid-cols-[120px_minmax(0,1fr)] xl:border-b-0 xl:border-r xl:pr-6 xl:last:border-r-0 xl:last:pr-0">
      <div className="flex items-center gap-4 sm:block">
        <div
          className="relative h-[104px] w-[104px] rounded-full"
          style={{ background: buildRingBackground(legend) }}
        >
          <div className="absolute inset-[10px] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(232,238,248,0.9)]">
            <span className="text-[1.9rem] font-semibold leading-none text-[#102341]">{formatCount(metricValue)}</span>
            <span className="mt-1 text-xs font-medium text-[#7488aa]">{metricLabel}</span>
          </div>
        </div>
        <div className="min-w-0 sm:mt-3">
          <p className="text-base font-semibold text-[#122447]">{title}</p>
        </div>
      </div>
      <div className="grid gap-2 self-center">
        {legend.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="truncate text-[#6a7d9d]">{item.label}</span>
            </div>
            <span className="font-semibold text-[#132548]">{formatCount(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickActionTile({ action }: { action: QuickAction }) {
  const toneMap: Record<QuickAction["group"], FocusMetric["tone"]> = {
    Organization: "blue",
    "Inventory & Services": "violet",
    "Service Requests": "green",
    Procurement: "amber",
    Finance: "orange",
    Reports: "red",
  };
  const iconMap: Record<QuickAction["group"], FocusMetric["icon"]> = {
    Organization: "building",
    "Inventory & Services": "clients",
    "Service Requests": "headset",
    Procurement: "invoice",
    Finance: "wallet",
    Reports: "tasks",
  };
  const tones = toneClasses(toneMap[action.group]);

  return (
    <PrefetchLink
      href={action.href}
      className="group flex items-start gap-3 rounded-2xl border border-[#e8edf6] bg-white px-3.5 py-3.5 transition hover:border-[#cfdaef] hover:bg-[#fbfcff]"
    >
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ${tones.iconWrap}`}>
        <DashboardIcon icon={iconMap[action.group]} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[#132548]">{action.title}</p>
        <p className="mt-1 text-xs leading-5 text-[#7588a8]">
          {action.group} · {action.subtitle}
        </p>
      </div>
    </PrefetchLink>
  );
}

function AlertRow({ item }: { item: AlertCard }) {
  const tones = toneClasses(item.tone);

  return (
    <PrefetchLink
      href={item.href}
      className="flex items-center gap-3 rounded-2xl px-1 py-2 transition hover:bg-[#f8fbff]"
    >
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ${tones.iconWrap}`}>
        <DashboardIcon icon={item.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#132548]">{item.title}</p>
        <p className="truncate text-xs text-[#7689a8]">{item.subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-sm font-semibold ${tones.soft}`}>{formatCount(item.count)}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#92a2bf]" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>
    </PrefetchLink>
  );
}

export default async function DashboardPage() {
  const session = await requirePermission("dashboard.read");
  const permissionSet = session.user.isSuperAdmin ? null : new Set(await getUserPermissions(session.user.id, session.user.roleKeys));
  const can = (permissionKey: string) => session.user.isSuperAdmin || Boolean(permissionSet?.has(permissionKey));

  const isSuperAdmin = session.user.isSuperAdmin;
  const isCompanyAdmin = !isSuperAdmin && session.user.roleKeys.includes("company_admin");
  const dashboardCacheKey = [
    session.user.id,
    session.user.servicePartnerId,
    buildRoleSignature(session.user.roleKeys),
    isSuperAdmin ? "super_admin" : "tenant_user",
  ].join(":");

  const now = new Date();
  const dashboardData = await getOrSetServerCache(
    "dashboard.summary",
    dashboardCacheKey,
    () =>
      measurePerf("dashboard.page_data", async () => {
        const [
          companies,
          activeCompanies,
          users,
          activeUsers,
          roles,
          permissions,
          clients,
          branches,
          categories,
          items,
          vendors,
          rateCards,
          serviceRequests,
          openServiceRequests,
          tasks,
          rfqs,
          invoices,
          vendorPayments,
          ledgerEntries,
          serviceRequestStatusRows,
          taskStatusRows,
          invoiceStatusRows,
          vendorPaymentStatusRows,
          overdueTasks,
          pendingEmailChangeRequests,
          recentRequests,
          companyProfile,
          companyDirectory,
        ] = await Promise.all([
          can("service_partners.read")
            ? isSuperAdmin
              ? prisma.servicePartner.count({ where: { deletedAt: null } })
              : prisma.servicePartner.count({ where: { id: session.user.servicePartnerId, deletedAt: null } })
            : Promise.resolve(0),
          can("service_partners.read")
            ? isSuperAdmin
              ? prisma.servicePartner.count({ where: { deletedAt: null, status: ServicePartnerStatus.ACTIVE } })
              : prisma.servicePartner.count({ where: { id: session.user.servicePartnerId, deletedAt: null, status: ServicePartnerStatus.ACTIVE } })
            : Promise.resolve(0),
          can("users.read") ? prisma.user.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("users.read")
            ? prisma.user.count({ where: scopeByTenant(session, { deletedAt: null, status: UserStatus.ACTIVE }) })
            : Promise.resolve(0),
          can("roles.read") ? prisma.role.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("permissions.read") ? prisma.permission.count() : Promise.resolve(0),
          can("clients.read") ? prisma.client.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("branches.read") ? prisma.branch.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("categories.read") ? prisma.category.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("items.read") ? prisma.item.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("vendors.read") ? prisma.vendor.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("rate_cards.read") ? prisma.rateCard.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("service_requests.read") ? prisma.serviceRequest.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("service_requests.read")
            ? prisma.serviceRequest.count({
                where: {
                  ...scopeByTenant(session, { deletedAt: null }),
                  status: { in: openServiceStatuses },
                },
              })
            : Promise.resolve(0),
          can("tasks.read") ? prisma.task.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("rfq.read") ? prisma.rfq.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("invoices.read") ? prisma.invoice.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("vendor_payments.read") ? prisma.vendorPayment.count({ where: scopeByTenant(session, {}) }) : Promise.resolve(0),
          can("ledger.read") ? prisma.ledgerEntry.count({ where: scopeByTenant(session, {}) }) : Promise.resolve(0),
          can("service_requests.read")
            ? prisma.serviceRequest.groupBy({
                by: ["status"],
                where: scopeByTenant(session, { deletedAt: null }),
                _count: { _all: true },
              })
            : Promise.resolve([]),
          can("tasks.read")
            ? prisma.task.groupBy({
                by: ["status"],
                where: scopeByTenant(session, { deletedAt: null }),
                _count: { _all: true },
              })
            : Promise.resolve([]),
          can("invoices.read")
            ? prisma.invoice.groupBy({
                by: ["status"],
                where: scopeByTenant(session, { deletedAt: null }),
                _count: { _all: true },
              })
            : Promise.resolve([]),
          can("vendor_payments.read")
            ? prisma.vendorPayment.groupBy({
                by: ["status"],
                where: scopeByTenant(session, {}),
                _count: { _all: true },
              })
            : Promise.resolve([]),
          can("tasks.read")
            ? prisma.task.count({
                where: {
                  ...scopeByTenant(session, { deletedAt: null }),
                  dueDate: { lt: now },
                  status: { in: taskOpenStatuses },
                },
              })
            : Promise.resolve(0),
          can("email_change_requests.read")
            ? prisma.emailChangeRequest.count({
                where: {
                  ...scopeByTenant(session, {}),
                  status: EmailChangeRequestStatus.PENDING_APPROVAL,
                },
              })
            : Promise.resolve(0),
          can("service_requests.read")
            ? prisma.serviceRequest.findMany({
                where: scopeByTenant(session, { deletedAt: null }),
                orderBy: [{ createdAt: "desc" }],
                take: 5,
                include: {
                  client: { select: { name: true } },
                  branch: { select: { name: true } },
                  servicePartner: { select: { name: true, code: true } },
                  assignments: {
                    where: {
                      unassignedAt: null,
                      role: { in: [AssignmentRole.PM, AssignmentRole.SM, AssignmentRole.TECHNICIAN] },
                    },
                    orderBy: [{ assignedAt: "desc" }],
                    take: 3,
                    select: {
                      role: true,
                      user: {
                        select: {
                          name: true,
                          email: true,
                          phone: true,
                        },
                      },
                    },
                  },
                },
              })
            : Promise.resolve([]),
          !isSuperAdmin
            ? prisma.servicePartner.findFirst({
                where: { id: session.user.servicePartnerId, deletedAt: null },
                select: { name: true, code: true, status: true, email: true, phone: true },
              })
            : Promise.resolve(null),
          isSuperAdmin && can("service_partners.read")
            ? prisma.servicePartner.findMany({
                where: { deletedAt: null },
                orderBy: [{ name: "asc" }],
                take: 12,
                select: { id: true, name: true },
              })
            : Promise.resolve([]),
        ]);

        return {
          companies,
          activeCompanies,
          users,
          activeUsers,
          roles,
          permissions,
          clients,
          branches,
          categories,
          items,
          vendors,
          rateCards,
          serviceRequests,
          openServiceRequests,
          tasks,
          rfqs,
          invoices,
          vendorPayments,
          ledgerEntries,
          serviceRequestStatusRows,
          taskStatusRows,
          invoiceStatusRows,
          vendorPaymentStatusRows,
          overdueTasks,
          pendingEmailChangeRequests,
          recentRequests,
          companyProfile,
          companyDirectory,
        };
      }),
    {
      ttlSeconds: 30,
      prefixes: [cachePrefixes.dashboard, `${cachePrefixes.dashboard}:tenant:${session.user.servicePartnerId}`],
    }
  );

  const {
    companies,
    activeCompanies,
    users,
    activeUsers,
    roles,
    permissions,
    clients,
    branches,
    categories,
    items,
    vendors,
    rateCards,
    serviceRequests,
    openServiceRequests,
    tasks,
    rfqs,
    invoices,
    vendorPayments,
    ledgerEntries,
    serviceRequestStatusRows,
    taskStatusRows,
    invoiceStatusRows,
    vendorPaymentStatusRows,
    overdueTasks,
    pendingEmailChangeRequests,
    recentRequests,
    companyProfile,
    companyDirectory,
  } = dashboardData;

  const pendingInvoices = invoicePendingStatuses.reduce((sum, status) => sum + getStatusCount(invoiceStatusRows, status), 0);
  const approvedInvoices = getStatusCount(invoiceStatusRows, InvoiceStatus.APPROVED);
  const paidInvoices = getStatusCount(invoiceStatusRows, InvoiceStatus.PAID) + getStatusCount(invoiceStatusRows, InvoiceStatus.PARTIALLY_PAID);
  const ongoingTasks =
    getStatusCount(taskStatusRows, TaskStatus.YET_TO_START) +
    getStatusCount(taskStatusRows, TaskStatus.IN_PROGRESS) +
    getStatusCount(taskStatusRows, TaskStatus.BLOCKED) +
    getStatusCount(taskStatusRows, TaskStatus.REOPENED);
  const completedTasks = getStatusCount(taskStatusRows, TaskStatus.COMPLETED);
  const blockedTasks = getStatusCount(taskStatusRows, TaskStatus.BLOCKED);
  const pendingVendorPayments = vendorPaymentPendingStatuses.reduce((sum, status) => sum + getStatusCount(vendorPaymentStatusRows, status), 0);
  const completedVendorPayments =
    getStatusCount(vendorPaymentStatusRows, PaymentStatus.PAID) + getStatusCount(vendorPaymentStatusRows, PaymentStatus.PARTIALLY_PAID);
  const failedVendorPayments =
    getStatusCount(vendorPaymentStatusRows, PaymentStatus.REJECTED) + getStatusCount(vendorPaymentStatusRows, PaymentStatus.CANCELLED);

  const quickActions = quickActionDefinitions.filter((action) => {
    if (action.superAdminOnly && !isSuperAdmin) {
      return false;
    }
    return can(action.permission);
  });

  const title = isSuperAdmin ? "Platform Dashboard" : isCompanyAdmin ? "Company Dashboard" : "Dashboard";
  const subtitle = isSuperAdmin
    ? "Centralized operations and tenant health at a glance."
    : isCompanyAdmin
      ? "Operational overview for your service partner workspace."
      : "Your assigned company workspace and recent activity.";
  const focusMetrics: FocusMetric[] = [
    ...(can("service_partners.read") && isSuperAdmin
      ? [
          {
            id: "active-companies",
            title: "Active Companies",
            value: activeCompanies,
            note: `${formatCount(companies)} total companies`,
            href: "/service-partners",
            icon: "building" as const,
            tone: "violet" as const,
          },
        ]
      : []),
    ...(can("users.read")
      ? [
          {
            id: "active-users",
            title: "Active Users",
            value: activeUsers,
            note: `${formatCount(users)} total users`,
            href: "/users",
            icon: "users" as const,
            tone: "blue" as const,
          },
        ]
      : []),
    ...(can("service_requests.read")
      ? [
          {
            id: "open-requests",
            title: "Open Service Requests",
            value: openServiceRequests,
            note: `${formatCount(serviceRequests)} total requests`,
            href: "/service-requests",
            icon: "headset" as const,
            tone: "violet" as const,
          },
        ]
      : []),
    ...(can("tasks.read")
      ? [
          {
            id: "ongoing-tasks",
            title: "Ongoing Tasks",
            value: ongoingTasks,
            note: `${formatCount(completedTasks)} completed tasks`,
            href: "/tasks",
            icon: "tasks" as const,
            tone: "green" as const,
          },
        ]
      : []),
    ...(can("invoices.read")
      ? [
          {
            id: "pending-invoices",
            title: "Pending Vendor Invoices",
            value: pendingInvoices,
            note: `${formatCount(invoices)} total invoices`,
            href: "/invoices",
            icon: "invoice" as const,
            tone: "amber" as const,
          },
        ]
      : []),
    ...(can("vendor_payments.read")
      ? [
          {
            id: "pending-payments",
            title: "Pending Payments",
            value: pendingVendorPayments,
            note: `${formatCount(vendorPayments)} total vendor payments`,
            href: "/vendor-payments",
            icon: "wallet" as const,
            tone: "blue" as const,
          },
        ]
      : []),
    ...(can("tasks.read")
      ? [
          {
            id: "overdue-tasks",
            title: "Overdue Tasks",
            value: overdueTasks,
            note: `${formatCount(blockedTasks)} blocked tasks`,
            href: "/tasks",
            icon: "clock" as const,
            tone: "red" as const,
          },
        ]
      : can("clients.read")
        ? [
            {
              id: "clients",
              title: "Clients",
              value: clients,
              note: `${formatCount(branches)} mapped branches`,
              href: "/clients",
              icon: "clients" as const,
              tone: "green" as const,
            },
          ]
        : []),
  ];

  const serviceRequestLegend: RingLegendItem[] = [
    {
      label: "Open",
      value: getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.RAISED) + getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.TRIAGED),
      color: "#2f66ff",
    },
    {
      label: "In Progress",
      value:
        getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.PM_ASSIGNED) +
        getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.SM_ASSIGNED) +
        getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.QUOTE_PREPARING) +
        getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.QUOTE_SUBMITTED) +
        getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.QUOTE_APPROVED) +
        getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.IN_PROGRESS),
      color: "#8db4ff",
    },
    {
      label: "On Hold",
      value: getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.BLOCKED),
      color: "#ffb24d",
    },
    {
      label: "Resolved",
      value: getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.COMPLETED) + getStatusCount(serviceRequestStatusRows, ServiceRequestStatus.CLOSED),
      color: "#23b26d",
    },
  ];

  const taskLegend: RingLegendItem[] = [
    { label: "Completed", value: completedTasks, color: "#22b573" },
    { label: "In Progress", value: getStatusCount(taskStatusRows, TaskStatus.IN_PROGRESS), color: "#2f66ff" },
    { label: "Overdue", value: overdueTasks, color: "#ff7f45" },
    { label: "Pending", value: getStatusCount(taskStatusRows, TaskStatus.YET_TO_START) + getStatusCount(taskStatusRows, TaskStatus.REOPENED), color: "#94a3b8" },
  ];

  const invoiceLegend: RingLegendItem[] = [
    { label: "Pending", value: pendingInvoices, color: "#ff9800" },
    { label: "Approved", value: approvedInvoices, color: "#f5c26b" },
    { label: "Paid", value: paidInvoices, color: "#23b26d" },
    {
      label: "Rejected",
      value: getStatusCount(invoiceStatusRows, InvoiceStatus.REJECTED) + getStatusCount(invoiceStatusRows, InvoiceStatus.CANCELLED),
      color: "#ef4444",
    },
  ];

  const paymentLegend: RingLegendItem[] = [
    { label: "Pending", value: pendingVendorPayments, color: "#2f66ff" },
    { label: "Completed", value: completedVendorPayments, color: "#22b573" },
    { label: "Failed", value: failedVendorPayments, color: "#ef4444" },
  ];

  const alertCards: AlertCard[] = [
    ...(can("email_change_requests.read")
      ? [
          {
            title: "Pending Email Change Requests",
            subtitle: "Requires platform approval",
            count: pendingEmailChangeRequests,
            href: "/email-change-requests",
            icon: "clients" as const,
            tone: "violet" as const,
          },
        ]
      : []),
    ...(can("tasks.read")
      ? [
          {
            title: "Overdue Tasks",
            subtitle: "Tasks past due date",
            count: overdueTasks,
            href: "/tasks",
            icon: "clock" as const,
            tone: "red" as const,
          },
        ]
      : []),
    ...(can("invoices.read")
      ? [
          {
            title: "Pending Vendor Invoices",
            subtitle: "Awaiting approval or payment readiness",
            count: pendingInvoices,
            href: "/invoices",
            icon: "invoice" as const,
            tone: "orange" as const,
          },
        ]
      : []),
    ...(can("vendor_payments.read")
      ? [
          {
            title: "Pending Payments",
            subtitle: "Awaiting execution",
            count: pendingVendorPayments,
            href: "/vendor-payments",
            icon: "wallet" as const,
            tone: "blue" as const,
          },
        ]
      : []),
  ].filter((item) => item.count > 0);
  const visibleAlerts = alertCards.slice(0, 4);
  const alertsViewAllHref = visibleAlerts[0]?.href ?? "/tasks";

  return (
    <section className="crm-page">
      <div className="rounded-[30px] border border-[#e3eaf6] bg-white px-5 py-5 shadow-[0_24px_48px_rgba(15,35,71,0.06)] sm:px-6 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-[#dde7f5] bg-[#f7faff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5f77a2]">
              {isSuperAdmin ? "Platform view" : "Tenant view"}
            </div>
            <div>
              <h1 className="text-[2rem] font-semibold tracking-tight text-[#112447] sm:text-[2.35rem]">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6f83a8]">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start text-[#6b7fa1] lg:pt-2">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v6h-6" />
            </svg>
            <span className="text-sm font-medium">Last updated: {formatDateTime(now)}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {focusMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,2fr)_390px]">
        <div className="space-y-6">
          <section className="rounded-[28px] border border-[#e3eaf6] bg-white p-5 shadow-[0_18px_40px_rgba(15,35,71,0.05)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[1.35rem] font-semibold text-[#122447]">Operational Health</h2>
                <p className="mt-1 text-sm text-[#7184a7]">Live breakdown of active work, invoice flow, and payout readiness.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-5 xl:grid-cols-4">
              <HealthRing title="Service Requests" metricValue={openServiceRequests} metricLabel="Open" legend={serviceRequestLegend} />
              <HealthRing title="Tasks" metricValue={ongoingTasks} metricLabel="Active" legend={taskLegend} />
              <HealthRing title="Vendor Invoices" metricValue={pendingInvoices} metricLabel="Pending" legend={invoiceLegend} />
              <HealthRing title="Payments" metricValue={pendingVendorPayments} metricLabel="Pending" legend={paymentLegend} />
            </div>
          </section>

          <section className="overflow-hidden rounded-[28px] border border-[#e3eaf6] bg-white shadow-[0_18px_40px_rgba(15,35,71,0.05)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#edf2fb] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-[1.35rem] font-semibold text-[#122447]">Recent Service Requests</h2>
                <p className="mt-1 text-sm text-[#7184a7]">Latest requests visible under your current scope.</p>
              </div>
              {can("service_requests.read") ? (
                <PrefetchLink href="/service-requests" className="text-sm font-semibold text-[#2f66ff]">
                  View all
                </PrefetchLink>
              ) : null}
            </div>

            {!can("service_requests.read") ? (
              <div className="p-5 sm:p-6">
                <EmptyState title="No request access" description="Your current role does not allow service request visibility on the dashboard." />
              </div>
            ) : recentRequests.length === 0 ? (
              <div className="p-5 sm:p-6">
                <EmptyState title="No recent requests" description="New service requests will appear here once they are created for this workspace." />
              </div>
            ) : (
              <>
                <div className="space-y-3 p-4 md:hidden">
                  {recentRequests.map((request) => {
                    const ownerLabel = getServiceRequestOwnerLabel(request.assignments);

                    return (
                      <article key={request.id} className="rounded-3xl border border-[#edf2fb] bg-[#fbfcff] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#869ab9]">{request.serviceNumber}</p>
                            <p className="mt-1 text-sm font-semibold text-[#132548]">{request.title}</p>
                          </div>
                          <StatusBadge value={request.status} />
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {isSuperAdmin ? (
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#869ab9]">Company</p>
                              <p className="mt-1 text-sm text-[#132548]">{request.servicePartner.name}</p>
                            </div>
                          ) : null}
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#869ab9]">Client</p>
                            <p className="mt-1 text-sm text-[#132548]">{request.client.name}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#869ab9]">Current Owner</p>
                            <p className="mt-1 text-sm text-[#132548]">{ownerLabel}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#869ab9]">Requested At</p>
                            <p className="mt-1 text-sm text-[#132548]">{formatDateTime(request.requestedAt ?? request.createdAt)}</p>
                          </div>
                        </div>
                        <PrefetchLink
                          href={`/service-requests/${request.id}`}
                          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#dbe5f4] px-4 text-sm font-semibold text-[#2f66ff]"
                        >
                          Open
                        </PrefetchLink>
                      </article>
                    );
                  })}
                </div>

                <div className="crm-scroll-shell hidden md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-[#f8fbff] text-left text-[11px] uppercase tracking-[0.16em] text-[#7c90b3]">
                        <th className="px-6 py-3.5">Request No.</th>
                        {isSuperAdmin ? <th className="px-6 py-3.5">Company</th> : null}
                        <th className="px-6 py-3.5">Client</th>
                        <th className="px-6 py-3.5">Status</th>
                        <th className="px-6 py-3.5">Current Owner</th>
                        <th className="px-6 py-3.5">Requested At</th>
                        <th className="px-6 py-3.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRequests.map((request) => {
                        const ownerLabel = getServiceRequestOwnerLabel(request.assignments);
                        const ownerInitials = getInitials(ownerLabel);

                        return (
                          <tr key={request.id} className="border-t border-[#edf2fb] text-[#1c335c] hover:bg-[#fbfcff]">
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-semibold text-[#2f66ff]">{request.serviceNumber}</p>
                                <p className="mt-1 text-xs text-[#7b8eaF]">{request.title}</p>
                              </div>
                            </td>
                            {isSuperAdmin ? <td className="px-6 py-4">{request.servicePartner.name}</td> : null}
                            <td className="px-6 py-4">{request.client.name}</td>
                            <td className="px-6 py-4">
                              <StatusBadge value={request.status} />
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="grid h-9 w-9 place-items-center rounded-full bg-[#1a2f7b] text-xs font-semibold text-white">
                                  {ownerInitials || "NA"}
                                </div>
                                <span className="font-medium text-[#183159]">{ownerLabel}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-[#5f7398]">{formatDateTime(request.requestedAt ?? request.createdAt)}</td>
                            <td className="px-6 py-4">
                              <PrefetchLink
                                href={`/service-requests/${request.id}`}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[#dce6f6] text-[#2f66ff] transition hover:bg-[#f5f8ff]"
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              </PrefetchLink>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-[#edf2fb] px-5 py-3 text-xs text-[#7c90b3] sm:px-6">
                  <span>
                    Showing 1 to {recentRequests.length} of {serviceRequests} requests
                  </span>
                  <PrefetchLink href="/service-requests" className="font-semibold text-[#2f66ff]">
                    View more
                  </PrefetchLink>
                </div>
              </>
            )}
          </section>

          {isSuperAdmin && companyDirectory.length > 0 ? (
            <section className="rounded-[28px] border border-[#e3eaf6] bg-white p-5 shadow-[0_18px_40px_rgba(15,35,71,0.05)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[1.35rem] font-semibold text-[#122447]">Company Directory</h2>
                  <p className="mt-1 text-sm text-[#7184a7]">Open a company to review admins, users, service requests, and financial modules.</p>
                </div>
                <PrefetchLink href="/service-partners" className="text-sm font-semibold text-[#2f66ff]">
                  View all
                </PrefetchLink>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {companyDirectory.map((company) => (
                  <PrefetchLink
                    key={company.id}
                    href={`/service-partners/${company.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-[#e7edf7] bg-[#fbfcff] px-4 py-4 text-sm font-medium text-[#112447] transition hover:border-[#d2dcf0] hover:bg-white"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-[#6078a6] shadow-[inset_0_0_0_1px_rgba(225,233,245,1)]">
                      <DashboardIcon icon="building" />
                    </div>
                    <span className="truncate">{company.name}</span>
                  </PrefetchLink>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 text-xs text-[#7c90b3]">
                <span>
                  Showing 1 to {companyDirectory.length} of {companies} companies
                </span>
                <PrefetchLink href="/service-partners" className="font-semibold text-[#2f66ff]">
                  View more
                </PrefetchLink>
              </div>
            </section>
          ) : null}

        </div>

        <aside className="space-y-6">
          <section id="dashboard-quick-actions" className="rounded-[28px] border border-[#e3eaf6] bg-white p-5 shadow-[0_18px_40px_rgba(15,35,71,0.05)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[1.35rem] font-semibold text-[#122447]">Quick Actions</h2>
                <p className="mt-1 text-sm text-[#7184a7]">Permission-aware shortcuts for the most common admin workflows.</p>
              </div>
              {quickActions.length > 8 ? (
                <PrefetchLink href={quickActions[8]?.href ?? quickActions[0]?.href ?? "/"} className="text-sm font-semibold text-[#2f66ff]">
                  View more
                </PrefetchLink>
              ) : null}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {quickActions.length === 0 ? (
                <EmptyState title="No quick actions available" description="Available actions will appear here when your role has create or report access." />
              ) : (
                quickActions.slice(0, 8).map((action) => <QuickActionTile key={action.title} action={action} />)
              )}
            </div>
          </section>

          <section id="dashboard-alerts" className="rounded-[28px] border border-[#e3eaf6] bg-white p-5 shadow-[0_18px_40px_rgba(15,35,71,0.05)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[1.35rem] font-semibold text-[#122447]">Alerts / Pending Actions</h2>
                <p className="mt-1 text-sm text-[#7184a7]">Items that may need intervention from admins or finance operators.</p>
              </div>
              {visibleAlerts.length > 0 ? (
                <PrefetchLink href={alertsViewAllHref} className="text-sm font-semibold text-[#2f66ff]">
                  View all
                </PrefetchLink>
              ) : null}
            </div>
            <div className="mt-5 space-y-1">
              {visibleAlerts.length === 0 ? (
                <EmptyState title="No pending alerts" description="Critical review items will appear here when counts move above zero." />
              ) : (
                visibleAlerts.map((item) => <AlertRow key={item.title} item={item} />)
              )}
            </div>
          </section>

          {!isSuperAdmin && companyProfile ? (
            <section className="rounded-[28px] border border-[#e3eaf6] bg-white p-5 shadow-[0_18px_40px_rgba(15,35,71,0.05)] sm:p-6">
              <div>
                <h2 className="text-[1.35rem] font-semibold text-[#122447]">Company Profile</h2>
                <p className="mt-1 text-sm text-[#7184a7]">Current tenant identity and contact reference.</p>
              </div>
              <div className="mt-5 grid gap-3">
                {[
                  { label: "Name", value: companyProfile.name },
                  { label: "Code", value: companyProfile.code },
                  { label: "Status", value: companyProfile.status },
                  { label: "Contact", value: companyProfile.email ?? companyProfile.phone ?? "-" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-[#e7edf7] bg-[#fbfcff] px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8ca0c2]">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold text-[#132548]">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
