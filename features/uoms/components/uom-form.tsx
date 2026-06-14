"use client";

import { FormActions } from "@/components/admin/form-actions";
import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type UomFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  redirectTo?: string;
  servicePartners: ServicePartnerOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string | null;
};

export function UomForm({
  action,
  cancelHref,
  redirectTo,
  servicePartners,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
}: UomFormProps) {
  const servicePartnerId = defaultServicePartnerId ?? "";

  return (
    <form action={action} className="crm-form-shell space-y-5">
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
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
            {canChooseServicePartner ? <option value="">Select a service partner</option> : null}
            {canChooseServicePartner ? <option value={ALL_SERVICE_PARTNERS_OPTION}>All Partners</option> : null}
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={servicePartnerId} /> : null}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input name="code" className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase" maxLength={20} required />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Symbol</span>
          <input name="symbol" className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase" maxLength={20} required />
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Name</span>
          <input name="name" className="h-9 w-full rounded-md border border-[var(--border)] px-3" maxLength={80} required />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select name="active" defaultValue="true" className="h-9 w-full rounded-md border border-[var(--border)] px-3">
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>

        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea name="description" className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2" maxLength={300} />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel="Create UOM" />
    </form>
  );
}
