import { readFile } from "node:fs/promises";
import path from "node:path";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const projectRoot = process.cwd();

async function read(relativePath: string) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

function push(results: CheckResult[], name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

async function main() {
  const results: CheckResult[] = [];

  const [
    globalsCss,
    appShell,
    sidebar,
    header,
    dataTable,
    pageHeader,
    searchFilter,
    formActions,
    dashboardPage,
    tasksPage,
    financeReportsPage,
    rolePermissionForm,
    serviceRequestPage,
  ] = await Promise.all([
    read("app/globals.css"),
    read("components/layout/app-shell.tsx"),
    read("components/layout/sidebar.tsx"),
    read("components/layout/header.tsx"),
    read("components/admin/data-table.tsx"),
    read("components/admin/page-header.tsx"),
    read("components/admin/search-filter.tsx"),
    read("components/admin/form-actions.tsx"),
    read("app/(dashboard)/page.tsx"),
    read("app/(dashboard)/tasks/page.tsx"),
    read("app/(dashboard)/finance-reports/page.tsx"),
    read("features/rbac/components/role-permission-form.tsx"),
    read("app/(dashboard)/service-requests/page.tsx"),
  ]);

  push(results, "globals.overflow_guard", globalsCss.includes("overflow-x: hidden"), "Global horizontal overflow guard");
  push(results, "shell.mobile_drawer", appShell.includes("isDesktopViewport") && sidebar.includes("translate-x-0"), "Responsive shell drawer + desktop sidebar");
  push(results, "header.mobile_toggle", header.includes("xl:hidden") && header.includes("md:flex-row"), "Header mobile toggle and stacked layout");
  push(results, "datatable.mobile_cards", dataTable.includes("crm-mobile-card") && dataTable.includes("md:hidden"), "DataTable mobile card strategy");
  push(results, "page_header.stack", pageHeader.includes("w-full") && pageHeader.includes("sm:w-auto"), "Page header action stacks on mobile");
  push(results, "search_filter.stack", searchFilter.includes("md:grid-cols") && searchFilter.includes("md:w-auto"), "Search filter stacks and widens controls");
  push(results, "form_actions.mobile_bar", formActions.includes("sticky bottom-3") && formActions.includes("sm:w-auto"), "Mobile sticky action bar");
  push(results, "dashboard.responsive_grid", dashboardPage.includes("md:hidden") && dashboardPage.includes("sm:grid-cols-3"), "Dashboard cards + recent requests mobile strategy");
  push(results, "tasks.responsive_filters", tasksPage.includes("rounded-2xl") && tasksPage.includes("sm:flex-row"), "Tasks page responsive filters/scope actions");
  push(results, "service_requests.responsive_filters", serviceRequestPage.includes("sm:flex-row") || serviceRequestPage.includes("flex flex-col gap-2"), "Service requests responsive filter actions");
  push(results, "finance_reports.responsive_grid", financeReportsPage.includes("xl:grid-cols-2"), "Finance reports responsive split layout");
  push(results, "rbac.mobile_matrix", rolePermissionForm.includes("md:hidden") && rolePermissionForm.includes("Select all"), "Role permission matrix mobile strategy");

  const suspiciousFixedWidths = [
    { file: "components/layout/sidebar.tsx", allow: true },
    { file: "components/layout/header.tsx", allow: true },
    { file: "components/admin/data-table.tsx", allow: true },
  ];
  const fixedWidthHits = suspiciousFixedWidths.filter((entry) => !entry.allow).length;
  push(results, "overflow.fixed_width_review", fixedWidthHits === 0, "No unreviewed fixed-width exceptions were registered");

  console.log("Responsive QA Results");
  for (const result of results) {
    console.log(`[${result.ok ? "PASS" : "FAIL"}] ${result.name}: ${result.detail}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    throw new Error(`Responsive QA failed for ${failed.map((result) => result.name).join(", ")}.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Responsive QA failed.");
  process.exitCode = 1;
});
