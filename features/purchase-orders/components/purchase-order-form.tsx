"use client";

import { PurchaseOrderStatus, RfqStatus, VendorStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
import { PurchaseOrderLinesForm } from "@/features/purchase-orders/components/purchase-order-lines-form";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type VendorOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
  status: VendorStatus;
  isVerified: boolean;
};

type RfqOption = {
  id: string;
  rfqNumber: string;
  title: string;
  servicePartnerId: string;
  serviceRequestId: string | null;
  status: RfqStatus;
  vendorQuotes: {
    vendorId: string;
  }[];
};

type ServiceRequestOption = {
  id: string;
  serviceNumber: string;
  title: string;
  servicePartnerId: string;
};

type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  active: boolean;
  servicePartnerId: string;
};

type PurchaseOrderFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  vendors: VendorOption[];
  rfqs: RfqOption[];
  serviceRequests: ServiceRequestOption[];
  items: ItemOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  purchaseOrder?: {
    servicePartnerId: string;
    vendorId: string;
    rfqId: string | null;
    serviceRequestId: string | null;
    status: PurchaseOrderStatus;
    orderDate: string;
    expectedDate: string | null;
    notes: string | null;
    items: Array<{
      itemId: string;
      quantity: string;
      unitRate: string;
      taxPercent?: string | null;
    }>;
  };
};

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

export function PurchaseOrderForm({
  action,
  cancelHref,
  servicePartners,
  vendors,
  rfqs,
  serviceRequests,
  items,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  purchaseOrder,
}: PurchaseOrderFormProps) {
  const initialServicePartnerId = purchaseOrder?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);
  const [selectedVendorId, setSelectedVendorId] = useState(purchaseOrder?.vendorId ?? "");
  const [selectedRfqId, setSelectedRfqId] = useState(purchaseOrder?.rfqId ?? "");
  const [selectedServiceRequestId, setSelectedServiceRequestId] = useState(purchaseOrder?.serviceRequestId ?? "");

  const filteredVendors = useMemo(
    () => vendors.filter((vendor) => vendor.servicePartnerId === selectedServicePartnerId),
    [vendors, selectedServicePartnerId]
  );
  const filteredRfqs = useMemo(
    () => rfqs.filter((rfq) => rfq.servicePartnerId === selectedServicePartnerId),
    [rfqs, selectedServicePartnerId]
  );
  const filteredServiceRequests = useMemo(
    () => serviceRequests.filter((serviceRequest) => serviceRequest.servicePartnerId === selectedServicePartnerId),
    [serviceRequests, selectedServicePartnerId]
  );
  const filteredItems = useMemo(
    () => items.filter((item) => item.servicePartnerId === selectedServicePartnerId),
    [items, selectedServicePartnerId]
  );

  useEffect(() => {
    if (!selectedVendorId || filteredVendors.some((vendor) => vendor.id === selectedVendorId)) {
      return;
    }
    setSelectedVendorId("");
  }, [filteredVendors, selectedVendorId]);

  useEffect(() => {
    if (!selectedRfqId || filteredRfqs.some((rfq) => rfq.id === selectedRfqId)) {
      return;
    }
    setSelectedRfqId("");
  }, [filteredRfqs, selectedRfqId]);

  useEffect(() => {
    if (!selectedServiceRequestId || filteredServiceRequests.some((request) => request.id === selectedServiceRequestId)) {
      return;
    }
    setSelectedServiceRequestId("");
  }, [filteredServiceRequests, selectedServiceRequestId]);

  const selectedRfq = useMemo(() => filteredRfqs.find((rfq) => rfq.id === selectedRfqId), [filteredRfqs, selectedRfqId]);

  useEffect(() => {
    if (!selectedRfq) {
      return;
    }

    if (selectedRfq.serviceRequestId && selectedServiceRequestId !== selectedRfq.serviceRequestId) {
      setSelectedServiceRequestId(selectedRfq.serviceRequestId);
    }

    const rfqVendorIds = new Set(selectedRfq.vendorQuotes.map((quote) => quote.vendorId));
    if (rfqVendorIds.size > 0 && selectedVendorId && !rfqVendorIds.has(selectedVendorId)) {
      setSelectedVendorId("");
    }
  }, [selectedRfq, selectedServiceRequestId, selectedVendorId]);

  const vendorOptionsForSelectedRfq = useMemo(() => {
    if (!selectedRfq || selectedRfq.vendorQuotes.length === 0) {
      return filteredVendors;
    }

    const rfqVendorIds = new Set(selectedRfq.vendorQuotes.map((quote) => quote.vendorId));
    return filteredVendors.filter((vendor) => rfqVendorIds.has(vendor.id));
  }, [filteredVendors, selectedRfq]);

  const filteredInitialLines = useMemo(
    () => purchaseOrder?.items.filter((line) => filteredItems.some((item) => item.id === line.itemId)),
    [purchaseOrder?.items, filteredItems]
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
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={purchaseOrder?.status ?? PurchaseOrderStatus.DRAFT}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(PurchaseOrderStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Vendor</span>
          <select
            name="vendorId"
            value={selectedVendorId}
            onChange={(event) => setSelectedVendorId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          >
            <option value="">Select vendor</option>
            {vendorOptionsForSelectedRfq.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name} ({vendor.code})
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Order Date</span>
          <input
            type="date"
            name="orderDate"
            defaultValue={purchaseOrder?.orderDate ?? todayDateInput()}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Expected Date</span>
          <input
            type="date"
            name="expectedDate"
            defaultValue={purchaseOrder?.expectedDate ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">RFQ (optional)</span>
          <select
            name="rfqId"
            value={selectedRfqId}
            onChange={(event) => setSelectedRfqId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">No RFQ selected</option>
            {filteredRfqs.map((rfq) => (
              <option key={rfq.id} value={rfq.id}>
                {rfq.rfqNumber} - {rfq.title}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Service Request (optional)</span>
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

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Notes</span>
          <textarea
            name="notes"
            defaultValue={purchaseOrder?.notes ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={1200}
          />
        </label>
      </div>

      <PurchaseOrderLinesForm key={`${selectedServicePartnerId}-po-lines`} itemOptions={filteredItems} initialLines={filteredInitialLines} />
      <FormActions cancelHref={cancelHref} submitLabel={purchaseOrder ? "Update PO" : "Create PO"} />
    </form>
  );
}
