"use client";

import { ServiceRequestStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type ClientOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
};

type BranchOption = {
  id: string;
  code: string;
  name: string;
  clientId: string;
  servicePartnerId: string;
};

type ServiceRequestFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  clients: ClientOption[];
  branches: BranchOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  serviceRequest?: {
    servicePartnerId: string;
    serviceNumber: string;
    clientId: string;
    branchId: string | null;
    title: string;
    description: string | null;
    serviceType: string;
    status: ServiceRequestStatus;
    requestedAt: string | null;
    targetDate: string | null;
  };
};

const editableStatuses: ServiceRequestStatus[] = [
  ServiceRequestStatus.DRAFT,
  ServiceRequestStatus.RAISED,
  ServiceRequestStatus.TRIAGED,
  ServiceRequestStatus.PM_ASSIGNED,
  ServiceRequestStatus.SM_ASSIGNED,
  ServiceRequestStatus.QUOTE_PREPARING,
  ServiceRequestStatus.QUOTE_SUBMITTED,
  ServiceRequestStatus.QUOTE_APPROVED,
  ServiceRequestStatus.QUOTE_REJECTED,
  ServiceRequestStatus.IN_PROGRESS,
  ServiceRequestStatus.BLOCKED,
  ServiceRequestStatus.COMPLETED,
  ServiceRequestStatus.CLOSED,
  ServiceRequestStatus.CANCELLED,
];

export function ServiceRequestForm({
  action,
  cancelHref,
  servicePartners,
  clients,
  branches,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  serviceRequest,
}: ServiceRequestFormProps) {
  const isEdit = Boolean(serviceRequest);
  const initialServicePartnerId = serviceRequest?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);

  const clientOptions = useMemo(
    () => clients.filter((client) => client.servicePartnerId === selectedServicePartnerId),
    [clients, selectedServicePartnerId]
  );

  const initialClientId =
    serviceRequest?.clientId ??
    clients.find((client) => client.servicePartnerId === initialServicePartnerId)?.id ??
    "";
  const [selectedClientId, setSelectedClientId] = useState(initialClientId);

  useEffect(() => {
    if (clientOptions.some((client) => client.id === selectedClientId)) {
      return;
    }
    setSelectedClientId(clientOptions[0]?.id ?? "");
  }, [clientOptions, selectedClientId]);

  const branchOptions = useMemo(
    () =>
      branches.filter(
        (branch) => branch.servicePartnerId === selectedServicePartnerId && branch.clientId === selectedClientId
      ),
    [branches, selectedServicePartnerId, selectedClientId]
  );

  const initialBranchId =
    serviceRequest?.branchId ??
    branches.find(
      (branch) => branch.servicePartnerId === initialServicePartnerId && branch.clientId === initialClientId
    )?.id ??
    "";
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);

  useEffect(() => {
    if (selectedBranchId === "") {
      return;
    }

    if (branchOptions.some((branch) => branch.id === selectedBranchId)) {
      return;
    }

    setSelectedBranchId("");
  }, [branchOptions, selectedBranchId]);

  return (
    <form action={action} className="crm-form-shell space-y-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="crm-form-section space-y-4">
        <div>
          <h3 className="crm-form-section-title">Request Context</h3>
          <p className="crm-form-section-copy">Scope the request to the correct company, client, and branch before assigning work.</p>
        </div>
        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Service partner</span>
          <select
            name="servicePartnerId"
            value={selectedServicePartnerId}
            onChange={(event) => setSelectedServicePartnerId(event.target.value)}
            disabled={!canChooseServicePartner}
            className="crm-select"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
        </label>

          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Service number</span>
          <input
            name="serviceNumber"
            defaultValue={serviceRequest?.serviceNumber ?? ""}
            className="crm-input uppercase"
            maxLength={60}
            placeholder="Auto-generated if left blank"
            readOnly={isEdit}
          />
            <p className="crm-field-note">{isEdit ? "Service number is fixed after creation." : "Leave blank to use the existing auto-numbering flow."}</p>
          </label>

          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Client</span>
          <select
            name="clientId"
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            className="crm-select"
            required
          >
            {clientOptions.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.code})
              </option>
            ))}
          </select>
            {clientOptions.length === 0 ? <p className="text-xs text-red-700">No clients available for the selected tenant.</p> : null}
          </label>

          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Branch</span>
          <select
            name="branchId"
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="crm-select"
          >
            <option value="">No branch</option>
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
            <p className="crm-field-note">Keep branch empty only when the request is company-level and not tied to a site.</p>
          </label>
        </div>
      </div>

      <div className="crm-form-section space-y-4">
        <div>
          <h3 className="crm-form-section-title">Request Details</h3>
          <p className="crm-form-section-copy">Capture the subject, service type, scheduling, and request description.</p>
        </div>
        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Title</span>
          <input
            name="title"
            defaultValue={serviceRequest?.title ?? ""}
            className="crm-input"
            maxLength={240}
            required
          />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Service type</span>
          <input
            name="serviceType"
            defaultValue={serviceRequest?.serviceType ?? ""}
            className="crm-input"
            maxLength={120}
            required
          />
          </label>
          {isEdit ? (
            <input type="hidden" name="status" value={serviceRequest?.status ?? ServiceRequestStatus.RAISED} />
          ) : (
            <label className="crm-field">
              <span className="crm-field-label">Initial status</span>
              <select name="status" defaultValue={serviceRequest?.status ?? ServiceRequestStatus.RAISED} className="crm-select">
                {editableStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="crm-field">
            <span className="crm-field-label">Requested at</span>
          <input
            type="date"
            name="requestedAt"
            defaultValue={serviceRequest?.requestedAt ?? ""}
            className="crm-input"
          />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Target date</span>
          <input
            type="date"
            name="targetDate"
            defaultValue={serviceRequest?.targetDate ?? ""}
            className="crm-input"
          />
          </label>
          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Description</span>
          <textarea
            name="description"
            defaultValue={serviceRequest?.description ?? ""}
            className="crm-textarea"
            maxLength={1000}
          />
          </label>
        </div>
      </div>

      <FormActions cancelHref={cancelHref} submitLabel={serviceRequest ? "Update request" : "Create request"} />
    </form>
  );
}
