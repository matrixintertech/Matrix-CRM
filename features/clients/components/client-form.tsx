import { ClientStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type ClientFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  client?: {
    servicePartnerId: string;
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
    status: ClientStatus;
  };
};

export function ClientForm({
  action,
  cancelHref,
  servicePartners,
  canChooseServicePartner,
  errorMessage,
  client,
}: ClientFormProps) {
  const selectedServicePartnerId = client?.servicePartnerId ?? servicePartners[0]?.id ?? "";

  return (
    <form action={action} className="space-y-5 rounded-md border border-[var(--border)] bg-white p-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Service partner</span>
          <select
            name="servicePartnerId"
            defaultValue={selectedServicePartnerId}
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
          <span className="font-medium">Code</span>
          <input
            name="code"
            defaultValue={client?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={client?.status ?? ClientStatus.ACTIVE}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(ClientStatus).map((status) => (
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
            defaultValue={client?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Legal name</span>
          <input
            name="legalName"
            defaultValue={client?.legalName ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={client?.email ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Phone</span>
          <input
            name="phone"
            defaultValue={client?.phone ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={30}
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Address</span>
          <textarea
            name="address"
            defaultValue={client?.address ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={300}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">City</span>
          <input
            name="city"
            defaultValue={client?.city ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">State</span>
          <input
            name="state"
            defaultValue={client?.state ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Country</span>
          <input
            name="country"
            defaultValue={client?.country ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Postal code</span>
          <input
            name="postalCode"
            defaultValue={client?.postalCode ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={20}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={client ? "Update client" : "Create client"} />
    </form>
  );
}
