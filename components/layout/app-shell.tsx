"use client";

import { useState } from "react";

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleSidebarNavigate = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f4f7fb] text-[#0f2447]">
      {isSidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-20 bg-black/35 lg:hidden"
        />
      ) : null}

      <Sidebar items={navigationItems} isOpen={isSidebarOpen} onNavigate={handleSidebarNavigate} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header
          session={session}
          navigationItems={navigationItems}
          onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
        />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
