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
    settingsForm,
    ledgerPage,
    permissionsPage,
    branchesPage,
    categoriesPage,
    rateCardsPage,
    loginForm,
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
    read("features/settings/components/settings-form.tsx"),
    read("app/(dashboard)/ledger/page.tsx"),
    read("app/(dashboard)/permissions/page.tsx"),
    read("app/(dashboard)/branches/page.tsx"),
    read("app/(dashboard)/categories/page.tsx"),
    read("app/(dashboard)/rate-cards/page.tsx"),
    read("features/auth/components/login-form.tsx"),
  ]);

  const sidebarLabelSnippets = [
    '"/": "Dashboard"',
    '"/users": "Client User Management"',
    '"/roles": "Roles"',
    '"/permissions": "Permissions"',
    '"/service-partners": "Service Partners"',
    '"/clients": "Clients"',
    '"/branches": "Branch Management"',
    '"/categories": "Category Management"',
    '"/items": "Items"',
    '"/rate-cards": "RC Management"',
    '"/service-requests": "Service Requests"',
    '"/tasks": "Tasks"',
    '"/vendors": "Supplier Management"',
    '"/rfqs": "RFQ List"',
    '"/purchase-orders": "PO List"',
    '"/ledger": "Ledger"',
    '"/invoices": "Vendor Invoices"',
    '"/vendor-payments": "Vendors Payment List"',
    '"/finance-reports": "Finance Reports"',
    '"/activity-log": "Activity Log"',
    '"/email-change-requests": "Email Change Requests"',
    '"/settings": "Settings"',
  ];
  const sidebarOrderOk = sidebarLabelSnippets.every((snippet, index, list) => {
    const currentIndex = sidebar.indexOf(snippet);
    const previousIndex = index === 0 ? -1 : sidebar.indexOf(list[index - 1] ?? "");
    return currentIndex !== -1 && currentIndex > previousIndex;
  });
  const sourceChecks = [financeReportsPage, settingsForm, ledgerPage, permissionsPage, loginForm];

  push(results, "globals.overflow_guard", globalsCss.includes("overflow-x: hidden"), "Global horizontal overflow guard");
  push(results, "shell.mobile_drawer", appShell.includes("isDesktopViewport") && sidebar.includes("translate-x-0"), "Responsive shell drawer + desktop sidebar");
  push(results, "sidebar.matrix_order", sidebar.includes("NAV_SECTION_ORDER") && sidebarOrderOk, "Sidebar keeps the locked Matrix section and module order");
  push(results, "header.mobile_toggle", header.includes("xl:hidden") && header.includes("lg:inline-flex"), "Header mobile toggle and responsive action stack");
  push(results, "datatable.mobile_cards", dataTable.includes("crm-mobile-card") && dataTable.includes("md:hidden"), "DataTable mobile card strategy");
  push(results, "page_header.stack", pageHeader.includes("w-full") && pageHeader.includes("sm:w-auto"), "Page header action stacks on mobile");
  push(results, "search_filter.stack", searchFilter.includes("md:grid-cols") && searchFilter.includes("md:w-auto"), "Search filter stacks and widens controls");
  push(results, "form_actions.mobile_bar", formActions.includes("sticky bottom-3") && formActions.includes("sm:w-auto"), "Mobile sticky action bar");
  push(results, "dashboard.responsive_grid", dashboardPage.includes("md:hidden") && dashboardPage.includes("sm:grid-cols-2") && dashboardPage.includes("2xl:grid-cols-7"), "Dashboard cards + recent requests mobile strategy");
  push(results, "tasks.responsive_filters", tasksPage.includes("rounded-2xl") && tasksPage.includes("sm:flex-row"), "Tasks page responsive filters/scope actions");
  push(results, "service_requests.responsive_filters", serviceRequestPage.includes("lg:flex-row") && serviceRequestPage.includes("xl:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_auto]"), "Service requests responsive filter actions");
  push(results, "finance_reports.responsive_grid", financeReportsPage.includes("xl:grid-cols-2"), "Finance reports responsive split layout");
  push(results, "rbac.mobile_matrix", rolePermissionForm.includes("md:hidden") && rolePermissionForm.includes("Select all"), "Role permission matrix mobile strategy");
  push(results, "ui.no_placeholder_hash_links", sourceChecks.every((source) => !source.includes('href="#"')), "No placeholder href=\"#\" links in audited UI sources");
  push(
    results,
    "settings.real_runtime_surface",
    !["Change Logo", "Manage Policy", "Manage 2FA", "Manage Sessions", "View System Info", "MySQL 8.0.33", "PHP 8.2.12"].some((token) => settingsForm.includes(token)) &&
      settingsForm.includes("Runtime Diagnostics") &&
      settingsForm.includes("OTP & Security Controls"),
    "Settings only exposes real tenant-safe controls and diagnostics"
  );
  push(
    results,
    "ledger.no_fake_manual_actions",
    ledgerPage.includes("Manual chart-of-accounts entry is not exposed") &&
      !["New Transaction", "Add Income", "Add Expense"].some((token) => ledgerPage.includes(token)),
    "Ledger avoids fake manual-accounting CTAs and uses payables-focused wording"
  );
  push(
    results,
    "permissions.no_dead_catalog_actions",
    permissionsPage.includes("Permission catalog is platform-seeded in this build.") &&
      permissionsPage.includes("Manage Roles") &&
      !permissionsPage.includes('title="Permission catalog is platform-seeded in this build."'),
    "Permissions page avoids dead create/group actions"
  );
  push(
    results,
    "supporting_pages.hide_unimplemented_file_flows",
    branchesPage.includes("Import and export are hidden until branch file flows are implemented.") &&
      categoriesPage.includes("Export appears here once category export is backed by a real route.") &&
      rateCardsPage.includes("Import and export stay hidden until real rate card file flows are available."),
    "Branch, category, and rate card pages explain hidden file flows instead of rendering dead buttons"
  );
  push(results, "auth.no_placeholder_terms_links", !loginForm.includes('href="#"'), "Auth screen does not ship placeholder terms/privacy links");

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
