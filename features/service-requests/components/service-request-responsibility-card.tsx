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
      <div className="crm-detail-item">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[#7a8cad]">{label}</p>
        <p className="mt-3 text-sm text-[var(--muted)]">Unassigned</p>
      </div>
    );
  }

  const name = displayName(assignment.user);
  return (
    <div className="crm-detail-item text-sm">
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[#7a8cad]">{label}</p>
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
  const hasAnyAssignment = Boolean(snapshot.PM || snapshot.SM || snapshot.TECHNICIAN);

  return (
    <div className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>Responsibility</h2>
          <p>Primary ownership stays mapped through project manager, service manager, and technician roles.</p>
        </div>
      </div>
      {!hasAnyAssignment ? <p className="mb-3 text-sm text-[var(--muted)]">No responsibility assigned yet.</p> : null}
      <div className="crm-detail-grid md:grid-cols-3">
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
