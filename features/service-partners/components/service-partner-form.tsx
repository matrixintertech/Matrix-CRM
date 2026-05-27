import { ServicePartnerStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";

type ServicePartnerFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  errorMessage?: string;
  servicePartner?: {
    code: string;
    name: string;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
    status: ServicePartnerStatus;
  };
};

export function ServicePartnerForm({ action, cancelHref, errorMessage, servicePartner }: ServicePartnerFormProps) {
  return (
    <form action={action} className="space-y-5 rounded-md border border-[var(--border)] bg-white p-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input
            name="code"
            defaultValue={servicePartner?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={30}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={servicePartner?.status ?? ServicePartnerStatus.ACTIVE}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(ServicePartnerStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Name</span>
          <input
            name="name"
            defaultValue={servicePartner?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={160}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Legal name</span>
          <input
            name="legalName"
            defaultValue={servicePartner?.legalName ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={160}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={servicePartner?.email ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Phone</span>
          <input
            name="phone"
            defaultValue={servicePartner?.phone ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={30}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Address</span>
          <textarea
            name="address"
            defaultValue={servicePartner?.address ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={300}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">City</span>
          <input name="city" defaultValue={servicePartner?.city ?? ""} className="h-9 w-full rounded-md border border-[var(--border)] px-3" maxLength={80} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">State</span>
          <input
            name="state"
            defaultValue={servicePartner?.state ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Country</span>
          <input
            name="country"
            defaultValue={servicePartner?.country ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Postal code</span>
          <input
            name="postalCode"
            defaultValue={servicePartner?.postalCode ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={20}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={servicePartner ? "Update service partner" : "Create service partner"} />
    </form>
  );
}
