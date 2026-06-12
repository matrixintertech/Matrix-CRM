"use client";

import { useEffect, useState } from "react";

import type { Session } from "next-auth";

import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import type { SidebarNavItem } from "@/features/navigation/services/navigation.service";

type AppShellProps = {
  children: React.ReactNode;
  navigationItems: SidebarNavItem[];
  session: Session;
};

export function AppShell({ children, navigationItems, session }: AppShellProps) {
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const syncViewport = () => {
      const desktop = window.innerWidth >= 1280;
      setIsDesktopViewport(desktop);
      setIsSidebarOpen((current) => (desktop ? true : current && window.innerWidth >= 768));
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  const handleSidebarNavigate = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f6f8fc] text-[#0f2447]">
      {!isDesktopViewport && isSidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-[#061a42]/45 xl:hidden"
        />
      ) : null}

      <Sidebar items={navigationItems} isOpen={isSidebarOpen} onNavigate={handleSidebarNavigate} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header
          session={session}
          navigationItems={navigationItems}
          onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
        />
        <main className="min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-6 xl:px-7 xl:py-5">
          <div className="mx-auto flex min-w-0 w-full max-w-[1660px] flex-col">{children}</div>
        </main>
      </div>
    </div>
  );
}
