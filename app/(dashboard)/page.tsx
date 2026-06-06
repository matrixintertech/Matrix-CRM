import { ServiceRequestStatus } from "@prisma/client";
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

type KpiCardDefinition = {
  title: string;
  note: string;
  href: string;
  permission: string;
  key:
    | "companies"
    | "users"
    | "roles"
    | "permissions"
    | "clients"
    | "branches"
    | "categories"
    | "items"
    | "vendors"
    | "rateCards"
    | "serviceRequests"
    | "openServiceRequests"
    | "rfqs"
    | "invoices"
    | "ledgerEntries"
    | "vendorPayments";
};

type QuickAction = {
  group: "Organization" | "Inventory & Services" | "Service Requests" | "Procurement" | "Finance" | "Reports";
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
  { title: "Vendors", note: "All vendors", href: "/vendors", permission: "vendors.read", key: "vendors" },
  { title: "Rate Cards", note: "All rate cards", href: "/rate-cards", permission: "rate_cards.read", key: "rateCards" },
  { title: "Service Requests", note: "All requests", href: "/service-requests", permission: "service_requests.read", key: "serviceRequests" },
  { title: "RFQs", note: "All RFQs", href: "/rfqs", permission: "rfq.read", key: "rfqs" },
  { title: "Vendor Invoices", note: "All received vendor invoices", href: "/invoices", permission: "invoices.read", key: "invoices" },
  { title: "Vendor Payments", note: "All vendor payments", href: "/vendor-payments", permission: "vendor_payments.read", key: "vendorPayments" },
  { title: "Ledger Entries", note: "All payment postings", href: "/ledger", permission: "ledger.read", key: "ledgerEntries" },
];

const companyKpis: KpiCardDefinition[] = [
  { title: "Users", note: "Company users", href: "/users", permission: "users.read", key: "users" },
  { title: "Roles", note: "Company roles", href: "/roles", permission: "roles.read", key: "roles" },
  { title: "Clients", note: "Company clients", href: "/clients", permission: "clients.read", key: "clients" },
  { title: "Branches", note: "Company branches", href: "/branches", permission: "branches.read", key: "branches" },
  { title: "Categories", note: "Company categories", href: "/categories", permission: "categories.read", key: "categories" },
  { title: "Items", note: "Company items", href: "/items", permission: "items.read", key: "items" },
  { title: "Vendors", note: "Company vendors", href: "/vendors", permission: "vendors.read", key: "vendors" },
  { title: "Rate Cards", note: "Company rate cards", href: "/rate-cards", permission: "rate_cards.read", key: "rateCards" },
  { title: "Service Requests", note: "Company requests", href: "/service-requests", permission: "service_requests.read", key: "serviceRequests" },
  { title: "Open Service Requests", note: "Open queue", href: "/service-requests", permission: "service_requests.read", key: "openServiceRequests" },
  { title: "RFQs", note: "Company RFQs", href: "/rfqs", permission: "rfq.read", key: "rfqs" },
  { title: "Vendor Invoices", note: "Company received vendor invoices", href: "/invoices", permission: "invoices.read", key: "invoices" },
  { title: "Vendor Payments", note: "Company vendor payments", href: "/vendor-payments", permission: "vendor_payments.read", key: "vendorPayments" },
  { title: "Ledger Entries", note: "Company postings", href: "/ledger", permission: "ledger.read", key: "ledgerEntries" },
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

  const [
    companies,
    users,
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
    rfqs,
    invoices,
    vendorPayments,
    ledgerEntries,
    recentRequests,
    companyProfile,
    companyDirectory,
  ] = await getOrSetServerCache(
    "dashboard.summary",
    dashboardCacheKey,
    () =>
      measurePerf("dashboard.page_data", () => Promise.all([
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
        can("rfq.read") ? prisma.rfq.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
        can("invoices.read") ? prisma.invoice.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
        can("vendor_payments.read") ? prisma.vendorPayment.count({ where: scopeByTenant(session, {}) }) : Promise.resolve(0),
        can("ledger.read") ? prisma.ledgerEntry.count({ where: scopeByTenant(session, {}) }) : Promise.resolve(0),
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
        isSuperAdmin && can("service_partners.read")
          ? prisma.servicePartner.findMany({
              where: { deletedAt: null },
              orderBy: [{ name: "asc" }],
              take: 18,
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ])),
    {
      ttlSeconds: 30,
      prefixes: [cachePrefixes.dashboard, `${cachePrefixes.dashboard}:tenant:${session.user.servicePartnerId}`],
    }
  );

  const countsByKey = {
    companies,
    users,
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
    rfqs,
    invoices,
    vendorPayments,
    ledgerEntries,
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
  const quickActionGroups = quickActions.reduce<Record<string, QuickAction[]>>((accumulator, action) => {
    accumulator[action.group] = [...(accumulator[action.group] ?? []), action];
    return accumulator;
  }, {});

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
    <section className="crm-page">
      <div className="crm-panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex w-fit items-center rounded-full border border-[#dbe5f4] bg-[#f7faff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#5d76a7]">
              {isSuperAdmin ? "Platform view" : "Tenant view"}
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[#111f3d] sm:text-3xl">{title}</h1>
              <p className="max-w-3xl text-sm leading-6 text-[#667b9f]">{subtitle}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { label: "Signed in as", value: displayName },
              { label: "Workspace", value: companyName },
              { label: "Access", value: roleLabel },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-[#e6edf8] bg-[#fbfcff] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7f91b2]">{item.label}</p>
                <p className="mt-1 text-sm font-semibold text-[#123064]">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <PrefetchLink key={card.title} href={card.href} className="crm-stat-card transition hover:border-[#bfd0f2] hover:bg-[#f8fbff]">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">{card.title}</p>
            <p className="mt-1 text-3xl font-bold text-[#123064]">{card.value}</p>
            <p className="mt-1 text-sm text-[#6f84a9]">{card.note}</p>
          </PrefetchLink>
        ))}
      </div>

      <div className="grid gap-6 2xl:grid-cols-[2fr_1fr]">
        <section className="overflow-hidden rounded-2xl border border-[#e3eaf6] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-xl font-semibold text-[#122447]">Recent Service Requests</h2>
            {can("service_requests.read") ? (
              <PrefetchLink href="/service-requests" className="text-sm font-semibold text-[#2d5fff]">
                View all
              </PrefetchLink>
            ) : null}
          </div>
          {!can("service_requests.read") ? (
            <div className="p-5">
              <EmptyState title="No request access" description="Your current role does not allow service request visibility on the dashboard." />
            </div>
          ) : recentRequests.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No recent requests" description="New service requests will appear here once they are created for this workspace." />
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 md:hidden">
                {recentRequests.map((request) => (
                  <article key={request.id} className="rounded-2xl border border-[#edf2fb] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c8fb2]">{request.serviceNumber}</p>
                        <p className="mt-1 text-sm font-semibold text-[#1d335d]">{request.title}</p>
                      </div>
                      <StatusBadge value={request.status} />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {isSuperAdmin ? (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c8fb2]">Company</p>
                          <p className="mt-1 text-sm text-[#1d335d]">{request.servicePartner.name}</p>
                        </div>
                      ) : null}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c8fb2]">Client</p>
                        <p className="mt-1 text-sm text-[#1d335d]">{request.client.name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c8fb2]">Branch</p>
                        <p className="mt-1 text-sm text-[#1d335d]">{request.branch?.name ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7c8fb2]">Requested At</p>
                        <p className="mt-1 text-sm text-[#1d335d]">{formatDateTime(request.requestedAt ?? request.createdAt)}</p>
                      </div>
                    </div>
                    <PrefetchLink href={`/service-requests/${request.id}`} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-[#dbe5f4] px-4 text-sm font-semibold text-[#2454e6]">
                      Open
                    </PrefetchLink>
                  </article>
                ))}
              </div>

              <div className="crm-scroll-shell hidden md:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-[#f7faff] text-left text-xs uppercase tracking-[0.16em] text-[#7c8fb2]">
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
                      <tr key={request.id} className="border-t border-[#edf2fb] text-[#1d335d] hover:bg-[#fafcff]">
                      <td className="px-5 py-3 font-semibold text-[#2454e6]">{request.serviceNumber}</td>
                      <td className="px-5 py-3">{request.title}</td>
                      {isSuperAdmin ? <td className="px-5 py-3">{request.servicePartner.name}</td> : null}
                      <td className="px-5 py-3">{request.client.name}</td>
                      <td className="px-5 py-3">{request.branch?.name ?? "-"}</td>
                      <td className="px-5 py-3">
                          <StatusBadge value={request.status} />
                      </td>
                      <td className="px-5 py-3">{formatDateTime(request.requestedAt ?? request.createdAt)}</td>
                      <td className="px-5 py-3">
                        <PrefetchLink href={`/service-requests/${request.id}`} className="text-[#2454e6]">
                          Open
                        </PrefetchLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-[#e3eaf6] bg-white shadow-sm">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-xl font-semibold text-[#122447]">Quick Actions</h2>
              <p className="mt-1 text-sm text-[#6f84a9]">Only actions available to your current permissions are shown.</p>
            </div>
            <div className="space-y-4 p-4">
              {quickActions.length === 0 ? (
                <EmptyState title="No quick actions available" description="This dashboard stays permission-aware, so available actions appear here when enabled." />
              ) : (
                Object.entries(quickActionGroups).map(([group, actions]) => (
                  <div key={group} className="space-y-2">
                    <p className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#7d8eaf]">{group}</p>
                    <div className="space-y-2">
                      {actions.map((action) => (
                        <PrefetchLink key={action.title} href={action.href} className="block rounded-xl border border-[#edf2fb] px-3 py-3 transition hover:border-[#cedcf5] hover:bg-[#f7faff]">
                          <p className="text-sm font-semibold text-[#132445]">{action.title}</p>
                          <p className="mt-1 text-sm text-[#6f84a9]">{action.subtitle}</p>
                        </PrefetchLink>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {!isSuperAdmin && companyProfile ? (
            <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-[#122447]">Company Profile</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Name", value: companyProfile.name },
                  { label: "Code", value: companyProfile.code },
                  { label: "Status", value: companyProfile.status },
                  { label: "Contact", value: companyProfile.email ?? companyProfile.phone ?? "-" },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-[#edf2fb] bg-[#fbfcff] px-3 py-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7d8eaf]">{item.label}</p>
                    <p className="mt-1 font-medium text-[#1d335d]">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {isSuperAdmin && companyDirectory.length > 0 ? (
        <section className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-[#122447]">Company Directory</h2>
          <p className="mt-1 text-sm text-[#6f84a9]">Open a company to view admins, users, clients, branches, requests, and financial summaries.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {companyDirectory.map((company) => (
              <PrefetchLink
                key={company.id}
                href={`/service-partners/${company.id}`}
                className="rounded-xl border border-[#e5ebf6] bg-[#fbfcff] p-4 text-sm font-medium text-[#10254b] transition hover:border-[#bfd0f2] hover:bg-[#f8fbff]"
              >
                {company.name}
              </PrefetchLink>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
