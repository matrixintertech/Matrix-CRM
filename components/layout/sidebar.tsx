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
  "Dashboard",
  "User Management",
  "Organization",
  "Inventory & Services",
  "Service Requests",
  "Procurement",
  "Finance",
  "Reports",
] as const;

const SECTION_MATCHERS: Record<(typeof NAV_SECTION_ORDER)[number], string[]> = {
  Dashboard: ["dashboard"],
  "User Management": ["users", "/users", "roles", "/roles", "permissions", "/permissions"],
  Organization: ["service-partners", "/service-partners", "clients", "/clients", "branches", "/branches"],
  "Inventory & Services": ["categories", "/categories", "items", "/items", "rate-cards", "/rate-cards"],
  "Service Requests": ["service-requests", "/service-requests", "quotations", "/quotations", "tasks", "/tasks"],
  Procurement: ["vendors", "/vendors", "rfq", "/rfqs", "purchase-order", "/purchase-orders"],
  Finance: ["invoice", "/invoices", "payments", "/vendor-payments", "ledger", "/ledger"],
  Reports: ["finance-reports", "/finance-reports", "activity-log", "/activity-log", "notifications", "/notifications"],
};

function MatrixLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#3f64ff] to-[#5d86ff]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 18V6l5.5 6L14 6v12" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 18V6l7 12V6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="text-[22px] font-semibold leading-none text-white">Matrix CRM</span>
    </div>
  );
}

function iconClass(level: number) {
  return level === 0 ? "h-4.5 w-4.5" : "h-4 w-4";
}

function IconForKey({ keyName, level }: { keyName: string; level: number }) {
  const common = iconClass(level);

  if (keyName.includes("dashboard")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="4" width="7" height="7" rx="2" />
        <rect x="13" y="4" width="7" height="11" rx="2" />
        <rect x="4" y="13" width="7" height="7" rx="2" />
        <rect x="13" y="17" width="7" height="3" rx="1.5" />
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

  if (keyName.includes("partner")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8.5 13.5 5 10a2.5 2.5 0 1 1 3.5-3.5L12 10l3.5-3.5A2.5 2.5 0 1 1 19 10l-3.5 3.5" />
        <path d="m7 17 2-2m6 2-2-2" />
      </svg>
    );
  }

  if (keyName.includes("supplier") || keyName.includes("vendor")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 19h16" />
        <path d="M6 19V8l6-3 6 3v11" />
        <path d="M9 12h.01M12 12h.01M15 12h.01M9 15h.01M12 15h.01M15 15h.01" />
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

  if (keyName.includes("branch")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 20h16" />
        <path d="M6 20V8l6-3 6 3v12" />
        <path d="M10 12h4M10 15h4" />
      </svg>
    );
  }

  if (keyName.includes("categorie") || keyName.includes("item")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h16M4 12h16M4 17h16" />
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

  if (keyName.includes("rfq")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  }

  if (keyName.includes("task") || keyName.includes("activity")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 6h12M8 12h12M8 18h12" />
        <path d="m3 6 1.5 1.5L6.5 5.5M3 12l1.5 1.5L6.5 11.5M3 18l1.5 1.5L6.5 17.5" />
      </svg>
    );
  }

  if (keyName.includes("ledger") || keyName.includes("finance") || keyName.includes("payment") || keyName.includes("expense") || keyName.includes("invoice")) {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
        <path d="M8 8h8M8 12h8M8 16h5" />
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
    sections.push({ title: "MORE", items: ungroupedItems });
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

  const containerClass =
    level === 0
      ? "rounded-xl"
      : "rounded-lg border border-[#25467f]/35 bg-[#0b2c63]/35";

  const linkBase =
    level === 0
      ? "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium"
      : "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium";

  const linkState = isActive
    ? "bg-gradient-to-r from-[#2854e8] to-[#2f64ff] text-white shadow-[0_10px_24px_rgba(47,100,255,0.35)]"
    : hasActiveChild
      ? "bg-[#11357a]/70 text-white"
      : isDisabled
        ? "text-[#90a9d8]/70"
        : "text-[#d7e5ff] hover:bg-white/10";

  const chevronColor = isActive || hasActiveChild ? "text-[#d6e4ff]" : "text-[#9db6e8]";

  return (
    <li className={containerClass}>
      <div className={`${linkBase} ${linkState}`}>
        {isDisabled ? (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="opacity-95">
              <IconForKey keyName={item.key} level={level} />
            </span>
            <span className="truncate">{item.label}</span>
            <span className="rounded border border-[#47649a] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[#9ab3e1]">
              SOON
            </span>
          </span>
        ) : (
          <PrefetchLink href={item.href} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3">
            <span className="opacity-95">
              <IconForKey keyName={item.key} level={level} />
            </span>
            <span className="truncate">{item.label}</span>
          </PrefetchLink>
        )}

        {hasChildren ? (
          <button
            type="button"
            aria-label={isOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
            onClick={() => onToggle(item.id)}
            className={`grid h-6 w-6 place-items-center rounded-md hover:bg-white/10 ${chevronColor}`}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className={chevronColor}>
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
  const usingFallback = items.some((item) => item.isDevelopmentFallback);
  const visibilityClass = isOpen ? "flex" : "hidden";
  const desktopVisibilityClass = isOpen ? "lg:flex" : "lg:hidden";

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
      className={`${visibilityClass} ${desktopVisibilityClass} fixed inset-y-0 left-0 z-30 w-[296px] shrink-0 border-r border-[#102a63] bg-gradient-to-b from-[#08214f] via-[#061f4a] to-[#061a42] px-5 py-6 text-white lg:static lg:z-auto lg:flex-col`}
    >
      <MatrixLogo />
      <p className="mt-4 text-sm leading-6 text-[#a8bee8]">Operations, procurement, finance, and access control in one workspace.</p>

      <nav aria-label="Primary navigation" className="mt-8 flex-1 overflow-y-auto pr-1">
        {sections.map((section) => (
          <div key={section.title || "main"} className="mb-6">
            <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#9db6e8]">{section.title}</p>
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

      {usingFallback ? (
        <p className="mt-3 rounded-md border border-amber-300/40 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
          Development navigation fallback is active.
        </p>
      ) : null}
      <div className="mt-4 rounded-2xl border border-[#24457d] bg-white/5 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9db6e8]">Navigation</p>
        <p className="mt-2 text-sm text-[#dbe8ff]">Use the header menu on smaller screens. Long module lists stay scrollable here.</p>
      </div>
    </aside>
  );
}
