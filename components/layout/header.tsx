import type { Session } from "next-auth";

import { Breadcrumb } from "@/components/layout/breadcrumb";

export function Header({ session }: { session: Session }) {
  const displayName = session.user.name ?? session.user.email ?? session.user.phone ?? "User";

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-white px-6 py-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Matrix CRM v2</h1>
        <Breadcrumb items={[{ label: "Dashboard" }]} />
      </div>
      <div className="text-right text-sm">
        <p className="font-medium text-slate-800">{displayName}</p>
        <p className="text-xs text-[var(--muted)]">{session.user.isSuperAdmin ? "Super admin" : "Tenant user"}</p>
      </div>
    </header>
  );
}
