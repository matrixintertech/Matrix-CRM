"use client";

import { ServiceRequestStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";

type ServicePartnerOption = {
  id: string;
  name: string;
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
    <form action={action} className="space-y-5 rounded-md border border-[var(--border)] bg-white p-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Service partner</span>
          <select
            name="servicePartnerId"
            value={selectedServicePartnerId}
            onChange={(event) => setSelectedServicePartnerId(event.target.value)}
            disabled={!canChooseServicePartner}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 disabled:bg-slate-50"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name} ({partner.code})
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Service number (optional)</span>
          <input
            name="serviceNumber"
            defaultValue={serviceRequest?.serviceNumber ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={60}
            placeholder="Auto-generated if left blank"
            readOnly={isEdit}
          />
          {isEdit ? <p className="text-xs text-[var(--muted)]">Service number is fixed after creation.</p> : null}
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Client</span>
          <select
            name="clientId"
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
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

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Branch (optional)</span>
          <select
            name="branchId"
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">No branch</option>
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Title</span>
          <input
            name="title"
            defaultValue={serviceRequest?.title ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={240}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Service type</span>
          <input
            name="serviceType"
            defaultValue={serviceRequest?.serviceType ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={120}
            required
          />
        </label>
        {isEdit ? (
          <input type="hidden" name="status" value={serviceRequest?.status ?? ServiceRequestStatus.RAISED} />
        ) : (
          <label className="space-y-1 text-sm">
            <span className="font-medium">Initial status</span>
            <select
              name="status"
              defaultValue={serviceRequest?.status ?? ServiceRequestStatus.RAISED}
              className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            >
              {editableStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="space-y-1 text-sm">
          <span className="font-medium">Requested at</span>
          <input
            type="date"
            name="requestedAt"
            defaultValue={serviceRequest?.requestedAt ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Target date</span>
          <input
            type="date"
            name="targetDate"
            defaultValue={serviceRequest?.targetDate ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea
            name="description"
            defaultValue={serviceRequest?.description ?? ""}
            className="min-h-24 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={1000}
          />
        </label>
      </div>

      <FormActions cancelHref={cancelHref} submitLabel={serviceRequest ? "Update request" : "Create request"} />
    </form>
  );
}
