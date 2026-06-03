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
  if (pathname === "/") {
    return [{ label: "Dashboard" }];
  }

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
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const workspaceLabel = session.user.isSuperAdmin ? "Platform workspace" : "Tenant workspace";
  const breadcrumbs = useMemo(() => buildBreadcrumbs(pathname, navigationItems), [navigationItems, pathname]);

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
    <header className="sticky top-0 z-20 border-b border-[#e3eaf6] bg-white/90 backdrop-blur">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              aria-label="Toggle sidebar"
              onClick={onToggleSidebar}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde6f6] text-[#3f5378] transition hover:bg-[#f6f9ff] lg:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <button
              type="button"
              aria-label="Collapse or expand sidebar"
              onClick={onToggleSidebar}
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#dde6f6] text-[#3f5378] transition hover:bg-[#f6f9ff] lg:flex"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="min-w-0 space-y-2">
              <Breadcrumb items={breadcrumbs} />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold text-[#0f2347] sm:text-xl">
                  {breadcrumbs[breadcrumbs.length - 1]?.label ?? "Dashboard"}
                </h2>
                <span className="rounded-full border border-[#dbe5f4] bg-[#f7faff] px-2.5 py-1 text-xs font-medium text-[#59709c]">
                  {workspaceLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              href="/notifications"
              aria-label="Notifications"
              className="grid h-10 w-10 place-items-center rounded-xl border border-[#dde6f6] text-[#213a64] transition hover:bg-[#f6f9ff]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 8a6 6 0 0 1 12 0v4.4l1.3 2.4a1 1 0 0 1-.9 1.5H5.6a1 1 0 0 1-.9-1.5L6 12.4V8Z" />
                <path d="M9.7 18a2.3 2.3 0 0 0 4.6 0" />
              </svg>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="hidden h-10 items-center justify-center rounded-xl border border-[#dbe5f4] bg-[#f7faff] px-4 text-sm font-semibold text-[#214077] transition hover:bg-[#eef4ff] md:inline-flex"
            >
              Logout
            </button>

            <div ref={profileRef} className="relative">
              <button
                type="button"
                className="flex items-center gap-3 rounded-2xl border border-[#dbe5f4] bg-white px-2.5 py-2 transition hover:bg-[#f8fbff]"
                onClick={() => setIsProfileOpen((value) => !value)}
              >
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[#0b2a67] text-sm font-semibold text-white">
                  {initials || "SA"}
                </div>
                <div className="hidden text-left xl:block">
                  <p className="text-sm font-semibold text-[#102341]">{displayName}</p>
                  <p className="text-xs text-[#6d82a9]">{roleLabel}</p>
                </div>
                <svg viewBox="0 0 24 24" className="hidden h-4 w-4 text-[#7a8fb5] xl:block" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </button>

              {isProfileOpen ? (
                <div className="absolute right-0 z-40 mt-3 w-56 rounded-2xl border border-[#dbe4f6] bg-white p-2 shadow-[0_18px_40px_rgba(20,49,106,0.15)]">
                  <Link
                    href="/profile"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[#1a3561] hover:bg-[#f3f7ff]"
                  >
                    Profile
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[#1a3561] hover:bg-[#f3f7ff]"
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-[#b42318] hover:bg-[#fff1f1] md:hidden"
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
