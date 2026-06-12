"use client";

import { useState } from "react";

import { UserStatus } from "@prisma/client";

import { FormActions } from "@/components/admin/form-actions";
import { UserRoleSelector } from "@/features/users/components/user-role-selector";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type ServicePartnerOption = {
  id: string;
  name: string;
  legalName?: string | null;
  code: string;
};

type RoleOption = {
  id: string;
  name: string;
  key: string;
  scope: string;
  servicePartnerId: string;
};

type UserFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  cancelHref: string;
  servicePartners: ServicePartnerOption[];
  roles?: RoleOption[];
  initialRoleIds?: string[];
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
  initialRoleIds = [],
  hiddenFields,
  user,
  canChooseServicePartner,
  errorMessage,
}: UserFormProps) {
  const selectedServicePartnerId = user?.servicePartnerId ?? servicePartners[0]?.id ?? "";
  const [servicePartnerId, setServicePartnerId] = useState(selectedServicePartnerId);

  return (
    <form action={action} className="crm-form-shell space-y-5">
      {hiddenFields
        ? Object.entries(hiddenFields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)
        : null}
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <div className="crm-form-section space-y-4">
        <div>
          <h3 className="crm-form-section-title">Basic Information</h3>
          <p className="crm-form-section-copy">Capture the user identity and current account state.</p>
        </div>
        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field">
            <span className="crm-field-label">Full Name</span>
            <input
              name="name"
              defaultValue={user?.name ?? ""}
              className="crm-input"
              maxLength={120}
            />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Status</span>
            <select
              name="status"
              defaultValue={user?.status ?? UserStatus.ACTIVE}
              className="crm-select"
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

      <div className="crm-form-section space-y-4">
        <div>
          <h3 className="crm-form-section-title">Contact Information</h3>
          <p className="crm-form-section-copy">At least one verified contact method is required for access and OTP delivery.</p>
        </div>
        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field">
            <span className="crm-field-label">Email</span>
            <input
              name="email"
              type="email"
              defaultValue={user?.email ?? ""}
              className="crm-input"
            />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Phone</span>
            <input name="phone" defaultValue={user?.phone ?? ""} className="crm-input" />
          </label>
        </div>
      </div>

      <div className="crm-form-section space-y-4">
        <div>
          <h3 className="crm-form-section-title">Company Access</h3>
          <p className="crm-form-section-copy">Users stay tenant-scoped to one service partner or company workspace.</p>
        </div>
        <label className="crm-field">
          <span className="crm-field-label">Service Partner / Company</span>
          <select
            name="servicePartnerId"
            value={servicePartnerId}
            onChange={(event) => setServicePartnerId(event.target.value)}
            disabled={!canChooseServicePartner}
            className="crm-select"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          {!canChooseServicePartner ? <input type="hidden" name="servicePartnerId" value={servicePartnerId} /> : null}
          <p className="crm-field-note">Platform admins can choose the workspace. Tenant admins stay locked to their own company scope.</p>
        </label>
      </div>

      <div className="crm-form-section space-y-4">
        <div>
          <h3 className="crm-form-section-title">Role Access</h3>
          <p className="crm-form-section-copy">Assign one or more roles. Permission mapping remains role-based only.</p>
        </div>
        <UserRoleSelector roles={roles} initialRoleIds={initialRoleIds} selectedServicePartnerId={servicePartnerId} />
        <p className="crm-note-card">
          Access is controlled by assigned roles. Edit role permissions from the Roles module.
        </p>
      </div>

      <div className="crm-form-section space-y-2">
        <h3 className="crm-form-section-title">Login Access</h3>
        <p className="crm-form-section-copy">Users sign in with OTP and password if enabled for the environment.</p>
        <p className="crm-note-card">At least one of email or phone is required so account recovery and OTP delivery remain workable.</p>
      </div>

      <FormActions cancelHref={cancelHref} submitLabel={user ? "Update user" : "Create user"} />
    </form>
  );
}
