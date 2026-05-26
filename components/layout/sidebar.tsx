import Link from "next/link";

import type { SidebarNavItem } from "@/features/navigation/services/navigation.service";

type SidebarProps = {
  items: SidebarNavItem[];
};

function NavItem({ item }: { item: SidebarNavItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
      >
        {item.label}
      </Link>
      {item.children.length > 0 ? (
        <ul className="mt-1 space-y-1 border-l border-slate-200 pl-3">
          {item.children.map((child) => (
            <NavItem key={child.id} item={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Sidebar({ items }: SidebarProps) {
  const usingFallback = items.some((item) => item.isDevelopmentFallback);

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--border)] bg-white p-4">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Workspace</p>
        <h2 className="text-base font-semibold">Matrix CRM</h2>
      </div>
      <nav aria-label="Primary navigation">
        <ul className="space-y-1">
          {items.map((item) => (
            <NavItem key={item.id} item={item} />
          ))}
        </ul>
      </nav>
      {usingFallback ? (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Development navigation fallback is active.
        </p>
      ) : null}
    </aside>
  );
}
