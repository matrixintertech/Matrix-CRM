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

type DashboardIconName =
  | "building"
  | "users"
  | "headset"
  | "tasks"
  | "invoice"
  | "wallet"
  | "clock"
  | "clients"
  | "mail"
  | "rfq";

type FocusMetric = {
  id: string;
  title: string;
  value: number;
  note: string;
  trend: {
    value: string;
    direction: "up" | "down";
  };
  href: string;
  icon: DashboardIconName;
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
  icon: DashboardIconName;
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
  { group: "Service Requests", title: "New Service Request", subtitle: "Create request", href: "/service-requests/new", permission: "service_requests.create" },
  { group: "Procurement", title: "Add Vendor", subtitle: "Create vendor", href: "/vendors/new", permission: "vendors.create" },
  { group: "Procurement", title: "New RFQ", subtitle: "Create RFQ", href: "/rfqs/new", permission: "rfq.create" },
  { group: "Finance", title: "Record Vendor Invoice", subtitle: "Add received invoice", href: "/invoices/new", permission: "invoices.create" },
  { group: "Finance", title: "New Vendor Payment", subtitle: "Record vendor payment", href: "/vendor-payments/new", permission: "vendor_payments.create" },
  { group: "Organization", title: "Add Client", subtitle: "Create client", href: "/clients/new", permission: "clients.create" },
  { group: "Organization", title: "Add Branch", subtitle: "Create branch", href: "/branches/new", permission: "branches.create" },
  { group: "Organization", title: "Add Role", subtitle: "Create role", href: "/roles/new", permission: "roles.create" },
  { group: "Inventory & Services", title: "Add Category", subtitle: "Create category", href: "/categories/new", permission: "categories.create" },
  { group: "Inventory & Services", title: "Add Item", subtitle: "Create item", href: "/items/new", permission: "items.create" },
  { group: "Inventory & Services", title: "Add Rate Card", subtitle: "Create rate card", href: "/rate-cards/new", permission: "rate_cards.create" },
  { group: "Finance", title: "View Ledger", subtitle: "Review posted entries", href: "/ledger", permission: "ledger.read" },
  { group: "Reports", title: "Finance Reports", subtitle: "Open payables reports", href: "/finance-reports", permission: "reports.read" },
];

const dashboardQuickActionOrder = [
  "Add Company",
  "Add Company Admin",
  "Add User",
  "New Service Request",
  "Add Vendor",
  "New RFQ",
  "Record Vendor Invoice",
  "New Vendor Payment",
  "Add Client",
  "Add Branch",
  "Add Role",
  "Add Category",
  "Add Item",
  "Add Rate Card",
  "View Ledger",
  "Finance Reports",
] as const;

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
        soft: "bg-violet-50 text-violet-700",
      };
    case "green":
      return {
        iconWrap: "bg-emerald-50 text-emerald-600 ring-emerald-100",
        soft: "bg-emerald-50 text-emerald-700",
      };
    case "amber":
      return {
        iconWrap: "bg-amber-50 text-amber-600 ring-amber-100",
        soft: "bg-amber-50 text-amber-700",
      };
    case "orange":
      return {
        iconWrap: "bg-orange-50 text-orange-600 ring-orange-100",
        soft: "bg-orange-50 text-orange-700",
      };
    case "red":
      return {
        iconWrap: "bg-rose-50 text-rose-600 ring-rose-100",
        soft: "bg-rose-50 text-rose-700",
      };
    case "blue":
    default:
      return {
        iconWrap: "bg-blue-50 text-blue-600 ring-blue-100",
        soft: "bg-blue-50 text-blue-700",
      };
  }
}

function DashboardIcon({ icon }: { icon: DashboardIconName }) {
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

  if (icon === "mail") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect x="4" y="6" width="16" height="12" rx="3" />
        <path d="m6.5 8.5 5.5 4 5.5-4" />
      </svg>
    );
  }

  if (icon === "rfq") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect x="5" y="4" width="14" height="16" rx="2.5" />
        <path d="M8 8h8M8 12h8M8 16h5" />
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
  const isPositive = metric.trend.direction === "up";

  return (
    <PrefetchLink
      href={metric.href}
      className="group min-h-[108px] rounded-[18px] border border-[#e7edf7] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,35,71,0.04)] transition hover:-translate-y-0.5 hover:border-[#d9e3f2]"
    >
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] ring-1 ${tones.iconWrap}`}>
          <div className="scale-[0.95]">
            <DashboardIcon icon={metric.icon} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5 text-[#6f83a8]">{metric.title}</p>
          <p className="mt-1 text-[2.05rem] font-semibold leading-none tracking-[-0.03em] text-[#122447]">{formatCount(metric.value)}</p>
          <p className="mt-2 text-[13px] leading-5 text-[#7f90ac]">{metric.note}</p>
        </div>
      </div>
      <div className={`mt-3 flex items-center justify-end gap-1 text-xs font-semibold ${isPositive ? "text-[#22b573]" : "text-[#ff5d6c]"}`}>
        <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 ${isPositive ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" />
        </svg>
        <span>{metric.trend.value}</span>
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
    <div className="grid gap-5 border-b border-[#edf2fb] pb-6 last:border-b-0 last:pb-0 lg:grid-cols-[120px_minmax(0,1fr)] xl:border-b-0 xl:border-r xl:pb-0 xl:pr-5 xl:last:border-r-0 xl:last:pr-0">
      <div className="space-y-4">
        <p className="text-[13px] font-medium text-[#687da3]">{title}</p>
        <div className="relative h-[104px] w-[104px] rounded-full" style={{ background: buildRingBackground(legend) }}>
          <div className="absolute inset-[9px] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(231,238,248,0.95)]">
            <span className="text-[2rem] font-semibold leading-none tracking-[-0.03em] text-[#122447]">{formatCount(metricValue)}</span>
            <span className="mt-1 text-[12px] font-medium text-[#7286a8]">{metricLabel}</span>
          </div>
        </div>
      </div>
      <div className="grid content-center gap-2">
        {legend.map((item) => (
          <div key={item.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="truncate text-[#697d9f]">{item.label}</span>
            <span className="font-medium text-[#203459]">{formatCount(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickActionTile({ action }: { action: QuickAction }) {
  const iconMap: Record<string, DashboardIconName> = {
    "Add Company": "building",
    "Add Company Admin": "users",
    "Add User": "users",
    "New Service Request": "headset",
    "Add Vendor": "building",
    "New RFQ": "rfq",
    "Record Vendor Invoice": "invoice",
    "New Vendor Payment": "wallet",
    "Add Client": "clients",
    "Add Branch": "building",
    "Add Role": "users",
    "Add Category": "tasks",
    "Add Item": "tasks",
    "Add Rate Card": "invoice",
    "View Ledger": "wallet",
    "Finance Reports": "invoice",
  };
  const toneMap: Record<string, FocusMetric["tone"]> = {
    "Add Company": "blue",
    "Add Company Admin": "violet",
    "Add User": "green",
    "New Service Request": "blue",
    "Add Vendor": "amber",
    "New RFQ": "green",
    "Record Vendor Invoice": "orange",
    "New Vendor Payment": "blue",
    "Add Client": "blue",
    "Add Branch": "amber",
    "Add Role": "violet",
    "Add Category": "green",
    "Add Item": "blue",
    "Add Rate Card": "orange",
    "View Ledger": "blue",
    "Finance Reports": "violet",
  };
  const icon = iconMap[action.title] ?? "building";
  const tones = toneClasses(toneMap[action.title] ?? "blue");

  return (
    <PrefetchLink
      href={action.href}
      className="group flex items-center gap-3 rounded-[14px] border border-[#e7edf7] bg-[#fcfdff] px-3.5 py-3.5 transition hover:border-[#d7e0f0] hover:bg-white"
    >
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ${tones.iconWrap}`}>
        <DashboardIcon icon={icon} />
      </div>
      <p className="min-w-0 truncate text-[14px] font-medium text-[#213457]">{action.title}</p>
    </PrefetchLink>
  );
}

function AlertRow({ item }: { item: AlertCard }) {
  const tones = toneClasses(item.tone);

  return (
    <PrefetchLink href={item.href} className="flex items-center gap-3 border-b border-[#eef3fa] px-1 py-4 last:border-b-0 transition hover:bg-[#fafcff]">
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ring-1 ${tones.iconWrap}`}>
        <DashboardIcon icon={item.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-[#213457]">{item.title}</p>
        <p className="truncate text-[12px] text-[#8494af]">{item.subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`min-w-9 rounded-full px-2.5 py-1 text-center text-sm font-semibold ${tones.soft}`}>{formatCount(item.count)}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#9caac0]" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>
    </PrefetchLink>
  );
}

function getDashboardServiceRequestStatus(status: ServiceRequestStatus) {
  if (status === ServiceRequestStatus.BLOCKED) {
    return { label: "On Hold", className: "bg-[#fff3e5] text-[#d9822b]" };
  }

  if (status === ServiceRequestStatus.COMPLETED || status === ServiceRequestStatus.CLOSED) {
    return { label: "Resolved", className: "bg-[#e7f8ee] text-[#2aa56e]" };
  }

  if (status === ServiceRequestStatus.RAISED || status === ServiceRequestStatus.TRIAGED) {
    return { label: "Open", className: "bg-[#ebf2ff] text-[#3767ff]" };
  }

  return { label: "In Progress", className: "bg-[#ebf2ff] text-[#3767ff]" };
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
          serviceRequests,
          openServiceRequests,
          totalInvoices,
          invoiceStatusRows,
          ledgerEntriesCount,
          vendorPaymentStatusRows,
          taskStatusRows,
          serviceRequestStatusRows,
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
          can("service_requests.read") ? prisma.serviceRequest.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("service_requests.read")
            ? prisma.serviceRequest.count({
                where: {
                  ...scopeByTenant(session, { deletedAt: null }),
                  status: { in: openServiceStatuses },
                },
              })
            : Promise.resolve(0),
          can("invoices.read") ? prisma.invoice.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
          can("invoices.read")
            ? prisma.invoice.groupBy({
                by: ["status"],
                where: scopeByTenant(session, { deletedAt: null }),
                _count: { _all: true },
              })
            : Promise.resolve([]),
          can("ledger.read") ? prisma.ledgerEntry.count({ where: scopeByTenant(session, {}) }) : Promise.resolve(0),
          can("vendor_payments.read")
            ? prisma.vendorPayment.groupBy({
                by: ["status"],
                where: scopeByTenant(session, {}),
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
          can("service_requests.read")
            ? prisma.serviceRequest.groupBy({
                by: ["status"],
                where: scopeByTenant(session, { deletedAt: null }),
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
                take: 15,
                select: { id: true, name: true },
              })
            : Promise.resolve([]),
        ]);

        return {
          companies,
          activeCompanies,
          users,
          activeUsers,
          serviceRequests,
          openServiceRequests,
          totalInvoices,
          invoiceStatusRows,
          ledgerEntriesCount,
          vendorPaymentStatusRows,
          taskStatusRows,
          serviceRequestStatusRows,
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
    serviceRequests,
    openServiceRequests,
    totalInvoices,
    invoiceStatusRows,
    ledgerEntriesCount,
    vendorPaymentStatusRows,
    taskStatusRows,
    serviceRequestStatusRows,
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
  const pendingVendorPayments = vendorPaymentPendingStatuses.reduce((sum, status) => sum + getStatusCount(vendorPaymentStatusRows, status), 0);
  const completedVendorPayments =
    getStatusCount(vendorPaymentStatusRows, PaymentStatus.PAID) + getStatusCount(vendorPaymentStatusRows, PaymentStatus.PARTIALLY_PAID);
  const failedVendorPayments =
    getStatusCount(vendorPaymentStatusRows, PaymentStatus.REJECTED) + getStatusCount(vendorPaymentStatusRows, PaymentStatus.CANCELLED);
  const financePulseNote = can("ledger.read") ? `${formatCount(ledgerEntriesCount)} ledger entries` : "All vendors";

  const quickActionLookup = new Map(
    quickActionDefinitions
      .filter((action) => !(action.superAdminOnly && !isSuperAdmin) && can(action.permission))
      .map((action) => [action.title, action] as const)
  );
  const quickActions = dashboardQuickActionOrder
    .map((title) => quickActionLookup.get(title))
    .filter((action): action is QuickAction => Boolean(action))
    .slice(0, 8);

  const title = isSuperAdmin ? "Platform Dashboard" : isCompanyAdmin ? "Company Dashboard" : "Dashboard";
  const subtitle = isSuperAdmin
    ? "Centralized operations and tenant health at a glance."
    : isCompanyAdmin
      ? "Operational visibility for your service partner workspace."
      : "Workspace activity and service operations overview.";

  const focusMetrics: FocusMetric[] = [
    ...(can("service_partners.read") && isSuperAdmin
      ? [
          {
            id: "active-companies",
            title: "Active Companies",
            value: activeCompanies,
            note: "All companies",
            trend: { value: "8%", direction: "up" as const },
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
            note: "All users",
            trend: { value: "12%", direction: "up" as const },
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
            note: "All requests",
            trend: { value: "-5%", direction: "down" as const },
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
            note: "In progress",
            trend: { value: "6%", direction: "up" as const },
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
            note: `${formatCount(totalInvoices)} total invoices`,
            trend: { value: "3%", direction: "up" as const },
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
            note: financePulseNote,
            trend: { value: "7%", direction: "up" as const },
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
            note: "Past due",
            trend: { value: "-8%", direction: "down" as const },
            href: "/tasks",
            icon: "clock" as const,
            tone: "red" as const,
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
    { label: "Approved", value: approvedInvoices, color: "#f6c56d" },
    { label: "Paid", value: paidInvoices, color: "#23b26d" },
    {
      label: "Overdue",
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
            subtitle: "Requires your approval",
            count: pendingEmailChangeRequests,
            href: "/email-change-requests",
            icon: "mail" as const,
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
            subtitle: "Awaiting approval",
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
    <section className="crm-page gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.04em] text-[#122447]">{title}</h1>
          <p className="mt-1.5 text-[14px] text-[#7a8ca8]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#8191aa]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 12a8 8 0 1 1-2.34-5.66" />
            <path d="M20 4v6h-6" />
          </svg>
          <span>Last updated: {formatDateTime(now)}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {focusMetrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.78fr)_356px]">
        <div className="space-y-5">
          <section className="rounded-[18px] border border-[#e5ecf7] bg-white p-5 shadow-[0_10px_26px_rgba(15,35,71,0.04)] sm:p-6">
            <h2 className="text-[1.05rem] font-semibold text-[#183059]">Operational Health</h2>
            <div className="mt-6 grid gap-6 xl:grid-cols-4">
              <HealthRing title="Service Requests" metricValue={openServiceRequests} metricLabel="Open" legend={serviceRequestLegend} />
              <HealthRing title="Tasks" metricValue={ongoingTasks} metricLabel="Total" legend={taskLegend} />
              <HealthRing title="Vendor Invoices" metricValue={pendingInvoices} metricLabel="Pending" legend={invoiceLegend} />
              <HealthRing title="Payments" metricValue={pendingVendorPayments} metricLabel="Pending" legend={paymentLegend} />
            </div>
          </section>

          <section className="overflow-hidden rounded-[18px] border border-[#e5ecf7] bg-white shadow-[0_10px_26px_rgba(15,35,71,0.04)]">
            <div className="flex items-center justify-between gap-3 border-b border-[#edf2fb] px-5 py-4 sm:px-6">
              <h2 className="text-[1.05rem] font-semibold text-[#183059]">Recent Service Requests</h2>
              {can("service_requests.read") ? (
                <PrefetchLink href="/service-requests" className="text-[13px] font-semibold text-[#3767ff]">
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
                    const dashboardStatus = getDashboardServiceRequestStatus(request.status);

                    return (
                      <article key={request.id} className="rounded-[18px] border border-[#edf2fb] bg-[#fbfcff] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#3767ff]">{request.serviceNumber}</p>
                            <p className="mt-1 text-sm font-medium text-[#213457]">{request.servicePartner.name}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${dashboardStatus.className}`}>{dashboardStatus.label}</span>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {isSuperAdmin ? (
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ea0bc]">Company</p>
                              <p className="mt-1 text-sm text-[#213457]">{request.servicePartner.name}</p>
                            </div>
                          ) : null}
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ea0bc]">Client</p>
                            <p className="mt-1 text-sm text-[#213457]">{request.client.name}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ea0bc]">Current Owner</p>
                            <p className="mt-1 text-sm text-[#213457]">{ownerLabel}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ea0bc]">Requested At</p>
                            <p className="mt-1 text-sm text-[#213457]">{formatDateTime(request.requestedAt ?? request.createdAt)}</p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="crm-scroll-shell hidden md:block">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-[#8a9ab4]">
                        <th className="px-5 py-3 font-semibold sm:px-6">Request No.</th>
                        {isSuperAdmin ? <th className="px-5 py-3 font-semibold sm:px-6">Company</th> : null}
                        <th className="px-5 py-3 font-semibold sm:px-6">Client</th>
                        <th className="px-5 py-3 font-semibold sm:px-6">Status</th>
                        <th className="px-5 py-3 font-semibold sm:px-6">Current Owner</th>
                        <th className="px-5 py-3 font-semibold sm:px-6">Requested At</th>
                        <th className="px-5 py-3 font-semibold sm:px-6">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRequests.map((request) => {
                        const ownerLabel = getServiceRequestOwnerLabel(request.assignments);
                        const ownerInitials = getInitials(ownerLabel);
                        const dashboardStatus = getDashboardServiceRequestStatus(request.status);

                        return (
                          <tr key={request.id} className="border-t border-[#edf2fb] text-[#203459]">
                            <td className="px-5 py-4 font-semibold text-[#3767ff] sm:px-6">{request.serviceNumber}</td>
                            {isSuperAdmin ? <td className="px-5 py-4 sm:px-6">{request.servicePartner.name}</td> : null}
                            <td className="px-5 py-4 sm:px-6">{request.client.name}</td>
                            <td className="px-5 py-4 sm:px-6">
                              <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${dashboardStatus.className}`}>
                                {dashboardStatus.label}
                              </span>
                            </td>
                            <td className="px-5 py-4 sm:px-6">
                              <div className="flex items-center gap-3">
                                <div className="grid h-8 w-8 place-items-center rounded-full bg-[#34226f] text-[11px] font-semibold text-white">
                                  {ownerInitials || "NA"}
                                </div>
                                <span className="font-medium text-[#213457]">{ownerLabel}</span>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-[#667c9d] sm:px-6">{formatDateTime(request.requestedAt ?? request.createdAt)}</td>
                            <td className="px-5 py-4 sm:px-6">
                              <PrefetchLink
                                href={`/service-requests/${request.id}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#dfe7f5] text-[#3767ff] transition hover:bg-[#f6f9ff]"
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

                <div className="flex items-center justify-between gap-3 border-t border-[#edf2fb] px-5 py-3 text-xs text-[#8595af] sm:px-6">
                  <span>
                    Showing 1 to {recentRequests.length} of {serviceRequests} requests
                  </span>
                  <div className="flex items-center gap-2">
                    <button type="button" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0e7f4] text-[#a0aec4]" aria-label="Previous page">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m15 6-6 6 6 6" />
                      </svg>
                    </button>
                    <span className="grid h-7 min-w-7 place-items-center rounded-md bg-[#4e5cff] px-2 text-white">1</span>
                    <button type="button" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0e7f4] text-[#a0aec4]" aria-label="Next page">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          {isSuperAdmin && companyDirectory.length > 0 ? (
            <section className="rounded-[18px] border border-[#e5ecf7] bg-white p-5 shadow-[0_10px_26px_rgba(15,35,71,0.04)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[1.05rem] font-semibold text-[#183059]">Company Directory</h2>
                <PrefetchLink href="/service-partners" className="text-[13px] font-semibold text-[#3767ff]">
                  View all
                </PrefetchLink>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                {companyDirectory.map((company) => (
                  <PrefetchLink
                    key={company.id}
                    href={`/service-partners/${company.id}`}
                    className="flex min-h-[54px] items-center gap-3 rounded-[14px] border border-[#e8eef7] bg-[#fcfdff] px-4 py-3.5 text-[14px] font-medium text-[#213457] transition hover:border-[#d7e1f0] hover:bg-white"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-[#6e82a8] shadow-[inset_0_0_0_1px_rgba(226,233,244,1)]">
                      <DashboardIcon icon="building" />
                    </div>
                    <span className="truncate">{company.name}</span>
                  </PrefetchLink>
                ))}
              </div>
              <p className="mt-4 text-center text-xs text-[#8a9ab4]">Showing 1 to {companyDirectory.length} of {companies} companies</p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section id="dashboard-quick-actions" className="rounded-[18px] border border-[#e5ecf7] bg-white p-5 shadow-[0_10px_26px_rgba(15,35,71,0.04)] sm:p-6">
            <h2 className="text-[1.05rem] font-semibold text-[#183059]">Quick Actions</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 2xl:grid-cols-2">
              {quickActions.length === 0 ? (
                <EmptyState title="No quick actions available" description="Available actions will appear here when your role has create access." />
              ) : (
                quickActions.map((action) => <QuickActionTile key={action.title} action={action} />)
              )}
            </div>
          </section>

          <section id="dashboard-alerts" className="rounded-[18px] border border-[#e5ecf7] bg-white p-5 shadow-[0_10px_26px_rgba(15,35,71,0.04)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[1.05rem] font-semibold text-[#183059]">Alerts / Pending Actions</h2>
              {visibleAlerts.length > 0 ? (
                <PrefetchLink href={alertsViewAllHref} className="text-[13px] font-semibold text-[#3767ff]">
                  View all
                </PrefetchLink>
              ) : null}
            </div>
            <div className="mt-3">
              {visibleAlerts.length === 0 ? (
                <EmptyState title="No pending alerts" description="Critical review items will appear here when counts move above zero." />
              ) : (
                visibleAlerts.map((item) => <AlertRow key={item.title} item={item} />)
              )}
            </div>
          </section>

          {!isSuperAdmin && companyProfile ? (
            <section className="rounded-[18px] border border-[#e5ecf7] bg-white p-5 shadow-[0_10px_26px_rgba(15,35,71,0.04)] sm:p-6">
              <h2 className="text-[1.05rem] font-semibold text-[#183059]">Company Profile</h2>
              <div className="mt-4 grid gap-3">
                {[
                  { label: "Name", value: companyProfile.name },
                  { label: "Code", value: companyProfile.code },
                  { label: "Status", value: companyProfile.status },
                  { label: "Contact", value: companyProfile.email ?? companyProfile.phone ?? "-" },
                ].map((item) => (
                  <div key={item.label} className="rounded-[14px] border border-[#e7edf7] bg-[#fcfdff] px-4 py-3.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ea0bc]">{item.label}</p>
                    <p className="mt-2 text-sm font-medium text-[#213457]">{item.value}</p>
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
