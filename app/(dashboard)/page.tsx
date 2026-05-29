import { ServiceRequestStatus } from "@prisma/client";
import Link from "next/link";

import { getUserPermissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type DashboardPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type KpiCard = {
  title: string;
  value: number;
  note: string;
  href: string;
};

type QuickAction = {
  title: string;
  subtitle: string;
  href: string;
  permission: string;
};

type ModuleCard = {
  title: string;
  description: string;
  href?: string;
  permission: string;
  count?: number;
  comingSoon?: boolean;
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

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatStatusLabel(status: ServiceRequestStatus) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function statusClass(status: ServiceRequestStatus) {
  if (status === ServiceRequestStatus.IN_PROGRESS) return "bg-[#e8efff] text-[#2854e8]";
  if (status === ServiceRequestStatus.RAISED || status === ServiceRequestStatus.TRIAGED) return "bg-[#e9f1ff] text-[#325eff]";
  if (status === ServiceRequestStatus.COMPLETED || status === ServiceRequestStatus.CLOSED) return "bg-[#e8faf1] text-[#109a4a]";
  if (status === ServiceRequestStatus.BLOCKED) return "bg-[#fff2e8] text-[#ee7a16]";
  if (status === ServiceRequestStatus.CANCELLED) return "bg-[#ffecec] text-[#ef4444]";
  return "bg-[#eef2ff] text-[#435c85]";
}

function resolvePriority(targetDate: Date | null, status: ServiceRequestStatus) {
  if (!targetDate) {
    return "Medium";
  }
  if (status === ServiceRequestStatus.COMPLETED || status === ServiceRequestStatus.CLOSED || status === ServiceRequestStatus.CANCELLED) {
    return "Low";
  }
  if (targetDate.getTime() < Date.now()) {
    return "High";
  }
  return "Medium";
}

function priorityClass(priority: string) {
  if (priority === "High") return "bg-[#ffecec] text-[#ef4444]";
  if (priority === "Low") return "bg-[#e8faf1] text-[#109a4a]";
  return "bg-[#fff8e8] text-[#d97706]";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await requirePermission("dashboard.read");
  const params = await resolveSearchParams(searchParams);
  const dateRange = getStringParam(params, "range") ?? "30d";

  const permissionSet = session.user.isSuperAdmin ? null : new Set(await getUserPermissions(session.user.id, session.user.roleKeys));
  const can = (permissionKey: string) => session.user.isSuperAdmin || Boolean(permissionSet?.has(permissionKey));

  const now = new Date();
  const todayStart = startOfDay(now);

  const tenantScopedWhere = scopeByTenant(session, { deletedAt: null });
  const tenantScopedRequestWhere = scopeByTenant(session, { deletedAt: null });
  const isCompanyAdmin = !session.user.isSuperAdmin && session.user.roleKeys.includes("company_admin");
  const dashboardTitle = session.user.isSuperAdmin ? "Super Admin Dashboard" : isCompanyAdmin ? "Company Dashboard" : "My Dashboard";
  const dashboardSubtitle = session.user.isSuperAdmin
    ? "Platform-wide command center"
    : isCompanyAdmin
      ? "Company-level operations overview"
      : "Permission-scoped workspace summary";

  const [
    companiesCount,
    usersCount,
    rolesCount,
    permissionsCount,
    clientsCount,
    branchesCount,
    categoriesCount,
    itemsCount,
    rateCardsCount,
    serviceRequestsCount,
    openRequestsCount,
    completedRequestsCount,
    overdueRequestsCount,
    recentRequests,
    companyProfile,
    recentActivities,
    topCompanyRows,
  ] = await Promise.all([
    can("service_partners.read")
      ? session.user.isSuperAdmin
        ? prisma.servicePartner.count({ where: { deletedAt: null } })
        : prisma.servicePartner.count({ where: { id: session.user.servicePartnerId, deletedAt: null } })
      : Promise.resolve(0),
    can("users.read") ? prisma.user.count({ where: tenantScopedWhere }) : Promise.resolve(0),
    can("roles.read") ? prisma.role.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
    can("permissions.read") ? prisma.permission.count() : Promise.resolve(0),
    can("clients.read") ? prisma.client.count({ where: tenantScopedWhere }) : Promise.resolve(0),
    can("branches.read") ? prisma.branch.count({ where: tenantScopedWhere }) : Promise.resolve(0),
    can("categories.read") ? prisma.category.count({ where: tenantScopedWhere }) : Promise.resolve(0),
    can("items.read") ? prisma.item.count({ where: tenantScopedWhere }) : Promise.resolve(0),
    can("rate_cards.read") ? prisma.rateCard.count({ where: tenantScopedWhere }) : Promise.resolve(0),
    can("service_requests.read") ? prisma.serviceRequest.count({ where: tenantScopedRequestWhere }) : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.count({
          where: {
            ...tenantScopedRequestWhere,
            status: { in: openServiceStatuses },
          },
        })
      : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.count({
          where: {
            ...tenantScopedRequestWhere,
            status: ServiceRequestStatus.COMPLETED,
          },
        })
      : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.count({
          where: {
            ...tenantScopedRequestWhere,
            status: { in: openServiceStatuses },
            targetDate: { lt: todayStart },
          },
        })
      : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.findMany({
          where: tenantScopedRequestWhere,
          orderBy: [{ createdAt: "desc" }],
          take: 10,
          include: {
            client: { select: { name: true } },
            branch: { select: { name: true } },
            servicePartner: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    !session.user.isSuperAdmin
      ? prisma.servicePartner.findFirst({
          where: {
            id: session.user.servicePartnerId,
            deletedAt: null,
          },
          select: {
            name: true,
            code: true,
            status: true,
            email: true,
            phone: true,
          },
        })
      : Promise.resolve(null),
    can("activity_logs.read")
      ? prisma.activityLog.findMany({
          where: scopeByTenant(session, {}),
          orderBy: [{ createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            action: true,
            module: true,
            message: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    session.user.isSuperAdmin && can("service_requests.read")
      ? prisma.serviceRequest.groupBy({
          by: ["servicePartnerId"],
          where: { deletedAt: null },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  const topCompanyMeta =
    session.user.isSuperAdmin && topCompanyRows.length > 0
      ? await prisma.servicePartner.findMany({
          where: {
            id: {
              in: topCompanyRows.map((row) => row.servicePartnerId),
            },
          },
          select: { id: true, name: true, code: true },
        })
      : [];

  const topCompanyNameMap = new Map(topCompanyMeta.map((company) => [company.id, `${company.name} (${company.code})`]));

  const superAdminKpis: KpiCard[] = [
    { title: "Companies", value: companiesCount, note: "Service partners", href: "/service-partners" },
    { title: "Users", value: usersCount, note: "Platform users", href: "/users" },
    { title: "Roles", value: rolesCount, note: "Defined roles", href: "/roles" },
    { title: "Permissions", value: permissionsCount, note: "Permission keys", href: "/permissions" },
    { title: "Clients", value: clientsCount, note: "Total clients", href: "/clients" },
    { title: "Branches", value: branchesCount, note: "Total branches", href: "/branches" },
    { title: "Categories", value: categoriesCount, note: "Service categories", href: "/categories" },
    { title: "Items", value: itemsCount, note: "Service items", href: "/items" },
    { title: "Rate Cards", value: rateCardsCount, note: "RC records", href: "/rate-cards" },
    { title: "Service Requests", value: serviceRequestsCount, note: "Total requests", href: "/service-requests" },
    { title: "Open Requests", value: openRequestsCount, note: "Open pipeline", href: "/service-requests" },
    { title: "Overdue Requests", value: overdueRequestsCount, note: "Past due", href: "/service-requests" },
  ];

  const companyKpis: KpiCard[] = [
    { title: "Client Users", value: usersCount, note: "Company users", href: "/users" },
    { title: "Roles", value: rolesCount, note: "Tenant roles", href: "/roles" },
    { title: "Clients", value: clientsCount, note: "Company clients", href: "/clients" },
    { title: "Branches", value: branchesCount, note: "Company branches", href: "/branches" },
    { title: "Categories", value: categoriesCount, note: "Service categories", href: "/categories" },
    { title: "Items", value: itemsCount, note: "Service items", href: "/items" },
    { title: "Rate Cards", value: rateCardsCount, note: "RC entries", href: "/rate-cards" },
    { title: "Service Requests", value: serviceRequestsCount, note: "Total requests", href: "/service-requests" },
    { title: "Open Requests", value: openRequestsCount, note: "Open queue", href: "/service-requests" },
    { title: "Completed Requests", value: completedRequestsCount, note: "Completed requests", href: "/service-requests" },
    { title: "Overdue Requests", value: overdueRequestsCount, note: "Past due", href: "/service-requests" },
  ];

  const kpiCards = (session.user.isSuperAdmin ? superAdminKpis : companyKpis).filter((card) => {
    if (card.href === "/service-partners") return can("service_partners.read");
    if (card.href === "/users") return can("users.read");
    if (card.href === "/roles") return can("roles.read");
    if (card.href === "/permissions") return can("permissions.read");
    if (card.href === "/clients") return can("clients.read");
    if (card.href === "/branches") return can("branches.read");
    if (card.href === "/categories") return can("categories.read");
    if (card.href === "/items") return can("items.read");
    if (card.href === "/rate-cards") return can("rate_cards.read");
    if (card.href === "/service-requests") return can("service_requests.read");
    return true;
  });

  const quickActions: QuickAction[] = [
    { title: "Add Company", subtitle: "Create service partner", href: "/service-partners/new", permission: "service_partners.create" },
    { title: "Add Company Admin", subtitle: "Create company admin user", href: "/users/new", permission: "users.create" },
    { title: "Add User", subtitle: "Create client user", href: "/users/new", permission: "users.create" },
    { title: "Add Role", subtitle: "Create company role", href: "/roles/new", permission: "roles.create" },
    { title: "Add Client", subtitle: "Create client", href: "/clients/new", permission: "clients.create" },
    { title: "Add Branch", subtitle: "Create branch", href: "/branches/new", permission: "branches.create" },
    { title: "Add Category", subtitle: "Create category", href: "/categories/new", permission: "categories.create" },
    { title: "Add Item", subtitle: "Create item", href: "/items/new", permission: "items.create" },
    { title: "Add Rate Card", subtitle: "Create RC", href: "/rate-cards/new", permission: "rate_cards.create" },
    { title: "New Service Request", subtitle: "Create request", href: "/service-requests/new", permission: "service_requests.create" },
  ].filter((action) => can(action.permission));

  const moduleCards: ModuleCard[] = [
    { title: "Client User Management", description: "Manage company users and statuses.", href: "/users", permission: "users.read", count: usersCount },
    { title: "Roles", description: "Manage tenant roles and access.", href: "/roles", permission: "roles.read", count: rolesCount },
    { title: "Permissions", description: "View permission catalog.", href: "/permissions", permission: "permissions.read", count: permissionsCount },
    { title: "Clients", description: "Manage client organizations.", href: "/clients", permission: "clients.read", count: clientsCount },
    { title: "Branch Management", description: "Manage client branches.", href: "/branches", permission: "branches.read", count: branchesCount },
    { title: "Service Requests", description: "Track service requests.", href: "/service-requests", permission: "service_requests.read", count: serviceRequestsCount },
    { title: "Category Management", description: "Manage service categories.", href: "/categories", permission: "categories.read", count: categoriesCount },
    { title: "Items", description: "Manage service items.", href: "/items", permission: "items.read", count: itemsCount },
    { title: "RC Management", description: "Manage rate cards.", href: "/rate-cards", permission: "rate_cards.read", count: rateCardsCount },
    { title: "Activity Log", description: "Review recent activity.", href: "/activity-log", permission: "activity_logs.read" },
    { title: "Settings", description: "Workspace settings.", href: "/settings", permission: "settings.read" },
    { title: "Inventory Management", description: "Inventory workflows are planned.", permission: "inventory.read", comingSoon: true },
    { title: "Supplier Management", description: "Supplier workflows are planned.", permission: "suppliers.read", comingSoon: true },
    { title: "Tasks", description: "Task management is planned.", permission: "tasks.read", comingSoon: true },
    { title: "Ledger", description: "Ledger workflows are planned.", permission: "ledger.read", comingSoon: true },
    { title: "Quotations", description: "Quotation workflows are planned.", permission: "quotations.read", comingSoon: true },
    { title: "Payments", description: "Payment workflows are planned.", permission: "payments.read", comingSoon: true },
    { title: "Expenses", description: "Expense workflows are planned.", permission: "expenses.read", comingSoon: true },
    { title: "Vendors Quotation List", description: "Vendor quotation list is planned.", permission: "vendor_quotations.read", comingSoon: true },
    { title: "RFQ List", description: "RFQ workflows are planned.", permission: "rfq.read", comingSoon: true },
    { title: "PO List", description: "Purchase order workflows are planned.", permission: "purchase_orders.read", comingSoon: true },
    { title: "Invoice List", description: "Invoice workflows are planned.", permission: "invoices.read", comingSoon: true },
    { title: "Vendors Payment List", description: "Vendor payment workflows are planned.", permission: "vendor_payments.read", comingSoon: true },
  ].filter((card) => can(card.permission));

  const displayName = session.user.name?.trim() || session.user.email || session.user.phone || "User";
  const effectiveCompanyName = companyProfile?.name ?? "Platform";

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold text-[#111f3d]">{dashboardTitle}</h1>
            <p className="text-sm text-[#667b9f]">{dashboardSubtitle}</p>
            <p className="mt-2 text-sm text-[#516a95]">
              Logged in as: <span className="font-semibold">{displayName}</span> | Company:{" "}
              <span className="font-semibold">{effectiveCompanyName}</span> | Role:{" "}
              <span className="font-semibold">{session.user.isSuperAdmin ? "Super Admin" : isCompanyAdmin ? "Company Admin" : "Company User"}</span>
            </p>
          </div>
          <form method="get" className="flex items-center gap-2 rounded-xl border border-[#dbe5f4] bg-[#f9fbff] px-3 py-2">
            <label htmlFor="range" className="text-xs font-medium text-[#6b80a8]">
              Date Range
            </label>
            <select
              id="range"
              name="range"
              defaultValue={dateRange}
              className="rounded-md border border-[#d9e2f3] bg-white px-2 py-1 text-sm"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
            <button type="submit" className="rounded-md border border-[#d9e2f3] bg-white px-2 py-1 text-xs font-medium">
              Apply
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <Link key={card.title} href={card.href} className="rounded-xl border border-[#e5ebf6] bg-white p-4 shadow-sm hover:bg-[#f8fbff]">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">{card.title}</p>
            <p className="mt-1 text-3xl font-bold text-[#123064]">{card.value}</p>
            <p className="text-sm text-[#6f84a9]">{card.note}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 2xl:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-[#e3eaf6] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-xl font-semibold text-[#122447]">Recent Service Requests</h2>
            {can("service_requests.read") ? <Link href="/service-requests" className="text-sm font-semibold text-[#2d5fff]">View all</Link> : null}
          </div>
          {!can("service_requests.read") ? (
            <p className="px-5 py-4 text-sm text-[#6f84a9]">You do not have permission to view service requests.</p>
          ) : recentRequests.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[#6f84a9]">No recent service requests found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[#7c8fb2]">
                    <th className="px-5 py-3">Request #</th>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">Client</th>
                    <th className="px-5 py-3">Branch</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Priority</th>
                    <th className="px-5 py-3">Requested At</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRequests.map((request) => {
                    const priority = resolvePriority(request.targetDate, request.status);
                    return (
                      <tr key={request.id} className="border-t border-[#edf2fb] text-[#1d335d]">
                        <td className="px-5 py-3 font-semibold text-[#2454e6]">{request.serviceNumber}</td>
                        <td className="px-5 py-3">{request.title}</td>
                        <td className="px-5 py-3">{request.client.name}</td>
                        <td className="px-5 py-3">{request.branch?.name ?? "-"}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(request.status)}`}>
                            {formatStatusLabel(request.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${priorityClass(priority)}`}>{priority}</span>
                        </td>
                        <td className="px-5 py-3">{formatDateTime(request.requestedAt ?? request.createdAt)}</td>
                        <td className="px-5 py-3">
                          <Link href={`/service-requests/${request.id}`} className="text-[#2454e6]">
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-[#e3eaf6] bg-white shadow-sm">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-xl font-semibold text-[#122447]">Quick Actions</h2>
            </div>
            <div className="space-y-1 p-3">
              {quickActions.length === 0 ? (
                <p className="px-2 py-3 text-sm text-[#6f84a9]">No quick actions available for your role.</p>
              ) : (
                quickActions.map((action) => (
                  <Link key={action.title} href={action.href} className="block rounded-xl px-3 py-3 hover:bg-[#f5f8ff]">
                    <p className="text-base font-semibold text-[#132445]">{action.title}</p>
                    <p className="text-sm text-[#6f84a9]">{action.subtitle}</p>
                  </Link>
                ))
              )}
            </div>
          </section>

          {!session.user.isSuperAdmin && companyProfile ? (
            <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-[#122447]">Company Info</h2>
              <div className="mt-3 space-y-1 text-sm text-[#1d335d]">
                <p>
                  <span className="text-[#6f84a9]">Company:</span> {companyProfile.name}
                </p>
                <p>
                  <span className="text-[#6f84a9]">Code:</span> {companyProfile.code}
                </p>
                <p>
                  <span className="text-[#6f84a9]">Status:</span> {companyProfile.status}
                </p>
                <p>
                  <span className="text-[#6f84a9]">Contact:</span> {companyProfile.email ?? companyProfile.phone ?? "-"}
                </p>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#122447]">Activity</h2>
            {recentActivities.length === 0 ? (
              <p className="mt-2 text-sm text-[#6f84a9]">Activity will appear here.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {recentActivities.map((entry) => (
                  <p key={entry.id} className="text-sm">
                    <span className="font-medium text-[#132445]">{entry.module}</span> {entry.action}
                    <span className="block text-xs text-[#7c8fb2]">{formatDateTime(entry.createdAt)}</span>
                  </p>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {session.user.isSuperAdmin && topCompanyRows.length > 0 ? (
        <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-[#122447]">Top Companies by Service Requests</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {topCompanyRows.map((row) => (
              <div key={row.servicePartnerId} className="rounded-md border border-[#e5ebf6] p-3 text-sm">
                <p className="font-medium">{topCompanyNameMap.get(row.servicePartnerId) ?? row.servicePartnerId}</p>
                <p className="text-[#6f84a9]">Requests: {row._count.id}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-[#122447]">Module Access</h2>
        {moduleCards.length === 0 ? (
          <p className="mt-2 text-sm text-[#6f84a9]">No modules available for this user.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {moduleCards.map((card) =>
              card.comingSoon || !card.href ? (
                <div key={card.title} className="rounded-xl border border-dashed border-[#c9d5ec] bg-[#f8fbff] p-4">
                  <p className="text-base font-semibold text-[#132445]">{card.title}</p>
                  <p className="mt-1 text-sm text-[#6f84a9]">{card.description}</p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#5f7bb3]">Coming Soon</p>
                </div>
              ) : (
                <Link key={card.title} href={card.href} className="rounded-xl border border-[#e5ebf6] p-4 hover:bg-[#f8fbff]">
                  <p className="text-base font-semibold text-[#132445]">{card.title}</p>
                  <p className="mt-1 text-sm text-[#6f84a9]">{card.description}</p>
                  {typeof card.count === "number" ? <p className="mt-3 text-xs font-semibold text-[#2d5fff]">Count: {card.count}</p> : null}
                </Link>
              )
            )}
          </div>
        )}
      </section>
    </section>
  );
}
