import { getServicePartnerPrimaryName } from "@/lib/service-partners/display";

type SettingsFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  canUpdate: boolean;
  errorMessage?: string;
  servicePartner: {
    id: string;
    code: string;
    name: string;
    legalName: string | null;
    status: string;
  };
  values: {
    timezone: string;
    otpExpirySeconds: number;
    otpMaxAttempts: number;
    otpResendCooldownSeconds: number;
  };
  system: {
    otpDeliveryChannel: string;
    taskLocationRequired: boolean;
    taskAttachmentMaxMb: number;
    storageDriver: string;
    storageConfigured: boolean;
    smtpConfigured: boolean;
    cacheDriver: string;
    rateLimitDriver: string;
    activityLogRetentionDays: number;
  };
};

function boolLabel(value: boolean) {
  return value ? "Enabled" : "Disabled";
}

function runtimeTone(value: boolean) {
  return value ? "bg-[#ecfbf2] text-[#1d9d57]" : "bg-[#fff1f1] text-[#ff4f5e]";
}

export function SettingsForm({ action, canUpdate, errorMessage, servicePartner, values, system }: SettingsFormProps) {
  const primaryName = getServicePartnerPrimaryName(servicePartner);
  const legalName = servicePartner.legalName?.trim() || "Not provided";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="redirectTo" value="/settings" />

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_380px]">
        <div className="space-y-5">
          <div className="crm-form-shell space-y-5">
            <div className="crm-panel-heading">
              <div>
                <h2>Platform & Company Settings</h2>
                <p>Only real tenant configuration exposed by this app is editable here. Secrets and infrastructure credentials remain hidden.</p>
              </div>
            </div>

            <div className="crm-form-section space-y-4">
              <div>
                <h3 className="crm-form-section-title">Workspace Identity</h3>
                <p className="crm-form-section-copy">Safe read-only company information for the current tenant scope.</p>
              </div>
              <div className="crm-detail-grid crm-detail-grid--two">
                <div className="crm-detail-item">
                  <dt>Company Name</dt>
                  <dd>{primaryName}</dd>
                </div>
                <div className="crm-detail-item">
                  <dt>Company Code</dt>
                  <dd>{servicePartner.code}</dd>
                </div>
                <div className="crm-detail-item">
                  <dt>Legal Name</dt>
                  <dd>{legalName}</dd>
                </div>
                <div className="crm-detail-item">
                  <dt>Status</dt>
                  <dd>{servicePartner.status}</dd>
                </div>
              </div>
            </div>

            <div className="crm-form-section space-y-4">
              <div>
                <h3 className="crm-form-section-title">Localization</h3>
                <p className="crm-form-section-copy">Timezone is persisted per tenant and affects request, task, payment, and audit timestamps.</p>
              </div>
              <div className="crm-form-grid md:grid-cols-2">
                <label className="crm-field md:col-span-2">
                  <span className="crm-field-label">Default Timezone</span>
                  <input
                    name="timezone"
                    defaultValue={values.timezone}
                    disabled={!canUpdate}
                    className="crm-input"
                    required
                  />
                  <p className="crm-field-note">Use an IANA timezone such as `Asia/Kolkata`, `UTC`, or `America/New_York`.</p>
                </label>
              </div>
            </div>

            <div className="crm-form-section space-y-4">
              <div>
                <h3 className="crm-form-section-title">OTP & Security Controls</h3>
                <p className="crm-form-section-copy">These values are backed by tenant settings and stay within the validated server-side limits.</p>
              </div>
              <div className="crm-form-grid md:grid-cols-3">
                <label className="crm-field">
                  <span className="crm-field-label">OTP Expiry (seconds)</span>
                  <input
                    type="number"
                    name="otpExpirySeconds"
                    defaultValue={values.otpExpirySeconds}
                    min={30}
                    max={3600}
                    disabled={!canUpdate}
                    className="crm-input"
                    required
                  />
                </label>
                <label className="crm-field">
                  <span className="crm-field-label">Max OTP Attempts</span>
                  <input
                    type="number"
                    name="otpMaxAttempts"
                    defaultValue={values.otpMaxAttempts}
                    min={1}
                    max={10}
                    disabled={!canUpdate}
                    className="crm-input"
                    required
                  />
                </label>
                <label className="crm-field">
                  <span className="crm-field-label">Resend Cooldown (seconds)</span>
                  <input
                    type="number"
                    name="otpResendCooldownSeconds"
                    defaultValue={values.otpResendCooldownSeconds}
                    min={0}
                    max={3600}
                    disabled={!canUpdate}
                    className="crm-input"
                    required
                  />
                </label>
              </div>
              <p className="crm-note-card">
                Runtime access remains role-based through roles and permissions. This page does not expose any user-level permission matrix.
              </p>
            </div>

            <div className="flex justify-end">
              {canUpdate ? (
                <button type="submit" className="crm-button w-full sm:w-auto">
                  Save Changes
                </button>
              ) : (
                <div className="crm-note-card max-w-xl">
                  You can review these values, but you do not have permission to update tenant settings.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="crm-panel">
            <div className="crm-panel-heading">
              <div>
                <h2>Runtime Diagnostics</h2>
                <p>Only safe health indicators are shown here. No credentials, URLs, passwords, or secrets are exposed.</p>
              </div>
            </div>
            <div className="crm-meta-list">
              <div className="crm-meta-row">
                <span>Email / SMTP</span>
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${runtimeTone(system.smtpConfigured)}`}>
                  {system.smtpConfigured ? "Configured" : "Not Configured"}
                </span>
              </div>
              <div className="crm-meta-row">
                <span>OTP Delivery</span>
                <span className="font-semibold uppercase">{system.otpDeliveryChannel}</span>
              </div>
              <div className="crm-meta-row">
                <span>Storage Driver</span>
                <span className="font-semibold">{system.storageDriver}</span>
              </div>
              <div className="crm-meta-row">
                <span>Storage Ready</span>
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${runtimeTone(system.storageConfigured)}`}>
                  {boolLabel(system.storageConfigured)}
                </span>
              </div>
              <div className="crm-meta-row">
                <span>Cache Driver</span>
                <span className="font-semibold">{system.cacheDriver}</span>
              </div>
              <div className="crm-meta-row">
                <span>Rate Limiter</span>
                <span className="font-semibold">{system.rateLimitDriver}</span>
              </div>
              <div className="crm-meta-row">
                <span>Task Location Capture</span>
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${runtimeTone(system.taskLocationRequired)}`}>
                  {boolLabel(system.taskLocationRequired)}
                </span>
              </div>
              <div className="crm-meta-row">
                <span>Task Proof Limit</span>
                <span className="font-semibold">{system.taskAttachmentMaxMb} MB</span>
              </div>
            </div>
          </div>

          <div className="crm-panel">
            <div className="crm-panel-heading">
              <div>
                <h2>Operations Notes</h2>
                <p>Platform-level guardrails and workflow reminders for super admin operations.</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-[#4d6186]">
              <div className="crm-note-card">
                Activity logs are purged automatically after <span className="font-semibold">{system.activityLogRetentionDays} days</span> unless the retention setting is changed at runtime.
              </div>
              <div className="crm-note-card">
                Vendor finance flows remain payables-focused: vendor invoices, vendor payments, and ledger postings should be managed from their respective modules.
              </div>
              <div className="crm-note-card">
                Use the Roles and Permissions modules for access control changes. This settings page only manages tenant-safe configuration values.
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
