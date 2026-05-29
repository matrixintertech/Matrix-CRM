import { ServiceRequestStatus } from "@prisma/client";
import Link from "next/link";

import { getUserPermissions } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getTotalPages } from "@/lib/http/pagination";
import { getNumberParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type DashboardPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type CardItem = {
  label: string;
  href: string;
  value: number;
  note: string;
};

type ModuleCard = {
  title: string;
  description: string;
  href: string;
  permission: string;
  count?: number;
};

type QuickAction = {
  title: string;
  subtitle: string;
  href: string;
  permission: string;
};

const RECENT_PAGE_SIZE = 5;
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

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatStatusLabel(status: ServiceRequestStatus) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function statusClass(status: ServiceRequestStatus) {
  if (status === ServiceRequestStatus.IN_PROGRESS) return "bg-[#e8efff] text-[#2854e8]";
  if (status === ServiceRequestStatus.RAISED || status === ServiceRequestStatus.TRIAGED) return "bg-[#e9f1ff] text-[#325eff]";
  if (status === ServiceRequestStatus.COMPLETED || status === ServiceRequestStatus.CLOSED) return "bg-[#e8faf1] text-[#109a4a]";
  if (status === ServiceRequestStatus.BLOCKED) return "bg-[#fff2e8] text-[#ee7a16]";
  if (status === ServiceRequestStatus.CANCELLED) return "bg-[#ffecec] text-[#ef4444]";
  return "bg-[#eef2ff] text-[#435c85]";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default async function DashboardHomePage({ searchParams }: DashboardPageProps) {
  const session = await requireAuth();
  const params = await resolveSearchParams(searchParams);
  const recentPage = Math.max(1, getNumberParam(params, "recentPage") ?? 1);
  const recentSkip = (recentPage - 1) * RECENT_PAGE_SIZE;

  const permissionSet = session.user.isSuperAdmin ? null : new Set(await getUserPermissions(session.user.id));
  const can = (permissionKey: string) => session.user.isSuperAdmin || Boolean(permissionSet?.has(permissionKey));

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekEnd = addDays(todayStart, 7);

  const baseWhere = scopeByTenant(session, { deletedAt: null });
  const requestWhere = scopeByTenant(session, { deletedAt: null });

  const [
    usersCount,
    rolesCount,
    permissionsCount,
    companiesCount,
    clientsCount,
    branchesCount,
    categoriesCount,
    itemsCount,
    rateCardsCount,
    serviceRequestsTotal,
    openServiceRequests,
    completedServiceRequests,
    overdueServiceRequests,
    dueThisWeekServiceRequests,
    recentServiceRequests,
    recentServiceRequestsTotal,
    companyProfile,
    topCompanyRows,
    companyStatusCounts,
    recentCompanies,
    dbHealth,
  ] = await Promise.all([
    can("users.read") ? prisma.user.count({ where: { ...baseWhere, status: "ACTIVE" } }) : Promise.resolve(0),
    can("roles.read") ? prisma.role.count({ where: { ...scopeByTenant(session, { deletedAt: null }) } }) : Promise.resolve(0),
    can("permissions.read") ? prisma.permission.count() : Promise.resolve(0),
    can("service_partners.read")
      ? session.user.isSuperAdmin
        ? prisma.servicePartner.count({ where: { deletedAt: null } })
        : prisma.servicePartner.count({ where: { id: session.user.servicePartnerId, deletedAt: null } })
      : Promise.resolve(0),
    can("clients.read") ? prisma.client.count({ where: baseWhere }) : Promise.resolve(0),
    can("branches.read") ? prisma.branch.count({ where: baseWhere }) : Promise.resolve(0),
    can("categories.read") ? prisma.category.count({ where: baseWhere }) : Promise.resolve(0),
    can("items.read") ? prisma.item.count({ where: baseWhere }) : Promise.resolve(0),
    can("rate_cards.read") ? prisma.rateCard.count({ where: baseWhere }) : Promise.resolve(0),
    can("service_requests.read") ? prisma.serviceRequest.count({ where: requestWhere }) : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.count({
          where: {
            ...requestWhere,
            status: { in: openServiceStatuses },
          },
        })
      : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.count({
          where: {
            ...requestWhere,
            status: ServiceRequestStatus.COMPLETED,
          },
        })
      : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.count({
          where: {
            ...requestWhere,
            status: { in: openServiceStatuses },
            targetDate: { lt: todayStart },
          },
        })
      : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.count({
          where: {
            ...requestWhere,
            status: { in: openServiceStatuses },
            targetDate: { gte: todayStart, lt: weekEnd },
          },
        })
      : Promise.resolve(0),
    can("service_requests.read")
      ? prisma.serviceRequest.findMany({
          where: requestWhere,
          include: {
            servicePartner: { select: { name: true } },
            client: { select: { name: true } },
            branch: { select: { name: true } },
          },
          orderBy: [{ createdAt: "desc" }],
          skip: recentSkip,
          take: RECENT_PAGE_SIZE,
        })
      : Promise.resolve([]),
    can("service_requests.read") ? prisma.serviceRequest.count({ where: requestWhere }) : Promise.resolve(0),
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
    session.user.isSuperAdmin && can("service_requests.read")
      ? prisma.serviceRequest.groupBy({
          by: ["servicePartnerId"],
          where: { deletedAt: null },
          _count: { id: true },
          orderBy: {
            _count: {
              id: "desc",
            },
          },
          take: 5,
        })
      : Promise.resolve([]),
    session.user.isSuperAdmin && can("service_partners.read")
      ? prisma.servicePartner.groupBy({
          by: ["status"],
          where: { deletedAt: null },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    session.user.isSuperAdmin && can("service_partners.read")
      ? prisma.servicePartner.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, code: true, status: true, createdAt: true },
          take: 5,
        })
      : Promise.resolve([]),
    prisma
      .$queryRaw`SELECT 1`
      .then(() => "Connected")
      .catch(() => "Unavailable"),
  ]);

  const topCompanyIds = topCompanyRows.map((row) => row.servicePartnerId);
  const topCompanyNameMap =
    topCompanyIds.length > 0
      ? new Map(
          (
            await prisma.servicePartner.findMany({
              where: { id: { in: topCompanyIds } },
              select: { id: true, name: true, code: true },
            })
          ).map((company) => [company.id, `${company.name} (${company.code})`])
        )
      : new Map<string, string>();

  const summaryCards: CardItem[] = [
    { label: "Companies", href: "/service-partners", value: companiesCount, note: "Service partners" },
    { label: "Users", href: "/users", value: usersCount, note: "Active users" },
    { label: "Roles", href: "/roles", value: rolesCount, note: "Configured roles" },
    { label: "Permissions", href: "/permissions", value: permissionsCount, note: "Permission catalog" },
    { label: "Clients", href: "/clients", value: clientsCount, note: "Total clients" },
    { label: "Branches", href: "/branches", value: branchesCount, note: "Total branches" },
    { label: "Categories", href: "/categories", value: categoriesCount, note: "Catalog categories" },
    { label: "Items", href: "/items", value: itemsCount, note: "Catalog items" },
    { label: "Rate Cards", href: "/rate-cards", value: rateCardsCount, note: "Pricing cards" },
    { label: "Requests", href: "/service-requests", value: serviceRequestsTotal, note: "Service requests" },
    { label: "Open Requests", href: "/service-requests", value: openServiceRequests, note: "In progress queue" },
    { label: "Overdue", href: "/service-requests", value: overdueServiceRequests, note: "Past target date" },
  ].filter((card) => {
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
    { title: "Add Company", subtitle: "Create a new service partner", href: "/service-partners/new", permission: "service_partners.create" },
    { title: "Add Company Admin", subtitle: "Create tenant administrator", href: "/users/new", permission: "users.create" },
    { title: "Add User", subtitle: "Create internal user", href: "/users/new", permission: "users.create" },
    { title: "Add Role", subtitle: "Create role", href: "/roles/new", permission: "roles.create" },
    { title: "Add Client", subtitle: "Create client", href: "/clients/new", permission: "clients.create" },
    { title: "Add Branch", subtitle: "Create branch", href: "/branches/new", permission: "branches.create" },
    { title: "Add Category", subtitle: "Create category", href: "/categories/new", permission: "categories.create" },
    { title: "Add Item", subtitle: "Create item", href: "/items/new", permission: "items.create" },
    { title: "Add Rate Card", subtitle: "Create rate card", href: "/rate-cards/new", permission: "rate_cards.create" },
    { title: "Add Service Request", subtitle: "Create service request", href: "/service-requests/new", permission: "service_requests.create" },
  ].filter((item) => can(item.permission));

  const moduleCards: ModuleCard[] = [
    { title: "Service Partners", description: "Manage tenants and company profiles.", href: "/service-partners", permission: "service_partners.read", count: companiesCount },
    { title: "Users", description: "Manage users and account statuses.", href: "/users", permission: "users.read", count: usersCount },
    { title: "Roles", description: "Manage role definitions.", href: "/roles", permission: "roles.read", count: rolesCount },
    { title: "Permissions", description: "View permission catalog.", href: "/permissions", permission: "permissions.read", count: permissionsCount },
    { title: "Clients", description: "Manage client organizations.", href: "/clients", permission: "clients.read", count: clientsCount },
    { title: "Branches", description: "Manage client branches.", href: "/branches", permission: "branches.read", count: branchesCount },
    { title: "Categories", description: "Manage category taxonomy.", href: "/categories", permission: "categories.read", count: categoriesCount },
    { title: "Items", description: "Manage service items.", href: "/items", permission: "items.read", count: itemsCount },
    { title: "Rate Cards", description: "Manage rate cards.", href: "/rate-cards", permission: "rate_cards.read", count: rateCardsCount },
    { title: "Service Requests", description: "Track and update service requests.", href: "/service-requests", permission: "service_requests.read", count: serviceRequestsTotal },
    { title: "Settings", description: "Workspace and profile settings.", href: "/settings", permission: "settings.read" },
  ].filter((card) => can(card.permission));

  const recentTotalPages = getTotalPages(recentServiceRequestsTotal, RECENT_PAGE_SIZE);
  const displayName = session.user.name?.trim() || session.user.email || session.user.phone || "User";
  const isCompanyAdmin = !session.user.isSuperAdmin && session.user.roleKeys.includes("company_admin");

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#e3eaf6] bg-white px-5 py-4 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
        <h1 className="text-4xl font-semibold text-[#111f3d]">Dashboard</h1>
        <p className="text-sm text-[#667b9f]">
          {session.user.isSuperAdmin
            ? "Platform command center for all tenants."
            : isCompanyAdmin
              ? "Company control panel with tenant-scoped data."
              : "Permission-based workspace dashboard."}
        </p>
      </div>

      <div className="rounded-2xl border border-[#e3eaf6] bg-white px-5 py-4 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
        <h2 className="text-3xl font-semibold text-[#111f3d]">Welcome, {displayName}</h2>
        <p className="text-sm text-[#667b9f]">
          {new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(now)}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <Link key={card.label} href={card.href} className="rounded-xl border border-[#e5ebf6] p-4 hover:bg-[#f8fbff]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">{card.label}</p>
              <p className="mt-1 text-3xl font-bold text-[#123064]">{card.value}</p>
              <p className="text-sm text-[#6f84a9]">{card.note}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-[#e3eaf6] bg-white shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
          <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
            <h3 className="text-2xl font-semibold text-[#122447]">Recent Service Requests</h3>
            {can("service_requests.read") ? (
              <Link href="/service-requests" className="text-sm font-semibold text-[#2d5fff]">View all</Link>
            ) : null}
          </div>
          {!can("service_requests.read") ? (
            <p className="p-5 text-sm text-[#6f84a9]">You do not have access to service requests.</p>
          ) : recentServiceRequests.length === 0 ? (
            <p className="p-5 text-sm text-[#6f84a9]">No service requests found.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[#7c8fb2]">
                      <th className="px-5 py-3">Request #</th>
                      <th className="px-5 py-3">Company</th>
                      <th className="px-5 py-3">Client</th>
                      <th className="px-5 py-3">Branch</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentServiceRequests.map((request) => (
                      <tr key={request.id} className="border-t border-[#edf2fb] text-[#1d335d]">
                        <td className="px-5 py-3 font-semibold text-[#2454e6]">
                          <Link href={`/service-requests/${request.id}`}>{request.serviceNumber}</Link>
                        </td>
                        <td className="px-5 py-3">{request.servicePartner.name}</td>
                        <td className="px-5 py-3">{request.client.name}</td>
                        <td className="px-5 py-3">{request.branch?.name ?? "-"}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(request.status)}`}>
                            {formatStatusLabel(request.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3">{formatDate(request.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-[#edf2fb] px-5 py-3 text-sm text-[#6f84a9]">
                <p>
                  Page {recentPage} of {recentTotalPages}
                </p>
                <div className="flex items-center gap-2">
                  {recentPage > 1 ? (
                    <Link href={recentPage - 1 === 1 ? "/" : `/?recentPage=${recentPage - 1}`} className="rounded-md border px-3 py-1.5">
                      Prev
                    </Link>
                  ) : null}
                  {recentPage < recentTotalPages ? (
                    <Link href={`/?recentPage=${recentPage + 1}`} className="rounded-md border px-3 py-1.5">
                      Next
                    </Link>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-[#e3eaf6] bg-white shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h3 className="text-2xl font-semibold text-[#122447]">Quick Actions</h3>
            </div>
            <div className="space-y-1 p-3">
              {quickActions.length === 0 ? (
                <p className="px-2 py-3 text-sm text-[#6f84a9]">No actions available for your permissions.</p>
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

          <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
            <h3 className="text-xl font-semibold text-[#122447]">System Health</h3>
            <p className="mt-2 text-sm text-[#6f84a9]">Database: <span className="font-medium text-[#132445]">{dbHealth}</span></p>
            {can("roles.read") ? <p className="text-sm text-[#6f84a9]">Roles: {rolesCount}</p> : null}
            {can("permissions.read") ? <p className="text-sm text-[#6f84a9]">Permissions: {permissionsCount}</p> : null}
          </section>
        </aside>
      </div>

      {session.user.isSuperAdmin ? (
        <section className="grid gap-6 xl:grid-cols-3">
          <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
            <h3 className="text-xl font-semibold text-[#122447]">Top Companies</h3>
            <div className="mt-3 space-y-2 text-sm">
              {topCompanyRows.length === 0 ? (
                <p className="text-[#6f84a9]">No service request data yet.</p>
              ) : (
                topCompanyRows.map((row) => (
                  <p key={row.servicePartnerId} className="flex items-center justify-between">
                    <span>{topCompanyNameMap.get(row.servicePartnerId) ?? row.servicePartnerId}</span>
                    <span className="font-semibold">{row._count.id}</span>
                  </p>
                ))
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
            <h3 className="text-xl font-semibold text-[#122447]">Company Status</h3>
            <div className="mt-3 space-y-2 text-sm">
              {companyStatusCounts.length === 0 ? (
                <p className="text-[#6f84a9]">No company records.</p>
              ) : (
                companyStatusCounts.map((entry) => (
                  <p key={entry.status} className="flex items-center justify-between">
                    <span>{entry.status}</span>
                    <span className="font-semibold">{entry._count._all}</span>
                  </p>
                ))
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
            <h3 className="text-xl font-semibold text-[#122447]">Recent Companies</h3>
            <div className="mt-3 space-y-2 text-sm">
              {recentCompanies.length === 0 ? (
                <p className="text-[#6f84a9]">No recent companies.</p>
              ) : (
                recentCompanies.map((company) => (
                  <p key={company.id}>
                    <Link href={`/service-partners/${company.id}`} className="font-medium text-[#2454e6]">{company.name}</Link>
                    <span className="ml-2 text-[#6f84a9]">({company.code})</span>
                  </p>
                ))
              )}
            </div>
          </div>
        </section>
      ) : companyProfile ? (
        <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
          <h3 className="text-xl font-semibold text-[#122447]">Company Profile</h3>
          <div className="mt-3 grid gap-2 text-sm text-[#1d335d] md:grid-cols-2">
            <p><span className="text-[#6f84a9]">Name:</span> {companyProfile.name}</p>
            <p><span className="text-[#6f84a9]">Code:</span> {companyProfile.code}</p>
            <p><span className="text-[#6f84a9]">Status:</span> {companyProfile.status}</p>
            <p><span className="text-[#6f84a9]">Contact:</span> {companyProfile.email ?? companyProfile.phone ?? "-"}</p>
          </div>
          {can("service_requests.read") ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[#edf2fb] p-3">
                <p className="text-xs uppercase text-[#7c8fb2]">Open</p>
                <p className="text-2xl font-semibold">{openServiceRequests}</p>
              </div>
              <div className="rounded-xl border border-[#edf2fb] p-3">
                <p className="text-xs uppercase text-[#7c8fb2]">Completed</p>
                <p className="text-2xl font-semibold">{completedServiceRequests}</p>
              </div>
              <div className="rounded-xl border border-[#edf2fb] p-3">
                <p className="text-xs uppercase text-[#7c8fb2]">Due This Week</p>
                <p className="text-2xl font-semibold">{dueThisWeekServiceRequests}</p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
        <h3 className="text-2xl font-semibold text-[#122447]">Module Access</h3>
        {moduleCards.length === 0 ? (
          <p className="mt-3 text-sm text-[#6f84a9]">No modules are currently accessible with your permissions.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {moduleCards.map((moduleCard) => (
              <Link key={moduleCard.href} href={moduleCard.href} className="rounded-xl border border-[#e5ebf6] p-4 hover:bg-[#f8fbff]">
                <p className="text-lg font-semibold text-[#132445]">{moduleCard.title}</p>
                <p className="mt-1 text-sm text-[#6f84a9]">{moduleCard.description}</p>
                {typeof moduleCard.count === "number" ? (
                  <p className="mt-3 text-sm font-medium text-[#24499e]">Count: {moduleCard.count}</p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
