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

  const states = await prisma.state.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      cities: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { name: true },
      },
    },
  });

  const stateCount = states.length;
  const cityCount = states.reduce((sum, state) => sum + state.cities.length, 0);
  const cities = states.flatMap((state) =>
    state.cities.map((city) => ({
      stateId: state.id,
      name: city.name,
    }))
  );
  const cityNamesByState = new Map(states.map((state) => [state.name, new Set(state.cities.map((city) => city.name.toLowerCase()))]));
  const duplicateCities = Array.from(
    cities.reduce((counts, city) => {
      const key = `${city.stateId}:${city.name.toLowerCase()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()).entries()
  ).filter(([, count]) => count > 1);
  const largeStates = ["Andhra Pradesh", "Gujarat", "Karnataka", "Maharashtra", "Tamil Nadu", "Uttar Pradesh", "West Bengal"];
  const largeStatesOverThreshold = largeStates.every((stateName) => (cityNamesByState.get(stateName)?.size ?? 0) > 3);

  pushCheck(results, "db.states_seeded", stateCount >= 36, `active_states=${stateCount}`);
  pushCheck(results, "db.cities_seeded", cityCount >= 300, `active_cities=${cityCount}`);
  pushCheck(results, "db.large_states_have_more_than_three_cities", largeStatesOverThreshold);
  pushCheck(results, "db.city_unique_per_state", duplicateCities.length === 0, `duplicates=${duplicateCities.length}`);
  pushCheck(
    results,
    "db.city_lists_are_state_specific",
    Boolean(cityNamesByState.get("Karnataka")?.has("bengaluru")) &&
      !Boolean(cityNamesByState.get("Delhi")?.has("bengaluru")) &&
      Boolean(cityNamesByState.get("Delhi")?.has("new delhi")) &&
      Boolean(cityNamesByState.get("Maharashtra")?.has("mumbai"))
  );

  const [servicePartnerFormSource, servicePartnerServiceSource, locationServiceSource, createPageSource, editPageSource, searchableSelectSource] =
    await Promise.all([
      readWorkspaceFile("features", "service-partners", "components", "service-partner-form.tsx"),
      readWorkspaceFile("features", "service-partners", "services", "service-partner.service.ts"),
      readWorkspaceFile("features", "locations", "services", "location.service.ts"),
      readWorkspaceFile("app", "(dashboard)", "service-partners", "new", "page.tsx"),
      readWorkspaceFile("app", "(dashboard)", "service-partners", "[id]", "edit", "page.tsx"),
      readWorkspaceFile("components", "admin", "searchable-select.tsx"),
    ]);

  pushCheck(
    results,
    "ui.searchable_select_source_exists",
    searchableSelectSource.includes('"use client"') &&
      searchableSelectSource.includes('type="hidden"') &&
      searchableSelectSource.includes('role="combobox"') &&
      searchableSelectSource.includes("Type to search...")
  );
  pushCheck(
    results,
    "form.state_searchable_select",
    servicePartnerFormSource.includes("SearchableSelect") &&
      servicePartnerFormSource.includes('label="State"') &&
      servicePartnerFormSource.includes('name="state"') &&
      servicePartnerFormSource.includes("Type state name...")
  );
  pushCheck(
    results,
    "form.city_searchable_select",
    servicePartnerFormSource.includes('label="City"') &&
      servicePartnerFormSource.includes('name="city"') &&
      servicePartnerFormSource.includes("Type city name...") &&
      servicePartnerFormSource.includes('placeholder={selectedState ? "Select city" : "Select state first"}')
  );
  pushCheck(
    results,
    "form.city_resets_on_state_change",
    servicePartnerFormSource.includes("function handleStateChange") && servicePartnerFormSource.includes('setSelectedCity("")')
  );
  pushCheck(
    results,
    "form.edit_preselect_source_exists",
    servicePartnerFormSource.includes("initialStateValue") &&
      servicePartnerFormSource.includes("initialCityValue") &&
      createPageSource.includes("listActiveStatesWithCities") &&
      editPageSource.includes("listActiveStatesWithCities")
  );
  pushCheck(
    results,
    "service.validation_rejects_cross_state_city",
    servicePartnerServiceSource.includes("resolveStateCitySelection") &&
      servicePartnerServiceSource.includes("allowLegacyPair") &&
      locationServiceSource.includes("Select a valid city for the chosen state.")
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
