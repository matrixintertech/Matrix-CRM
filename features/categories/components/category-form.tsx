import { FormActions } from "@/components/admin/form-actions";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type CategoryFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  canChooseServicePartner: boolean;
  errorMessage?: string;
  category?: {
    servicePartnerId: string;
    code: string;
    name: string;
    description: string | null;
  };
};

export function CategoryForm({
  action,
  cancelHref,
  servicePartners,
  canChooseServicePartner,
  errorMessage,
  category,
}: CategoryFormProps) {
  const selectedServicePartnerId = category?.servicePartnerId ?? servicePartners[0]?.id ?? "";

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
            defaultValue={category?.code ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 uppercase"
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            name="name"
            defaultValue={category?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={180}
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea
            name="description"
            defaultValue={category?.description ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={300}
          />
        </label>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={category ? "Update category" : "Create category"} />
    </form>
  );
}
