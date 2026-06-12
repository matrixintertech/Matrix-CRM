"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import type { SidebarNavItem } from "@/features/navigation/services/navigation.service";

type SidebarProps = {
  items: SidebarNavItem[];
  isOpen: boolean;
  onNavigate?: () => void;
};

type NavSection = {
  title: string;
  items: SidebarNavItem[];
};

const NAV_SECTION_ORDER = [
  "Platform",
  "User Management",
  "Organization",
  "Inventory & Services",
  "Service Requests",
  "Procurement",
  "Finance",
  "Reports",
] as const;

const SECTION_MATCHERS: Record<(typeof NAV_SECTION_ORDER)[number], string[]> = {
  Platform: ["dashboard"],
  "User Management": ["users", "/users", "roles", "/roles", "permissions", "/permissions"],
  Organization: ["service-partners", "/service-partners", "clients", "/clients", "branches", "/branches"],
  "Inventory & Services": ["categories", "/categories", "items", "/items", "rate-cards", "/rate-cards"],
  "Service Requests": ["service-requests", "/service-requests", "quotations", "/quotations", "tasks", "/tasks"],
  Procurement: ["vendors", "/vendors", "rfq", "/rfqs", "purchase-order", "/purchase-orders"],
  Finance: ["invoice", "/invoices", "payments", "/vendor-payments", "ledger", "/ledger"],
  Reports: ["finance-reports", "/finance-reports", "activity-log", "/activity-log", "email-change", "/email-change-requests"],
};

const labelOverrides: Record<string, string> = {
  "/": "Dashboard",
  "/users": "Client User Management",
  "/roles": "Roles",
  "/permissions": "Permissions",
  "/service-partners": "Service Partners",
  "/clients": "Clients",
  "/branches": "Branch Management",
  "/categories": "Category Management",
  "/items": "Items",
  "/rate-cards": "RC Management",
  "/service-requests": "Service Requests",
  "/tasks": "Tasks",
  "/vendors": "Supplier Management",
  "/rfqs": "RFQ List",
  "/purchase-orders": "PO List",
  "/ledger": "Ledger",
  "/invoices": "Vendor Invoices",
  "/vendor-payments": "Vendors Payment List",
  "/finance-reports": "Finance Reports",
  "/activity-log": "Activity Log",
  "/email-change-requests": "Email Change Requests",
  "/settings": "Settings",
};

function MatrixLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-[#5a6bff] via-[#455dff] to-[#2f66ff] shadow-[0_10px_24px_rgba(56,87,255,0.28)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 18V6l4.5 5L13 6v12" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 18V6l7 12V8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="text-[18px] font-semibold tracking-[-0.02em] text-white">Matrix CRM</span>
    </div>
  );
}

function iconClass(level: number) {
  return level === 0 ? "h-[17px] w-[17px]" : "h-4 w-4";
}

function IconForKey({ keyName, level }: { keyName: string; level: number }) {
  const common = iconClass(level);

  if (keyName.includes("dashboard")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="4" width="7" height="7" rx="2" />
        <rect x="13" y="4" width="7" height="7" rx="2" />
        <rect x="4" y="13" width="7" height="7" rx="2" />
        <rect x="13" y="13" width="7" height="7" rx="2" />
      </svg>
    );
  }

  if (keyName.includes("user") || keyName.includes("role")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <circle cx="17" cy="8.5" r="2.5" />
        <path d="M14.5 18.5a4.4 4.4 0 0 1 6 0" />
      </svg>
    );
  }

  if (keyName.includes("permission")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3.5 19 6v5.4c0 4.4-2.8 7.7-7 9.1-4.2-1.4-7-4.7-7-9.1V6l7-2.5Z" />
        <path d="m9.4 12.3 1.7 1.7 3.7-4" />
      </svg>
    );
  }

  if (keyName.includes("partner") || keyName.includes("branch") || keyName.includes("vendor")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 20h16" />
        <path d="M7 20V5l5-2 5 2v15" />
        <path d="M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01" />
      </svg>
    );
  }

  if (keyName.includes("client")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
    );
  }

  if (keyName.includes("categorie") || keyName.includes("item")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 7h14M5 12h14M5 17h14" />
      </svg>
    );
  }

  if (keyName.includes("rate")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="5" width="16" height="14" rx="2.5" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    );
  }

  if (keyName.includes("service")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 8h14v10H5z" />
        <path d="M8 8V5h8v3" />
      </svg>
    );
  }

  if (keyName.includes("rfq") || keyName.includes("invoice") || keyName.includes("finance") || keyName.includes("ledger") || keyName.includes("payment")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="4" width="14" height="16" rx="2.5" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  }

  if (keyName.includes("task") || keyName.includes("activity") || keyName.includes("email")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 6h12M8 12h12M8 18h12" />
        <path d="m3 6 1.5 1.5L6.5 5.5M3 12l1.5 1.5L6.5 11.5M3 18l1.5 1.5L6.5 17.5" />
      </svg>
    );
  }

  if (keyName.includes("setting")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function resolveSections(items: SidebarNavItem[]): NavSection[] {
  const mappedItemIds = new Set<string>();
  const matchesSection = (item: SidebarNavItem, title: (typeof NAV_SECTION_ORDER)[number]): boolean => {
    const matchers = SECTION_MATCHERS[title] ?? [];
    const haystacks = [item.key.toLowerCase(), item.href.toLowerCase()];

    if (matchers.some((matcher) => haystacks.some((haystack) => haystack.includes(matcher)))) {
      return true;
    }

    return item.children.some((child) => matchesSection(child, title));
  };

  const sections: NavSection[] = NAV_SECTION_ORDER.map((title) => {
    const sectionItems = items.filter((item) => {
      const isMapped = matchesSection(item, title);
      if (isMapped) {
        mappedItemIds.add(item.id);
      }
      return isMapped;
    });

    return { title, items: sectionItems };
  });

  const ungroupedItems = items.filter((item) => !mappedItemIds.has(item.id));
  if (ungroupedItems.length > 0) {
    sections.push({ title: "More", items: ungroupedItems });
  }

  return sections.filter((group) => group.items.length > 0);
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function hasActiveDescendant(item: SidebarNavItem, pathname: string): boolean {
  if (isActivePath(pathname, item.href)) {
    return true;
  }

  return item.children.some((child) => hasActiveDescendant(child, pathname));
}

function collectInitialOpenKeys(items: SidebarNavItem[], pathname: string, result = new Set<string>()) {
  for (const item of items) {
    if (item.children.length > 0 && hasActiveDescendant(item, pathname)) {
      result.add(item.id);
      collectInitialOpenKeys(item.children, pathname, result);
    }
  }

  return result;
}

type MenuItemProps = {
  item: SidebarNavItem;
  pathname: string;
  level: number;
  openKeys: Set<string>;
  onToggle: (id: string) => void;
  onNavigate?: () => void;
};

function MenuItem({ item, pathname, level, openKeys, onToggle, onNavigate }: MenuItemProps) {
  const isActive = isActivePath(pathname, item.href);
  const hasActiveChild = item.children.length > 0 && item.children.some((child) => hasActiveDescendant(child, pathname));
  const isOpen = openKeys.has(item.id);
  const hasChildren = item.children.length > 0;
  const isDisabled = item.href === "#";
  const displayLabel = labelOverrides[item.href] ?? item.label;

  const linkBase =
    level === 0
      ? "flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-medium"
      : "flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] font-medium";

  const linkState = isActive
    ? "bg-gradient-to-r from-[#4e57fa] to-[#3566ff] text-white shadow-[0_10px_24px_rgba(53,102,255,0.32)]"
    : hasActiveChild
      ? "bg-white/10 text-white"
      : isDisabled
        ? "text-[#8ea6d3]/70"
        : "text-[#dce7ff] hover:bg-white/8";

  return (
    <li>
      <div className={`${linkBase} ${linkState}`}>
        {isDisabled ? (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="opacity-95">
              <IconForKey keyName={item.key} level={level} />
            </span>
            <span className="truncate">{displayLabel}</span>
          </span>
        ) : (
          <PrefetchLink href={item.href} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3">
            <span className="opacity-95">
              <IconForKey keyName={item.key} level={level} />
            </span>
            <span className="truncate">{displayLabel}</span>
          </PrefetchLink>
        )}

        {hasChildren ? (
          <button
            type="button"
            aria-label={isOpen ? `Collapse ${displayLabel}` : `Expand ${displayLabel}`}
            onClick={() => onToggle(item.id)}
            className="grid h-6 w-6 place-items-center rounded-md text-[#a9bbe2] hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="text-[#9ab0d9]">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
        )}
      </div>

      {hasChildren && isOpen ? (
        <ul className="mt-1 space-y-1 pl-3">
          {item.children.map((child) => (
            <MenuItem
              key={child.id}
              item={child}
              pathname={pathname}
              level={level + 1}
              openKeys={openKeys}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Sidebar({ items, isOpen, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const sections = resolveSections(items);

  const initialKeys = useMemo(() => {
    const keySet = collectInitialOpenKeys(items, pathname);
    return Array.from(keySet);
  }, [items, pathname]);

  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set(initialKeys));

  useEffect(() => {
    setOpenKeys((current) => {
      const next = new Set(current);
      for (const key of initialKeys) {
        next.add(key);
      }
      return next;
    });
  }, [initialKeys]);

  const toggleOpenKey = (id: string) => {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-[min(86vw,294px)] shrink-0 flex-col border-r border-[#10204d] bg-gradient-to-b from-[#07153f] via-[#081845] to-[#06163b] px-4 py-5 text-white shadow-[0_24px_60px_rgba(5,18,44,0.42)] transition-transform duration-200 ease-out ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      } xl:static xl:z-auto xl:w-[294px] xl:translate-x-0 xl:px-4 xl:py-5 xl:shadow-none`}
    >
      <div className="flex items-start justify-between gap-3">
        <MatrixLogo />
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onNavigate}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/12 text-[#d7e5ff] xl:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <nav aria-label="Primary navigation" className="mt-6 flex-1 overflow-y-auto pr-1">
        {sections.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8fa6d3]">{section.title}</p>
            <ul className="space-y-1.5">
              {section.items.map((item) => (
                <MenuItem
                  key={item.id}
                  item={item}
                  pathname={pathname}
                  level={0}
                  openKeys={openKeys}
                  onToggle={toggleOpenKey}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-4 rounded-[14px] border border-[#4b2f73] bg-gradient-to-br from-[#1d1b5a] to-[#152457] px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-[#dce7ff]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 12a7 7 0 0 1 14 0v5" />
              <rect x="4" y="12" width="4" height="6" rx="2" />
              <rect x="16" y="12" width="4" height="6" rx="2" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Need help?</p>
            <p className="mt-1 text-xs text-[#b9c7ea]">Visit our help center</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
