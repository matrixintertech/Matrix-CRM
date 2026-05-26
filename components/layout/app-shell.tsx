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
  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar items={navigationItems} />
      <div className="flex min-h-screen flex-1 flex-col">
        <Header session={session} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
