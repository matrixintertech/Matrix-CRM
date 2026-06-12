"use client";

import { PaymentStatus, PurchaseOrderStatus, VendorStatus } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";

import { FormActions } from "@/components/admin/form-actions";
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
  serviceRequestId: string | null;
  status: PurchaseOrderStatus;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
};

type VendorPaymentFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  vendors: VendorOption[];
  purchaseOrders: PurchaseOrderOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  defaultPurchaseOrderId?: string;
  vendorPayment?: {
    servicePartnerId: string;
    vendorId: string;
    purchaseOrderId: string | null;
    status: PaymentStatus;
    paymentDate: string | null;
    amount: string;
    notes: string | null;
  };
};

function todayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

export function VendorPaymentForm({
  action,
  cancelHref,
  servicePartners,
  vendors,
  purchaseOrders,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  defaultPurchaseOrderId,
  vendorPayment,
}: VendorPaymentFormProps) {
  const initialServicePartnerId = vendorPayment?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const [selectedServicePartnerId, setSelectedServicePartnerId] = useState(initialServicePartnerId);
  const [selectedVendorId, setSelectedVendorId] = useState(vendorPayment?.vendorId ?? "");
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState(vendorPayment?.purchaseOrderId ?? defaultPurchaseOrderId ?? "");

  const filteredVendors = useMemo(
    () => vendors.filter((vendor) => vendor.servicePartnerId === selectedServicePartnerId),
    [vendors, selectedServicePartnerId]
  );
  const filteredPurchaseOrders = useMemo(
    () => purchaseOrders.filter((purchaseOrder) => purchaseOrder.servicePartnerId === selectedServicePartnerId),
    [purchaseOrders, selectedServicePartnerId]
  );
  const selectedPurchaseOrder = useMemo(
    () => filteredPurchaseOrders.find((purchaseOrder) => purchaseOrder.id === selectedPurchaseOrderId),
    [filteredPurchaseOrders, selectedPurchaseOrderId]
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
    if (!selectedPurchaseOrder) {
      return;
    }
    if (selectedVendorId !== selectedPurchaseOrder.vendorId) {
      setSelectedVendorId(selectedPurchaseOrder.vendorId);
    }
  }, [selectedPurchaseOrder, selectedVendorId]);

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
          <span className="font-medium">Vendor</span>
          <select
            name="vendorId"
            value={selectedVendorId}
            onChange={(event) => setSelectedVendorId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          >
            <option value="">Select vendor</option>
            {filteredVendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name} ({vendor.code})
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={vendorPayment?.status ?? PaymentStatus.PAID}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(PaymentStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Payment Date</span>
          <input
            type="date"
            name="paymentDate"
            defaultValue={vendorPayment?.paymentDate ?? todayDateInput()}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={vendorPayment?.amount ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
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
                {purchaseOrder.poNumber} ({purchaseOrder.vendor.name} | {purchaseOrder.status})
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Notes</span>
          <textarea
            name="notes"
            defaultValue={vendorPayment?.notes ?? ""}
            className="min-h-24 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={1200}
          />
        </label>
      </div>

      <p className="text-xs text-[var(--muted)]">Payment mode and reference number are not persisted because the existing vendor payment schema does not include those fields.</p>

      <FormActions cancelHref={cancelHref} submitLabel={vendorPayment ? "Update Vendor Payment" : "Record Vendor Payment"} />
    </form>
  );
}
