import { RoleScope } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type RoleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  canChooseServicePartner: boolean;
  canChooseScope: boolean;
  errorMessage?: string;
  role?: {
    name: string;
    key: string;
    description: string | null;
    scope: RoleScope;
    level: number;
    servicePartnerId: string;
    isSystem: boolean;
  };
};

export function RoleForm({
  action,
  cancelHref,
  servicePartners,
  canChooseServicePartner,
  canChooseScope,
  errorMessage,
  role,
}: RoleFormProps) {
  const selectedServicePartnerId = role?.servicePartnerId ?? servicePartners[0]?.id ?? "";
  const selectedScope = role?.scope ?? RoleScope.TENANT;

  return (
    <form action={action} className="space-y-5 rounded-md border border-[var(--border)] bg-white p-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Role name</span>
          <input
            name="name"
            defaultValue={role?.name ?? ""}
            maxLength={120}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Role key</span>
          <input
            name="key"
            defaultValue={role?.key ?? ""}
            maxLength={50}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            placeholder="tenant_manager"
            required
            disabled={Boolean(role?.isSystem)}
          />
          {role?.isSystem ? <input type="hidden" name="key" value={role.key} /> : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Scope</span>
          <select
            name="scope"
            defaultValue={selectedScope}
            disabled={!canChooseScope}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 disabled:bg-slate-50"
          >
            <option value={RoleScope.TENANT}>TENANT</option>
            <option value={RoleScope.PLATFORM}>PLATFORM</option>
          </select>
          {!canChooseScope ? <input type="hidden" name="scope" value={selectedScope} /> : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Role level</span>
          <input
            type="number"
            name="level"
            defaultValue={role?.level ?? 0}
            min={0}
            max={1000}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <textarea
            name="description"
            defaultValue={role?.description ?? ""}
            maxLength={300}
            className="min-h-24 w-full rounded-md border border-[var(--border)] px-3 py-2"
          />
        </label>
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
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={role ? "Update role" : "Create role"} />
    </form>
  );
}
