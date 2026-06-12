"use client";

import { VendorStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type VendorFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  vendor?: {
    servicePartnerId: string;
    code: string;
    name: string;
    email: string | null;
    phone: string | null;
    status: VendorStatus;
    isVerified: boolean;
    gstNumber: string | null;
    panNumber: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
    vendorType: string | null;
  };
};

export function VendorForm({
  action,
  cancelHref,
  servicePartners,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  vendor,
}: VendorFormProps) {
  const servicePartnerId = vendor?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";

  return (
    <form action={action} className="crm-form-shell space-y-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Service partner</span>
          <select
            name="servicePartnerId"
            defaultValue={servicePartnerId}
            disabled={!canChooseServicePartner}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 disabled:bg-slate-50"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={servicePartnerId} /> : null}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Vendor code</span>
          <input
            name="code"
            defaultValue={vendor?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Vendor type</span>
          <input
            name="vendorType"
            defaultValue={vendor?.vendorType ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
            placeholder="OEM / Distributor / Service vendor"
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Vendor name</span>
          <input
            name="name"
            defaultValue={vendor?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            type="email"
            name="email"
            defaultValue={vendor?.email ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Phone</span>
          <input
            name="phone"
            defaultValue={vendor?.phone ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={30}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">GST Number</span>
          <input
            name="gstNumber"
            defaultValue={vendor?.gstNumber ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">PAN Number</span>
          <input
            name="panNumber"
            defaultValue={vendor?.panNumber ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={30}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select name="status" defaultValue={vendor?.status ?? VendorStatus.PENDING_VERIFICATION} className="h-9 w-full rounded-md border border-[var(--border)] px-3">
            {Object.values(VendorStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Verification</span>
          <select name="isVerified" defaultValue={String(vendor?.isVerified ?? false)} className="h-9 w-full rounded-md border border-[var(--border)] px-3">
            <option value="false">Not verified</option>
            <option value="true">Verified</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">City</span>
          <input name="city" defaultValue={vendor?.city ?? ""} className="h-9 w-full rounded-md border border-[var(--border)] px-3" maxLength={80} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">State</span>
          <input name="state" defaultValue={vendor?.state ?? ""} className="h-9 w-full rounded-md border border-[var(--border)] px-3" maxLength={80} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Country</span>
          <input name="country" defaultValue={vendor?.country ?? ""} className="h-9 w-full rounded-md border border-[var(--border)] px-3" maxLength={80} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Postal code</span>
          <input
            name="postalCode"
            defaultValue={vendor?.postalCode ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={20}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Address</span>
          <textarea
            name="address"
            defaultValue={vendor?.address ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={600}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={vendor ? "Update vendor" : "Create vendor"} />
    </form>
  );
}
