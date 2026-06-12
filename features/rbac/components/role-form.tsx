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
    <form action={action} className="crm-form-shell space-y-5">
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="crm-form-section space-y-4">
        <div>
          <h3 className="crm-form-section-title">Role Profile</h3>
          <p className="crm-form-section-copy">Define the role label, scope, hierarchy level, and tenant ownership.</p>
        </div>
        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Role name</span>
            <input
              name="name"
              defaultValue={role?.name ?? ""}
              maxLength={120}
              className="crm-input"
              required
            />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Role key</span>
            <input
              name="key"
              defaultValue={role?.key ?? ""}
              maxLength={50}
              className="crm-input"
              placeholder="tenant_manager"
              required
              disabled={Boolean(role?.isSystem)}
            />
            {role?.isSystem ? <input type="hidden" name="key" value={role.key} /> : null}
            <p className="crm-field-note">Use a stable machine-friendly key. Protected system roles keep their existing key.</p>
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Scope</span>
            <select name="scope" defaultValue={selectedScope} disabled={!canChooseScope} className="crm-select">
              <option value={RoleScope.TENANT}>TENANT</option>
              <option value={RoleScope.PLATFORM}>PLATFORM</option>
            </select>
            {!canChooseScope ? <input type="hidden" name="scope" value={selectedScope} /> : null}
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Role level</span>
            <input type="number" name="level" defaultValue={role?.level ?? 0} min={0} max={1000} className="crm-input" required />
            <p className="crm-field-note">Lower levels should not outrank protected admin roles in the hierarchy.</p>
          </label>
          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Description</span>
            <textarea name="description" defaultValue={role?.description ?? ""} maxLength={300} className="crm-textarea" />
          </label>
          <label className="crm-field md:col-span-2">
            <span className="crm-field-label">Service partner</span>
            <select name="servicePartnerId" defaultValue={selectedServicePartnerId} disabled={!canChooseServicePartner} className="crm-select">
              {servicePartners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {getServicePartnerDisplayLabel(partner)}
                </option>
              ))}
            </select>
            {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
          </label>
        </div>
      </div>
      <FormActions cancelHref={cancelHref} submitLabel={role ? "Update role" : "Create role"} />
    </form>
  );
}
