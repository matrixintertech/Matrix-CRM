"use client";

import { useState } from "react";

import { UserStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";
import { UserPermissionMatrix } from "@/features/users/components/user-permission-matrix";

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
  servicePartnerId: string;
};

type PermissionOption = {
  id: string;
  key: string;
  module: string;
  action: string;
  description: string | null;
};

type UserFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  roles?: RoleOption[];
  permissions?: PermissionOption[];
  roleTemplatePermissionIds?: Record<string, string[]>;
  initialPermissionIds?: string[];
  defaultRoleId?: string;
  hiddenFields?: Record<string, string>;
  errorMessage?: string;
  permissionPresetMode?: "default" | "companyAdmin";
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
  permissions = [],
  roleTemplatePermissionIds = {},
  initialPermissionIds = [],
  defaultRoleId,
  hiddenFields,
  user,
  canChooseServicePartner,
  errorMessage,
  permissionPresetMode = "default",
}: UserFormProps) {
  const selectedServicePartnerId = user?.servicePartnerId ?? servicePartners[0]?.id ?? "";
  const selectedRoleId = defaultRoleId ?? "";
  const [servicePartnerId, setServicePartnerId] = useState(selectedServicePartnerId);

  return (
    <form action={action} className="space-y-6 rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
      {hiddenFields
        ? Object.entries(hiddenFields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)
        : null}
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="space-y-4 rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">1. Basic Information</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Full Name</span>
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
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">2. Contact Information</h3>
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">3. Company Access</h3>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Service Partner / Company</span>
          <select
            name="servicePartnerId"
            value={servicePartnerId}
            onChange={(event) => setServicePartnerId(event.target.value)}
            disabled={!canChooseServicePartner}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3 disabled:bg-slate-50"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name} ({partner.code})
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={servicePartnerId} /> : null}
        </label>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">4. Role & Permissions</h3>
        <UserPermissionMatrix
          roles={roles}
          permissions={permissions}
          roleTemplatePermissionIds={roleTemplatePermissionIds}
          defaultRoleId={selectedRoleId}
          initialPermissionIds={initialPermissionIds}
          selectedServicePartnerId={servicePartnerId}
          presetMode={permissionPresetMode}
        />
        <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Role only pre-fills permissions. Final access is controlled by selected user permissions.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-100 p-4">
        <h3 className="text-sm font-semibold text-slate-900">5. Login Access</h3>
        <p className="text-xs text-[var(--muted)]">Users sign in with OTP and password (if configured). At least one of email or phone is required.</p>
      </div>

      <FormActions cancelHref={cancelHref} submitLabel={user ? "Update user" : "Create user"} />
    </form>
  );
}
