import { UserStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";

type ServicePartnerOption = {
  id: string;
  name: string;
  code: string;
};

type RoleOption = {
  id: string;
  name: string;
  key: string;
  scope: string;
};

type UserFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  roles?: RoleOption[];
  defaultRoleId?: string;
  hiddenFields?: Record<string, string>;
  errorMessage?: string;
  user?: {
    name: string | null;
    email: string | null;
    phone: string | null;
    status: UserStatus;
    servicePartnerId: string;
  };
  canChooseServicePartner: boolean;
};

export function UserForm({
  action,
  cancelHref,
  servicePartners,
  roles = [],
  defaultRoleId,
  hiddenFields,
  user,
  canChooseServicePartner,
  errorMessage,
}: UserFormProps) {
  const selectedServicePartnerId = user?.servicePartnerId ?? servicePartners[0]?.id ?? "";
  const selectedRoleId = defaultRoleId ?? "";

  return (
    <form action={action} className="space-y-5 rounded-md border border-[var(--border)] bg-white p-5">
      {hiddenFields
        ? Object.entries(hiddenFields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)
        : null}
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Name</span>
          <input
            name="name"
            defaultValue={user?.name ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            maxLength={120}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={user?.status ?? UserStatus.ACTIVE}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {Object.values(UserStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={user?.email ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Phone</span>
          <input
            name="phone"
            defaultValue={user?.phone ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
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
                {partner.name} ({partner.code})
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={selectedServicePartnerId} /> : null}
        </label>
        {roles.length > 0 ? (
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">Initial role (optional)</span>
            <select
              name="roleId"
              defaultValue={selectedRoleId}
              className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            >
              <option value="">No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({role.key}, {role.scope})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="text-xs text-[var(--muted)]">Users sign in with OTP. At least one of email or phone is required.</p>
      <FormActions cancelHref={cancelHref} submitLabel={user ? "Update user" : "Create user"} />
    </form>
  );
}
