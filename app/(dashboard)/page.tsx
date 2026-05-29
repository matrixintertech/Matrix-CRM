import { ServiceRequestStatus } from "@prisma/client";
import Link from "next/link";

import { getUserPermissions } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

type KpiCardDefinition = {
  title: string;
  note: string;
  href: string;
  permission: string;
  key: "companies" | "users" | "roles" | "permissions" | "clients" | "branches" | "categories" | "items" | "rateCards" | "serviceRequests" | "openServiceRequests";
};

type QuickAction = {
  title: string;
  subtitle: string;
  href: string;
  permission: string;
  superAdminOnly?: boolean;
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

const superAdminKpis: KpiCardDefinition[] = [
  { title: "Service Partners", note: "All companies", href: "/service-partners", permission: "service_partners.read", key: "companies" },
  { title: "Users", note: "All users", href: "/users", permission: "users.read", key: "users" },
  { title: "Roles", note: "All roles", href: "/roles", permission: "roles.read", key: "roles" },
  { title: "Permissions", note: "Permission catalog", href: "/permissions", permission: "permissions.read", key: "permissions" },
  { title: "Clients", note: "All clients", href: "/clients", permission: "clients.read", key: "clients" },
  { title: "Branches", note: "All branches", href: "/branches", permission: "branches.read", key: "branches" },
  { title: "Categories", note: "All categories", href: "/categories", permission: "categories.read", key: "categories" },
  { title: "Items", note: "All items", href: "/items", permission: "items.read", key: "items" },
  { title: "Rate Cards", note: "All rate cards", href: "/rate-cards", permission: "rate_cards.read", key: "rateCards" },
  { title: "Service Requests", note: "All requests", href: "/service-requests", permission: "service_requests.read", key: "serviceRequests" },
];

const companyKpis: KpiCardDefinition[] = [
  { title: "Users", note: "Company users", href: "/users", permission: "users.read", key: "users" },
  { title: "Roles", note: "Company roles", href: "/roles", permission: "roles.read", key: "roles" },
  { title: "Clients", note: "Company clients", href: "/clients", permission: "clients.read", key: "clients" },
  { title: "Branches", note: "Company branches", href: "/branches", permission: "branches.read", key: "branches" },
  { title: "Categories", note: "Company categories", href: "/categories", permission: "categories.read", key: "categories" },
  { title: "Items", note: "Company items", href: "/items", permission: "items.read", key: "items" },
  { title: "Rate Cards", note: "Company rate cards", href: "/rate-cards", permission: "rate_cards.read", key: "rateCards" },
  { title: "Service Requests", note: "Company requests", href: "/service-requests", permission: "service_requests.read", key: "serviceRequests" },
  { title: "Open Service Requests", note: "Open queue", href: "/service-requests", permission: "service_requests.read", key: "openServiceRequests" },
];

const quickActionDefinitions: QuickAction[] = [
  { title: "Add Company", subtitle: "Create service partner", href: "/service-partners/new", permission: "service_partners.create", superAdminOnly: true },
  { title: "Add Company Admin", subtitle: "Open company and create admin", href: "/service-partners", permission: "users.create", superAdminOnly: true },
  { title: "Add User", subtitle: "Create user", href: "/users/new", permission: "users.create" },
  { title: "Add Role", subtitle: "Create role", href: "/roles/new", permission: "roles.create" },
  { title: "Add Client", subtitle: "Create client", href: "/clients/new", permission: "clients.create" },
  { title: "Add Branch", subtitle: "Create branch", href: "/branches/new", permission: "branches.create" },
  { title: "Add Category", subtitle: "Create category", href: "/categories/new", permission: "categories.create" },
  { title: "Add Item", subtitle: "Create item", href: "/items/new", permission: "items.create" },
  { title: "Add Rate Card", subtitle: "Create rate card", href: "/rate-cards/new", permission: "rate_cards.create" },
  { title: "New Service Request", subtitle: "Create request", href: "/service-requests/new", permission: "service_requests.create" },
];

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

export default async function DashboardPage() {
  const session = await requirePermission("dashboard.read");
  const permissionSet = session.user.isSuperAdmin ? null : new Set(await getUserPermissions(session.user.id, session.user.roleKeys));
  const can = (permissionKey: string) => session.user.isSuperAdmin || Boolean(permissionSet?.has(permissionKey));

  const isSuperAdmin = session.user.isSuperAdmin;
  const isCompanyAdmin = !isSuperAdmin && session.user.roleKeys.includes("company_admin");

  const [companies, users, roles, permissions, clients, branches, categories, items, rateCards, serviceRequests, openServiceRequests, recentRequests, companyProfile, topCompanyRows] =
    await Promise.all([
      can("service_partners.read")
        ? isSuperAdmin
          ? prisma.servicePartner.count({ where: { deletedAt: null } })
          : prisma.servicePartner.count({ where: { id: session.user.servicePartnerId, deletedAt: null } })
        : Promise.resolve(0),
      can("users.read") ? prisma.user.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
      can("roles.read") ? prisma.role.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
      can("permissions.read") ? prisma.permission.count() : Promise.resolve(0),
      can("clients.read") ? prisma.client.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
      can("branches.read") ? prisma.branch.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
      can("categories.read") ? prisma.category.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
      can("items.read") ? prisma.item.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
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
      can("service_requests.read")
        ? prisma.serviceRequest.findMany({
            where: scopeByTenant(session, { deletedAt: null }),
            orderBy: [{ createdAt: "desc" }],
            take: 10,
            include: {
              client: { select: { name: true } },
              branch: { select: { name: true } },
              servicePartner: { select: { name: true, code: true } },
            },
          })
        : Promise.resolve([]),
      !isSuperAdmin
        ? prisma.servicePartner.findFirst({
            where: { id: session.user.servicePartnerId, deletedAt: null },
            select: { name: true, code: true, status: true, email: true, phone: true },
          })
        : Promise.resolve(null),
      isSuperAdmin && can("service_requests.read")
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
    isSuperAdmin && topCompanyRows.length > 0
      ? await prisma.servicePartner.findMany({
          where: { id: { in: topCompanyRows.map((row) => row.servicePartnerId) } },
          select: { id: true, name: true, code: true },
        })
      : [];
  const topCompanyNameMap = new Map(topCompanyMeta.map((entry) => [entry.id, `${entry.name} (${entry.code})`]));

  const countsByKey = {
    companies,
    users,
    roles,
    permissions,
    clients,
    branches,
    categories,
    items,
    rateCards,
    serviceRequests,
    openServiceRequests,
  };

  const kpiDefinitions = isSuperAdmin ? superAdminKpis : companyKpis;
  const kpiCards = kpiDefinitions
    .filter((card) => can(card.permission))
    .map((card) => ({
      ...card,
      value: countsByKey[card.key],
    }));

  const quickActions = quickActionDefinitions.filter((action) => {
    if (action.superAdminOnly && !isSuperAdmin) {
      return false;
    }
    return can(action.permission);
  });

  const title = isSuperAdmin ? "Platform Dashboard" : isCompanyAdmin ? "Company Dashboard" : "Dashboard";
  const subtitle = isSuperAdmin
    ? "Platform-wide operations and tenant health."
    : isCompanyAdmin
      ? "Company-wide operations for your service partner."
      : "Your assigned company workspace.";
  const roleLabel = isSuperAdmin ? "Super Admin" : isCompanyAdmin ? "Company Admin" : "Company User";
  const displayName = session.user.name?.trim() || session.user.email || session.user.phone || "User";
  const companyName = isSuperAdmin ? "Platform" : companyProfile?.name ?? "Company";

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-[0_10px_30px_rgba(18,48,102,0.04)]">
        <h1 className="text-3xl font-semibold text-[#111f3d]">{title}</h1>
        <p className="text-sm text-[#667b9f]">{subtitle}</p>
        <p className="mt-2 text-sm text-[#516a95]">
          Logged in as <span className="font-semibold">{displayName}</span> | Company <span className="font-semibold">{companyName}</span> | Role{" "}
          <span className="font-semibold">{roleLabel}</span>
        </p>
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
            {can("service_requests.read") ? (
              <Link href="/service-requests" className="text-sm font-semibold text-[#2d5fff]">
                View all
              </Link>
            ) : null}
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
                    {isSuperAdmin ? <th className="px-5 py-3">Company</th> : null}
                    <th className="px-5 py-3">Client</th>
                    <th className="px-5 py-3">Branch</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Requested At</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRequests.map((request) => (
                    <tr key={request.id} className="border-t border-[#edf2fb] text-[#1d335d]">
                      <td className="px-5 py-3 font-semibold text-[#2454e6]">{request.serviceNumber}</td>
                      <td className="px-5 py-3">{request.title}</td>
                      {isSuperAdmin ? <td className="px-5 py-3">{request.servicePartner.name}</td> : null}
                      <td className="px-5 py-3">{request.client.name}</td>
                      <td className="px-5 py-3">{request.branch?.name ?? "-"}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(request.status)}`}>
                          {formatStatusLabel(request.status)}
                        </span>
                      </td>
                      <td className="px-5 py-3">{formatDateTime(request.requestedAt ?? request.createdAt)}</td>
                      <td className="px-5 py-3">
                        <Link href={`/service-requests/${request.id}`} className="text-[#2454e6]">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
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
                <p className="px-2 py-3 text-sm text-[#6f84a9]">No quick actions available for your permissions.</p>
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

          {!isSuperAdmin && companyProfile ? (
            <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-[#122447]">Company Profile</h2>
              <div className="mt-3 space-y-1 text-sm text-[#1d335d]">
                <p>
                  <span className="text-[#6f84a9]">Name:</span> {companyProfile.name}
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
        </aside>
      </div>

      {isSuperAdmin && topCompanyRows.length > 0 ? (
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
    </section>
  );
}
