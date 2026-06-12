"use client";

import type { Session } from "next-auth";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Breadcrumb, type BreadcrumbItem } from "@/components/layout/breadcrumb";
import type { SidebarNavItem } from "@/features/navigation/services/navigation.service";

type HeaderProps = {
  session: Session;
  navigationItems: SidebarNavItem[];
  onToggleSidebar: () => void;
};

function humanizeSegment(segment: string) {
  return segment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createHrefLabelMap(items: SidebarNavItem[], map = new Map<string, string>()) {
  for (const item of items) {
    if (item.href !== "#") {
      map.set(item.href, item.label);
    }
    createHrefLabelMap(item.children, map);
  }

  return map;
}

function buildBreadcrumbs(pathname: string, navigationItems: SidebarNavItem[]): BreadcrumbItem[] {
  const hrefLabels = createHrefLabelMap(navigationItems);
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: BreadcrumbItem[] = [{ label: "Dashboard", href: "/" }];
  let currentPath = "";

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    currentPath += `/${segment}`;
    const isLast = index === segments.length - 1;
    const isDynamicLike = /^[0-9a-f-]{8,}$/i.test(segment);
    const label =
      hrefLabels.get(currentPath) ??
      (segment === "new" ? "Create" : segment === "edit" ? "Edit" : isDynamicLike ? "Details" : humanizeSegment(segment));

    crumbs.push({
      label,
      href: isLast ? undefined : currentPath,
    });
  }

  return crumbs;
}

export function Header({ session, navigationItems, onToggleSidebar }: HeaderProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const displayName = session.user.name ?? session.user.email ?? session.user.phone ?? "User";
  const roleLabel = session.user.isSuperAdmin
    ? "Super Admin"
    : session.user.roleKeys?.includes("company_admin")
      ? "Company Admin"
      : "Company User";
  const workspaceLabel = session.user.isSuperAdmin ? "Platform Workspace" : "Tenant Workspace";
  const initials = session.user.isSuperAdmin
    ? "SA"
    : displayName
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
  const breadcrumbs = useMemo(() => {
    if (pathname === "/") {
      return [
        { label: "Dashboard", href: "/" },
        { label: session.user.isSuperAdmin ? "Platform Dashboard" : session.user.roleKeys?.includes("company_admin") ? "Company Dashboard" : "Dashboard" },
      ];
    }

    return buildBreadcrumbs(pathname, navigationItems);
  }, [navigationItems, pathname, session.user.isSuperAdmin, session.user.roleKeys]);
  const quickActionHref = pathname === "/" ? "#dashboard-quick-actions" : "/#dashboard-quick-actions";
  const alertsHref = pathname === "/" ? "#dashboard-alerts" : "/#dashboard-alerts";

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!profileRef.current) {
        return;
      }

      if (!profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  async function handleLogout() {
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[#e8edf6] bg-white">
      <div className="px-3 py-3 sm:px-5 lg:px-6 xl:px-8">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,392px)_auto] xl:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Toggle sidebar"
              onClick={onToggleSidebar}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde5f2] text-[#41557a] transition hover:bg-[#f6f8fc] xl:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="min-w-0">
              <Breadcrumb items={breadcrumbs} />
            </div>
          </div>

          <label className="hidden h-12 items-center gap-3 rounded-[12px] border border-[#e4e9f3] bg-[#fbfcff] px-4 xl:flex">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-[#8392a8]" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              readOnly
              aria-label="Search across Matrix CRM"
              value=""
              placeholder="Search across Matrix CRM..."
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#183059] outline-none placeholder:text-[#9ca9bd]"
            />
            <span className="flex items-center gap-1 rounded-lg border border-[#e2e8f3] bg-white px-2 py-1 text-[11px] font-semibold text-[#8a98ad]">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 6h12M4 10h12M4 14h7" />
              </svg>
              <span>K</span>
            </span>
          </label>

          <div className="flex items-center justify-end gap-3">
            <Link
              href={alertsHref}
              aria-label="Alerts"
              className="relative grid h-10 w-10 place-items-center rounded-[12px] border border-[#e1e7f1] text-[#203459] transition hover:bg-[#f7f9fd]"
            >
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ff4d5e] px-1 text-[10px] font-bold text-white">
                12
              </span>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M6 8a6 6 0 0 1 12 0v4.4l1.3 2.4a1 1 0 0 1-.9 1.5H5.6a1 1 0 0 1-.9-1.5L6 12.4V8Z" />
                <path d="M9.7 18a2.3 2.3 0 0 0 4.6 0" />
              </svg>
            </Link>

            <Link
              href={quickActionHref}
              className="hidden h-11 items-center justify-center gap-2 rounded-[12px] bg-gradient-to-r from-[#585efc] to-[#3466ff] px-5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(52,102,255,0.24)] transition hover:brightness-105 lg:inline-flex"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>Quick Action</span>
            </Link>

            <div ref={profileRef} className="relative">
              <button
                type="button"
                className="flex items-center gap-3 rounded-[12px] border border-[#e1e7f1] bg-white px-3 py-2 transition hover:bg-[#f8fbff]"
                onClick={() => setIsProfileOpen((value) => !value)}
              >
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[#0b2a88] text-sm font-semibold text-white">
                  {initials || "SA"}
                </div>
                <div className="hidden text-left lg:block">
                  <p className="text-sm font-semibold text-[#122447]">{roleLabel}</p>
                  <p className="text-xs text-[#8a9ab4]">{workspaceLabel}</p>
                </div>
                <svg viewBox="0 0 24 24" className="hidden h-4 w-4 text-[#8a98ad] lg:block" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </button>

              {isProfileOpen ? (
                <div className="absolute right-0 z-40 mt-3 w-56 rounded-[16px] border border-[#dbe4f2] bg-white p-2 shadow-[0_20px_40px_rgba(20,49,106,0.14)]">
                  <div className="border-b border-[#edf2fb] px-3 py-2">
                    <p className="truncate text-sm font-semibold text-[#122447]">{displayName}</p>
                    <p className="text-xs text-[#8a9ab4]">{workspaceLabel}</p>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setIsProfileOpen(false)}
                    className="mt-2 flex items-center rounded-xl px-3 py-2 text-sm font-medium text-[#1a3561] hover:bg-[#f3f7ff]"
                  >
                    Profile
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center rounded-xl px-3 py-2 text-sm font-medium text-[#1a3561] hover:bg-[#f3f7ff]"
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium text-[#b42318] hover:bg-[#fff1f1]"
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
