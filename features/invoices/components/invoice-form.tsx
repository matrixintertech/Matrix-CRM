"use client";

import { InvoiceStatus, PurchaseOrderStatus, RfqStatus, VendorStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
import { InvoiceLinesForm } from "@/features/invoices/components/invoice-lines-form";
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

type PurchaseOrderOption = {
  id: string;
  poNumber: string;
  servicePartnerId: string;
  vendorId: string;
  rfqId: string | null;
  serviceRequestId: string | null;
  status: PurchaseOrderStatus;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
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

type InvoiceFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  vendors: VendorOption[];
  purchaseOrders: PurchaseOrderOption[];
  rfqs: RfqOption[];
  serviceRequests: ServiceRequestOption[];
  items: ItemOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  defaultPurchaseOrderId?: string;
  invoice?: {
    invoiceNumber: string;
    vendorInvoiceNumber: string;
    servicePartnerId: string;
    vendorId: string;
    purchaseOrderId: string | null;
    rfqId: string | null;
    serviceRequestId: string | null;
    status: InvoiceStatus;
    invoiceDate: string;
    receivedDate: string;
    dueDate: string | null;
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

export function InvoiceForm({
  action,
  cancelHref,
  servicePartners,
  vendors,
  purchaseOrders,
  rfqs,
  serviceRequests,
  items,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  defaultPurchaseOrderId,
  invoice,
}: InvoiceFormProps) {
  const initialServicePartnerId = invoice?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);
  const [selectedVendorId, setSelectedVendorId] = useState(invoice?.vendorId ?? "");
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState(invoice?.purchaseOrderId ?? defaultPurchaseOrderId ?? "");
  const [selectedRfqId, setSelectedRfqId] = useState(invoice?.rfqId ?? "");
  const [selectedServiceRequestId, setSelectedServiceRequestId] = useState(invoice?.serviceRequestId ?? "");

  const filteredVendors = useMemo(
    () => vendors.filter((vendor) => vendor.servicePartnerId === selectedServicePartnerId),
    [vendors, selectedServicePartnerId]
  );
  const filteredPurchaseOrders = useMemo(() => {
    const scopedPurchaseOrders = purchaseOrders.filter((purchaseOrder) => purchaseOrder.servicePartnerId === selectedServicePartnerId);
    if (!selectedVendorId) {
      return scopedPurchaseOrders;
    }

    return scopedPurchaseOrders.filter((purchaseOrder) => purchaseOrder.vendorId === selectedVendorId);
  }, [purchaseOrders, selectedServicePartnerId, selectedVendorId]);
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
    if (!selectedPurchaseOrderId || filteredPurchaseOrders.some((purchaseOrder) => purchaseOrder.id === selectedPurchaseOrderId)) {
      return;
    }
    setSelectedPurchaseOrderId("");
  }, [filteredPurchaseOrders, selectedPurchaseOrderId]);

  useEffect(() => {
    if (!selectedRfqId || filteredRfqs.some((rfq) => rfq.id === selectedRfqId)) {
      return;
    }
    setSelectedRfqId("");
  }, [filteredRfqs, selectedRfqId]);

  useEffect(() => {
    if (!selectedServiceRequestId || filteredServiceRequests.some((serviceRequest) => serviceRequest.id === selectedServiceRequestId)) {
      return;
    }
    setSelectedServiceRequestId("");
  }, [filteredServiceRequests, selectedServiceRequestId]);

  const selectedPurchaseOrder = useMemo(
    () => filteredPurchaseOrders.find((purchaseOrder) => purchaseOrder.id === selectedPurchaseOrderId),
    [filteredPurchaseOrders, selectedPurchaseOrderId]
  );

  useEffect(() => {
    if (!selectedPurchaseOrder) {
      return;
    }

    if (selectedVendorId !== selectedPurchaseOrder.vendorId) {
      setSelectedVendorId(selectedPurchaseOrder.vendorId);
    }

    if (selectedPurchaseOrder.rfqId && selectedRfqId !== selectedPurchaseOrder.rfqId) {
      setSelectedRfqId(selectedPurchaseOrder.rfqId);
    }

    if (selectedPurchaseOrder.serviceRequestId && selectedServiceRequestId !== selectedPurchaseOrder.serviceRequestId) {
      setSelectedServiceRequestId(selectedPurchaseOrder.serviceRequestId);
    }
  }, [selectedPurchaseOrder, selectedRfqId, selectedServiceRequestId, selectedVendorId]);

  const selectedRfq = useMemo(() => filteredRfqs.find((rfq) => rfq.id === selectedRfqId), [filteredRfqs, selectedRfqId]);
  const vendorOptionsForSelectedRfq = useMemo(() => {
    if (!selectedRfq || selectedRfq.vendorQuotes.length === 0) {
      return filteredVendors;
    }

    const rfqVendorIds = new Set(selectedRfq.vendorQuotes.map((quote) => quote.vendorId));
    return filteredVendors.filter((vendor) => rfqVendorIds.has(vendor.id));
  }, [filteredVendors, selectedRfq]);

  const filteredInitialLines = useMemo(
    () => invoice?.items.filter((line) => filteredItems.some((item) => item.id === line.itemId)),
    [invoice?.items, filteredItems]
  );

  return (
    <form action={action} className="crm-form-shell space-y-5">
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
            defaultValue={invoice?.status ?? InvoiceStatus.DRAFT}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(InvoiceStatus).map((status) => (
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
          <span className="font-medium">Vendor Invoice No.</span>
          <input
            name="vendorInvoiceNumber"
            defaultValue={invoice?.vendorInvoiceNumber ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={120}
            required
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Internal Record No.</span>
          <input
            value={invoice?.invoiceNumber ?? "Auto-generated on save"}
            className="h-9 w-full rounded-md border border-[var(--border)] bg-slate-50 px-3 text-slate-600"
            readOnly
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Invoice Date</span>
          <input
            type="date"
            name="invoiceDate"
            defaultValue={invoice?.invoiceDate ?? todayDateInput()}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Received Date</span>
          <input
            type="date"
            name="receivedDate"
            defaultValue={invoice?.receivedDate ?? todayDateInput()}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Due Date</span>
          <input
            type="date"
            name="dueDate"
            defaultValue={invoice?.dueDate ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Purchase Order (optional)</span>
          <select
            name="purchaseOrderId"
            value={selectedPurchaseOrderId}
            onChange={(event) => setSelectedPurchaseOrderId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">No purchase order selected</option>
            {filteredPurchaseOrders.map((purchaseOrder) => (
              <option key={purchaseOrder.id} value={purchaseOrder.id}>
                {purchaseOrder.poNumber} ({purchaseOrder.status})
              </option>
            ))}
          </select>
        </label>

        <input type="hidden" name="rfqId" value={selectedRfqId} />

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
          <span className="font-medium">Remarks</span>
          <textarea
            name="notes"
            defaultValue={invoice?.notes ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={1200}
          />
        </label>
      </div>

      <InvoiceLinesForm key={`${selectedServicePartnerId}-invoice-lines`} itemOptions={filteredItems} initialLines={filteredInitialLines} />
      <FormActions cancelHref={cancelHref} submitLabel={invoice ? "Update Received Invoice" : "Record Vendor Invoice"} />
    </form>
  );
}
