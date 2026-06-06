type CacheKeyPart = string | number | boolean | null | undefined;

function normalizePart(part: CacheKeyPart) {
  if (part === null || part === undefined || part === "") {
    return "_";
  }

  return encodeURIComponent(String(part));
}

export function buildCacheKey(...parts: CacheKeyPart[]) {
  return parts.map((part) => normalizePart(part)).join(":");
}

export function buildRoleSignature(roleKeys: string[] | undefined) {
  if (!roleKeys || roleKeys.length === 0) {
    return "none";
  }

  return buildCacheKey(...Array.from(new Set(roleKeys)).sort());
}

export function buildFilterSignature(value: unknown) {
  return encodeURIComponent(JSON.stringify(value ?? null));
}

export const cachePrefixes = {
  auth: "auth",
  dashboard: "dashboard",
  financeReports: "finance_reports",
  invoices: "invoices",
  locations: "locations",
  navigation: "navigation",
  servicePartners: "service_partners",
  serviceRequests: "service_requests",
  tasks: "tasks",
  users: "users",
  clients: "clients",
  options: "options",
} as const;
