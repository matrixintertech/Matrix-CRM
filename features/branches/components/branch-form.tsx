import { FormActions } from "@/components/admin/form-actions";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type ClientOption = {
  id: string;
  code: string;
  name: string;
  servicePartnerId: string;
};

type BranchFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  clients: ClientOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  defaultServicePartnerId?: string;
  defaultClientId?: string;
  branch?: {
    servicePartnerId: string;
    clientId: string;
    code: string;
    name: string;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    postalCode: string | null;
  };
};

export function BranchForm({
  action,
  cancelHref,
  servicePartners,
  clients,
  canChooseServicePartner,
  errorMessage,
  defaultServicePartnerId,
  defaultClientId,
  branch,
}: BranchFormProps) {
  const selectedServicePartnerId = branch?.servicePartnerId ?? defaultServicePartnerId ?? servicePartners[0]?.id ?? "";
  const selectedClientId = branch?.clientId ?? defaultClientId ?? clients[0]?.id ?? "";

  return (
    <form action={action} className="crm-form-shell space-y-5">
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
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Client</span>
          <select
            name="clientId"
            defaultValue={selectedClientId}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.code})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Code</span>
          <input
            name="code"
            defaultValue={branch?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            name="name"
            defaultValue={branch?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Address</span>
          <textarea
            name="address"
            defaultValue={branch?.address ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={300}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">City</span>
          <input
            name="city"
            defaultValue={branch?.city ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">State</span>
          <input
            name="state"
            defaultValue={branch?.state ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Country</span>
          <input
            name="country"
            defaultValue={branch?.country ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={80}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Postal code</span>
          <input
            name="postalCode"
            defaultValue={branch?.postalCode ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={20}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={branch ? "Update branch" : "Create branch"} />
    </form>
  );
}
