"use client";

import { RfqStatus, RfqVendorStatus, VendorStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
import { RfqLinesForm } from "@/features/rfqs/components/rfq-lines-form";
import { RfqVendorsForm } from "@/features/rfqs/components/rfq-vendors-form";

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

type ServiceRequestOption = {
  id: string;
  serviceNumber: string;
  title: string;
  servicePartnerId: string;
  clientId: string;
};

type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  active: boolean;
  servicePartnerId: string;
};

type VendorOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
  status: VendorStatus;
  isVerified: boolean;
};

type RfqFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  clients: ClientOption[];
  serviceRequests: ServiceRequestOption[];
  items: ItemOption[];
  vendors: VendorOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  rfq?: {
    servicePartnerId: string;
    clientId: string | null;
    serviceRequestId: string | null;
    title: string;
    description: string | null;
    status: RfqStatus;
    dueDate: string | null;
    lines: Array<{
      itemId: string;
      description: string | null;
      quantity: string;
      specs: string | null;
      remarks: string | null;
    }>;
    vendorQuotes: Array<{
      vendorId: string;
      status: RfqVendorStatus;
      quotedAmount: string | null;
      notes: string | null;
    }>;
  };
};

export function RfqForm({
  action,
  cancelHref,
  servicePartners,
  clients,
  serviceRequests,
  items,
  vendors,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  rfq,
}: RfqFormProps) {
  const initialServicePartnerId = rfq?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);

  const filteredClients = useMemo(
    () => clients.filter((client) => client.servicePartnerId === selectedServicePartnerId),
    [clients, selectedServicePartnerId]
  );
  const filteredServiceRequests = useMemo(
    () => serviceRequests.filter((request) => request.servicePartnerId === selectedServicePartnerId),
    [serviceRequests, selectedServicePartnerId]
  );
  const filteredItems = useMemo(() => items.filter((item) => item.servicePartnerId === selectedServicePartnerId), [items, selectedServicePartnerId]);
  const filteredVendors = useMemo(() => vendors.filter((vendor) => vendor.servicePartnerId === selectedServicePartnerId), [vendors, selectedServicePartnerId]);

  const [selectedClientId, setSelectedClientId] = useState(rfq?.clientId ?? "");
  const [selectedServiceRequestId, setSelectedServiceRequestId] = useState(rfq?.serviceRequestId ?? "");

  useEffect(() => {
    if (selectedClientId && !filteredClients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId("");
    }
  }, [filteredClients, selectedClientId]);

  useEffect(() => {
    if (selectedServiceRequestId && !filteredServiceRequests.some((request) => request.id === selectedServiceRequestId)) {
      setSelectedServiceRequestId("");
    }
  }, [filteredServiceRequests, selectedServiceRequestId]);

  const filteredInitialLines = useMemo(
    () => rfq?.lines.filter((line) => filteredItems.some((item) => item.id === line.itemId)),
    [rfq?.lines, filteredItems]
  );
  const filteredInitialVendors = useMemo(
    () => rfq?.vendorQuotes.filter((quote) => filteredVendors.some((vendor) => vendor.id === quote.vendorId)),
    [rfq?.vendorQuotes, filteredVendors]
  );

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
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select name="status" defaultValue={rfq?.status ?? RfqStatus.DRAFT} className="h-9 w-full rounded-md border border-[var(--border)] px-3">
            {Object.values(RfqStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Due date</span>
          <input
            type="date"
            name="dueDate"
            defaultValue={rfq?.dueDate ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Title</span>
          <input
            name="title"
            defaultValue={rfq?.title ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea
            name="description"
            defaultValue={rfq?.description ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={1200}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Client (optional)</span>
          <select
            name="clientId"
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">No client selected</option>
            {filteredClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.code})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Service request (optional)</span>
          <select
            name="serviceRequestId"
            value={selectedServiceRequestId}
            onChange={(event) => setSelectedServiceRequestId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">No service request selected</option>
            {filteredServiceRequests.map((serviceRequest) => (
              <option key={serviceRequest.id} value={serviceRequest.id}>
                {serviceRequest.serviceNumber} - {serviceRequest.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <RfqLinesForm key={`${selectedServicePartnerId}-lines`} itemOptions={filteredItems} initialLines={filteredInitialLines} />
      <RfqVendorsForm
        key={`${selectedServicePartnerId}-vendors`}
        vendorOptions={filteredVendors}
        initialVendors={filteredInitialVendors}
      />

      <FormActions cancelHref={cancelHref} submitLabel={rfq ? "Update RFQ" : "Create RFQ"} />
    </form>
  );
}
