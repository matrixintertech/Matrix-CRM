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
    <form action={updateServiceRequestResponsibilitiesAction.bind(null, serviceRequestId)} className="crm-form-section space-y-3">
      <input type="hidden" name="redirectTo" value={`/service-requests/${serviceRequestId}`} />

      <label className="crm-field">
        <span className="crm-field-label">Project Manager</span>
        <select name="pmUserId" defaultValue={snapshot.PM?.user.id ?? ""} className="crm-select">
          <option value="">Unassigned</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)} - {candidate.roleLabel}
            </option>
          ))}
        </select>
      </label>

      <label className="crm-field">
        <span className="crm-field-label">Service Manager</span>
        <select name="smUserId" defaultValue={snapshot.SM?.user.id ?? ""} className="crm-select">
          <option value="">Unassigned</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)} - {candidate.roleLabel}
            </option>
          ))}
        </select>
      </label>

      <label className="crm-field">
        <span className="crm-field-label">Technician</span>
        <select name="technicianUserId" defaultValue={snapshot.TECHNICIAN?.user.id ?? ""} className="crm-select">
          <option value="">Unassigned</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidateLabel(candidate)} - {candidate.roleLabel}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="crm-button w-full sm:w-auto">
        Save responsibility
      </button>
    </form>
  );
}
