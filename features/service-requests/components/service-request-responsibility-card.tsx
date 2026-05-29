import { formatDateTime } from "@/lib/utils/format";
import type {
  ResponsibilityCandidate,
  ResponsibilitySnapshot,
} from "@/features/service-requests/services/service-request-responsibility.service";
import { ServiceRequestResponsibilityForm } from "@/features/service-requests/components/service-request-responsibility-form";

type ServiceRequestResponsibilityCardProps = {
  serviceRequestId: string;
  snapshot: ResponsibilitySnapshot;
  candidates: ResponsibilityCandidate[];
  canUpdate: boolean;
};

function initials(value: string) {
  const parts = value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "U";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function displayName(input: { name: string | null; email: string | null; phone: string | null }) {
  return input.name?.trim() || input.email || input.phone || "Unassigned";
}

function ResponsibilityRow({
  label,
  assignment,
}: {
  label: string;
  assignment: ResponsibilitySnapshot[keyof ResponsibilitySnapshot];
}) {
  if (!assignment) {
    return (
      <div className="rounded-md border border-[var(--border)] p-3 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <p className="mt-2 text-[var(--muted)]">Unassigned</p>
      </div>
    );
  }

  const name = displayName(assignment.user);
  return (
    <div className="rounded-md border border-[var(--border)] p-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
          {initials(name)}
        </div>
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-xs text-[var(--muted)]">{assignment.user.roleLabel}</p>
          <p className="text-xs text-[var(--muted)]">Assigned: {formatDateTime(assignment.assignedAt)}</p>
        </div>
      </div>
    </div>
  );
}

export function ServiceRequestResponsibilityCard({
  serviceRequestId,
  snapshot,
  candidates,
  canUpdate,
}: ServiceRequestResponsibilityCardProps) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-5">
      <h2 className="mb-3 text-base font-semibold">Responsibility</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <ResponsibilityRow label="Project Manager" assignment={snapshot.PM} />
        <ResponsibilityRow label="Service Manager" assignment={snapshot.SM} />
        <ResponsibilityRow label="Technician" assignment={snapshot.TECHNICIAN} />
      </div>

      {canUpdate ? (
        <div className="mt-4">
          <ServiceRequestResponsibilityForm
            serviceRequestId={serviceRequestId}
            candidates={candidates}
            snapshot={snapshot}
          />
        </div>
      ) : null}
    </div>
  );
}
