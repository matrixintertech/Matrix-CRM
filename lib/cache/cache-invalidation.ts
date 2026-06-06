import { clearRuntimeCache } from "@/lib/cache/runtime-cache";
import { cachePrefixes } from "@/lib/cache/cache-keys";
import { deleteServerCacheByPrefix } from "@/lib/cache/server-cache";

async function invalidatePrefixes(prefixes: string[]) {
  const uniquePrefixes = Array.from(new Set(prefixes));

  await Promise.all(uniquePrefixes.map((prefix) => deleteServerCacheByPrefix(prefix)));
}

export async function invalidateAuthorizationCaches() {
  clearRuntimeCache("auth.roleKeys");
  clearRuntimeCache("auth.roleAssignments");
  clearRuntimeCache("auth.permissions.user");
  clearRuntimeCache("auth.permissions.all");
  clearRuntimeCache("navigation.platform_partner");
  clearRuntimeCache("navigation.rows");
  clearRuntimeCache("navigation.tree");
  clearRuntimeCache("tasks.access_context");

  await invalidatePrefixes([
    cachePrefixes.auth,
    cachePrefixes.navigation,
    cachePrefixes.dashboard,
    cachePrefixes.tasks,
    cachePrefixes.users,
    cachePrefixes.clients,
    cachePrefixes.serviceRequests,
    cachePrefixes.invoices,
    cachePrefixes.financeReports,
    cachePrefixes.servicePartners,
    cachePrefixes.options,
  ]);
}

export async function invalidateLocationCaches() {
  clearRuntimeCache("locations.active_states");
  await invalidatePrefixes([cachePrefixes.locations]);
}

export async function invalidateTenantDataCaches(servicePartnerId?: string | null) {
  const tenantPrefix = servicePartnerId ?? "global";

  await invalidatePrefixes([
    cachePrefixes.dashboard,
    cachePrefixes.financeReports,
    cachePrefixes.users,
    cachePrefixes.clients,
    cachePrefixes.servicePartners,
    cachePrefixes.serviceRequests,
    cachePrefixes.tasks,
    cachePrefixes.invoices,
    cachePrefixes.options,
    `${cachePrefixes.dashboard}:tenant:${tenantPrefix}`,
    `${cachePrefixes.users}:tenant:${tenantPrefix}`,
    `${cachePrefixes.clients}:tenant:${tenantPrefix}`,
    `${cachePrefixes.serviceRequests}:tenant:${tenantPrefix}`,
    `${cachePrefixes.tasks}:tenant:${tenantPrefix}`,
    `${cachePrefixes.invoices}:tenant:${tenantPrefix}`,
    `${cachePrefixes.options}:tenant:${tenantPrefix}`,
    `${cachePrefixes.financeReports}:tenant:${tenantPrefix}`,
  ]);
}
