import { AppShell } from "@/components/layout/app-shell";
import { getNavigationForSession } from "@/features/navigation/services/navigation.service";
import { requireAuth } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const navigationItems = await getNavigationForSession(session);

  return (
    <AppShell navigationItems={navigationItems} session={session}>
      {children}
    </AppShell>
  );
}
