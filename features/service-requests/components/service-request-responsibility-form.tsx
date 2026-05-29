import { updateServiceRequestResponsibilitiesAction } from "@/features/service-requests/actions/service-request-responsibility.actions";
import type {
  ResponsibilityCandidate,
  ResponsibilitySnapshot,
} from "@/features/service-requests/services/service-request-responsibility.service";

type ServiceRequestResponsibilityFormProps = {
  serviceRequestId: string;
  candidates: ResponsibilityCandidate[];
  snapshot: ResponsibilitySnapshot;
};

function candidateLabel(candidate: ResponsibilityCandidate) {
  return candidate.name?.trim() || candidate.email || candidate.phone || candidate.id;
}

export function ServiceRequestResponsibilityForm({
  serviceRequestId,
  candidates,
  snapshot,
}: ServiceRequestResponsibilityFormProps) {
  return (
    <form action={updateServiceRequestResponsibilitiesAction.bind(null, serviceRequestId)} className="space-y-3 rounded-md border border-[var(--border)] p-3">
      <input type="hidden" name="redirectTo" value={`/service-requests/${serviceRequestId}`} />

      <label className="space-y-1 text-sm">
        <span className="font-medium">Project Manager</span>
        <select
          name="pmUserId"
          defaultValue={snapshot.PM?.user.id ?? ""}
          className="h-9 w-full rounded-md border border-[var(--border)] px-3"
        >
          <option value="">Unassigned</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)} - {candidate.roleLabel}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium">Service Manager</span>
        <select
          name="smUserId"
          defaultValue={snapshot.SM?.user.id ?? ""}
          className="h-9 w-full rounded-md border border-[var(--border)] px-3"
        >
          <option value="">Unassigned</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)} - {candidate.roleLabel}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium">Technician</span>
        <select
          name="technicianUserId"
          defaultValue={snapshot.TECHNICIAN?.user.id ?? ""}
          className="h-9 w-full rounded-md border border-[var(--border)] px-3"
        >
          <option value="">Unassigned</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)} - {candidate.roleLabel}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium">
        Save responsibility
      </button>
    </form>
  );
}
