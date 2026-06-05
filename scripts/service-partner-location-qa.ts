import { readFile } from "node:fs/promises";
import path from "node:path";

import { createPrismaClient } from "../lib/db/client";

const prisma = createPrismaClient();

type Check = {
  name: string;
  passed: boolean;
  details?: string;
};

function pushCheck(results: Check[], name: string, passed: boolean, details?: string) {
  results.push({ name, passed, details });
}

async function readWorkspaceFile(...parts: string[]) {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

async function main() {
  const results: Check[] = [];

  const [stateCount, cityCount, cities] = await Promise.all([
    prisma.state.count({ where: { isActive: true } }),
    prisma.city.count({ where: { isActive: true } }),
    prisma.city.findMany({
      where: { isActive: true },
      select: { stateId: true, name: true },
    }),
  ]);
  const duplicateCities = Array.from(
    cities.reduce((counts, city) => {
      const key = `${city.stateId}:${city.name.toLowerCase()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()).entries()
  ).filter(([, count]) => count > 1);

  pushCheck(results, "db.states_seeded", stateCount > 0, `active_states=${stateCount}`);
  pushCheck(results, "db.cities_seeded", cityCount > 0, `active_cities=${cityCount}`);
  pushCheck(results, "db.city_unique_per_state", duplicateCities.length === 0, `duplicates=${duplicateCities.length}`);

  const [servicePartnerFormSource, servicePartnerServiceSource, createPageSource, editPageSource] = await Promise.all([
    readWorkspaceFile("features", "service-partners", "components", "service-partner-form.tsx"),
    readWorkspaceFile("features", "service-partners", "services", "service-partner.service.ts"),
    readWorkspaceFile("app", "(dashboard)", "service-partners", "new", "page.tsx"),
    readWorkspaceFile("app", "(dashboard)", "service-partners", "[id]", "edit", "page.tsx"),
  ]);

  pushCheck(results, "form.state_select", servicePartnerFormSource.includes('name="state"') && servicePartnerFormSource.includes("Select state"));
  pushCheck(
    results,
    "form.city_select_depends_on_state",
    servicePartnerFormSource.includes('name="city"') &&
      servicePartnerFormSource.includes("Select city") &&
      servicePartnerFormSource.includes('disabled={!selectedState}')
  );
  pushCheck(results, "form.city_resets_on_state_change", servicePartnerFormSource.includes('setSelectedCity("")'));
  pushCheck(
    results,
    "form.edit_preselect_source_exists",
    createPageSource.includes("listActiveStatesWithCities") && editPageSource.includes("listActiveStatesWithCities")
  );
  pushCheck(
    results,
    "service.validation_rejects_cross_state_city",
    servicePartnerServiceSource.includes("resolveStateCitySelection") &&
      servicePartnerServiceSource.includes("allowLegacyPair")
  );

  const selectorFiles = [
    ["features", "users", "components", "user-form.tsx"],
    ["features", "clients", "components", "client-form.tsx"],
    ["features", "vendors", "components", "vendor-form.tsx"],
    ["features", "service-requests", "components", "service-request-form.tsx"],
    ["features", "purchase-orders", "components", "purchase-order-form.tsx"],
    ["features", "vendor-payments", "components", "vendor-payment-form.tsx"],
    ["features", "invoices", "components", "invoice-form.tsx"],
    ["features", "branches", "components", "branch-form.tsx"],
    ["features", "categories", "components", "category-form.tsx"],
    ["features", "items", "components", "item-form.tsx"],
    ["features", "rate-cards", "components", "rate-card-form.tsx"],
    ["features", "rfqs", "components", "rfq-form.tsx"],
    ["features", "rbac", "components", "role-form.tsx"],
    ["app", "(dashboard)", "branches", "new", "page.tsx"],
    ["app", "(dashboard)", "branches", "[id]", "edit", "page.tsx"],
    ["app", "(dashboard)", "branches", "page.tsx"],
  ];

  const selectorSources = await Promise.all(selectorFiles.map((parts) => readWorkspaceFile(...parts)));
  const selectorCoverage = selectorSources.every((source) => source.includes("getServicePartnerDisplayLabel("));
  pushCheck(results, "labels.service_partner_selectors_use_helper", selectorCoverage, `checked_files=${selectorFiles.length}`);

  pushCheck(
    results,
    "tenant_scope_intact",
    servicePartnerServiceSource.includes("id: session.user.servicePartnerId") &&
      servicePartnerServiceSource.includes("return session.user.isSuperAdmin;")
  );

  const failures = results.filter((result) => !result.passed);
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.details ? ` ${result.details}` : ""}`);
  }

  if (failures.length > 0) {
    throw new Error(`service-partner-location-qa failed with ${failures.length} failing checks`);
  }
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
