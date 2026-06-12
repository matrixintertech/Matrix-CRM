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
    <div className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>Request Summary</h2>
          <p>Core request context, tenant linkage, schedule, and current processing state.</p>
        </div>
      </div>
      <dl className="crm-detail-grid crm-detail-grid--two">
        <div className="crm-detail-item">
          <dt>Service number</dt>
          <dd>{serviceRequest.serviceNumber}</dd>
        </div>
        <div className="crm-detail-item">
          <dt>Status</dt>
          <dd>
            <StatusBadge value={serviceRequest.status} />
          </dd>
        </div>
        <div className="crm-detail-item">
          <dt>Service type</dt>
          <dd>{serviceRequest.serviceType}</dd>
        </div>
        <div className="crm-detail-item">
          <dt>Service partner</dt>
          <dd>
            {serviceRequest.servicePartner.name} ({serviceRequest.servicePartner.code})
          </dd>
        </div>
        <div className="crm-detail-item">
          <dt>Client</dt>
          <dd>
            <Link href={`/clients/${serviceRequest.client.id}`} className="crm-inline-link">
              {serviceRequest.client.name} ({serviceRequest.client.code})
            </Link>
          </dd>
        </div>
        <div className="crm-detail-item">
          <dt>Branch</dt>
          <dd>
            {serviceRequest.branch ? (
              <Link href={`/branches/${serviceRequest.branch.id}`} className="crm-inline-link">
                {serviceRequest.branch.name} ({serviceRequest.branch.code})
              </Link>
            ) : (
              "-"
            )}
          </dd>
        </div>
        <div className="crm-detail-item">
          <dt>Requested at</dt>
          <dd>{formatDateTime(serviceRequest.requestedAt)}</dd>
        </div>
        <div className="crm-detail-item">
          <dt>Target date</dt>
          <dd>{formatDateTime(serviceRequest.targetDate)}</dd>
        </div>
        <div className="crm-detail-item">
          <dt>Completed at</dt>
          <dd>{formatDateTime(serviceRequest.completedAt)}</dd>
        </div>
        <div className="crm-detail-item">
          <dt>Created</dt>
          <dd>{formatDateTime(serviceRequest.createdAt)}</dd>
        </div>
        <div className="crm-detail-item">
          <dt>Updated</dt>
          <dd>{formatDateTime(serviceRequest.updatedAt)}</dd>
        </div>
        <div className="crm-detail-item crm-detail-item--full">
          <dt>Description</dt>
          <dd>{formatOptional(serviceRequest.description)}</dd>
        </div>
      </dl>
    </div>
  );
}
