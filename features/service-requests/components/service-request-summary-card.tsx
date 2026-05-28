import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type ServiceRequestSummary = {
  id: string;
  serviceNumber: string;
  title: string;
  description: string | null;
  serviceType: string;
  status: string;
  requestedAt: Date | null;
  targetDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
  client: {
    id: string;
    code: string;
    name: string;
  };
  branch: {
    id: string;
    code: string;
    name: string;
  } | null;
};

export function ServiceRequestSummaryCard({ serviceRequest }: { serviceRequest: ServiceRequestSummary }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-5">
      <h2 className="mb-4 text-base font-semibold">Summary</h2>
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Service number</dt>
          <dd>{serviceRequest.serviceNumber}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Status</dt>
          <dd>
            <StatusBadge value={serviceRequest.status} />
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Service type</dt>
          <dd>{serviceRequest.serviceType}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Service partner</dt>
          <dd>
            {serviceRequest.servicePartner.name} ({serviceRequest.servicePartner.code})
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Client</dt>
          <dd>
            <Link href={`/clients/${serviceRequest.client.id}`} className="underline">
              {serviceRequest.client.name} ({serviceRequest.client.code})
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Branch</dt>
          <dd>
            {serviceRequest.branch ? (
              <Link href={`/branches/${serviceRequest.branch.id}`} className="underline">
                {serviceRequest.branch.name} ({serviceRequest.branch.code})
              </Link>
            ) : (
              "-"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Requested at</dt>
          <dd>{formatDateTime(serviceRequest.requestedAt)}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Target date</dt>
          <dd>{formatDateTime(serviceRequest.targetDate)}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Completed at</dt>
          <dd>{formatDateTime(serviceRequest.completedAt)}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Created</dt>
          <dd>{formatDateTime(serviceRequest.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Updated</dt>
          <dd>{formatDateTime(serviceRequest.updatedAt)}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-[var(--muted)]">Description</dt>
          <dd>{formatOptional(serviceRequest.description)}</dd>
        </div>
      </dl>
    </div>
  );
}
