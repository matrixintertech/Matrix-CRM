"use client";

import { RfqVendorStatus, VendorStatus } from "@prisma/client";
import { useMemo, useState } from "react";

type VendorOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
  status: VendorStatus;
  isVerified: boolean;
};

type VendorState = {
  vendorId: string;
  status: RfqVendorStatus;
  quotedAmount: string;
  notes: string;
};

type RfqVendorsFormProps = {
  vendorOptions: VendorOption[];
  initialVendors?: Array<{
    vendorId: string;
    status: RfqVendorStatus;
    quotedAmount?: string | null;
    notes?: string | null;
  }>;
};

function getDefaultVendor(vendor: VendorOption | undefined): VendorState {
  return {
    vendorId: vendor?.id ?? "",
    status: RfqVendorStatus.INVITED,
    quotedAmount: "",
    notes: "",
  };
}

export function RfqVendorsForm({ vendorOptions, initialVendors }: RfqVendorsFormProps) {
  const [vendors, setVendors] = useState<VendorState[]>(
    initialVendors && initialVendors.length > 0
      ? initialVendors.map((vendor) => ({
          vendorId: vendor.vendorId,
          status: vendor.status,
          quotedAmount: vendor.quotedAmount ?? "",
          notes: vendor.notes ?? "",
        }))
      : vendorOptions.length > 0
        ? [getDefaultVendor(vendorOptions[0])]
        : []
  );

  const vendorById = useMemo(() => new Map(vendorOptions.map((vendor) => [vendor.id, vendor])), [vendorOptions]);

  const duplicateVendorIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vendor of vendors) {
      counts.set(vendor.vendorId, (counts.get(vendor.vendorId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter((entry) => entry[1] > 1).map((entry) => entry[0]));
  }, [vendors]);

  function addVendor() {
    setVendors((current) => [...current, getDefaultVendor(vendorOptions[0])]);
  }

  function removeVendor(index: number) {
    setVendors((current) => current.filter((_, vendorIndex) => vendorIndex !== index));
  }

  function updateVendor(index: number, next: Partial<VendorState>) {
    setVendors((current) =>
      current.map((vendor, vendorIndex) => {
        if (vendorIndex !== index) {
          return vendor;
        }
        return {
          ...vendor,
          ...next,
        };
      })
    );
  }

  const vendorsPayload = JSON.stringify(
    vendors.map((vendor) => ({
      vendorId: vendor.vendorId,
      status: vendor.status,
      quotedAmount: vendor.quotedAmount === "" ? undefined : vendor.quotedAmount,
      notes: vendor.notes,
    }))
  );

  return (
    <div className="space-y-3 rounded-md border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">RFQ vendors</h3>
        <button
          type="button"
          onClick={addVendor}
          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium"
          disabled={vendorOptions.length === 0}
        >
          Add vendor
        </button>
      </div>
      {vendorOptions.length === 0 ? <p className="text-sm text-red-700">No vendors available for the selected service partner.</p> : null}
      {vendors.length === 0 ? <p className="text-sm text-[var(--muted)]">No vendors added yet.</p> : null}
      {vendors.map((vendor, index) => {
        const selectedVendor = vendorById.get(vendor.vendorId);
        return (
          <div key={`${vendor.vendorId}-${index}`} className="grid gap-2 rounded-md border border-[var(--border)] p-3 md:grid-cols-12">
            <label className="space-y-1 text-sm md:col-span-4">
              <span className="font-medium">Vendor</span>
              <select
                value={vendor.vendorId}
                onChange={(event) => updateVendor(index, { vendorId: event.target.value })}
                className="h-9 w-full rounded-md border border-[var(--border)] px-3"
              >
                {vendorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.code})
                  </option>
                ))}
              </select>
              {duplicateVendorIds.has(vendor.vendorId) ? <p className="text-xs text-red-700">Duplicate RFQ vendors are not allowed.</p> : null}
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="font-medium">Status</span>
              <select
                value={vendor.status}
                onChange={(event) => updateVendor(index, { status: event.target.value as RfqVendorStatus })}
                className="h-9 w-full rounded-md border border-[var(--border)] px-3"
              >
                {Object.values(RfqVendorStatus).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="font-medium">Quoted Amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={vendor.quotedAmount}
                onChange={(event) => updateVendor(index, { quotedAmount: event.target.value })}
                className="h-9 w-full rounded-md border border-[var(--border)] px-3"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-3">
              <span className="font-medium">Notes</span>
              <input
                value={vendor.notes}
                onChange={(event) => updateVendor(index, { notes: event.target.value })}
                className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                maxLength={600}
              />
            </label>
            <div className="flex items-end md:col-span-1">
              <button type="button" onClick={() => removeVendor(index)} className="h-9 w-full rounded-md border border-red-200 px-2 text-xs text-red-700">
                Remove
              </button>
            </div>
            <div className="md:col-span-12">
              <p className="text-xs text-[var(--muted)]">
                Vendor profile: {selectedVendor?.status ?? "-"} | {selectedVendor?.isVerified ? "Verified" : "Not verified"}
              </p>
            </div>
          </div>
        );
      })}
      <input type="hidden" name="vendorsJson" value={vendorsPayload} />
      <p className="text-xs text-[var(--muted)]">Total vendors: {vendors.length}</p>
    </div>
  );
}
