import { FormActions } from "@/components/admin/form-actions";
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
    smtpConfigured: boolean;
    cacheDriver: string;
    rateLimitDriver: string;
  };
};

function boolLabel(value: boolean) {
  return value ? "Enabled" : "Disabled";
}

export function SettingsForm({ action, canUpdate, errorMessage, servicePartner, values, system }: SettingsFormProps) {
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="redirectTo" value="/settings" />

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-5">
          <div className="crm-panel">
            <h2 className="mb-4 text-base font-semibold">Workspace Settings</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium">Timezone</span>
                <input
                  name="timezone"
                  defaultValue={values.timezone}
                  className="h-10 w-full rounded-md border border-[var(--border)] px-3"
                  placeholder="Asia/Kolkata"
                  disabled={!canUpdate}
                  required
                />
                <p className="text-xs text-[var(--muted)]">Use a standard IANA timezone, for example `Asia/Kolkata` or `UTC`.</p>
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium">OTP expiry seconds</span>
                <input
                  name="otpExpirySeconds"
                  type="number"
                  min={30}
                  max={3600}
                  defaultValue={values.otpExpirySeconds}
                  className="h-10 w-full rounded-md border border-[var(--border)] px-3"
                  disabled={!canUpdate}
                  required
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium">OTP max attempts</span>
                <input
                  name="otpMaxAttempts"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={values.otpMaxAttempts}
                  className="h-10 w-full rounded-md border border-[var(--border)] px-3"
                  disabled={!canUpdate}
                  required
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium">OTP resend cooldown</span>
                <input
                  name="otpResendCooldownSeconds"
                  type="number"
                  min={0}
                  max={3600}
                  defaultValue={values.otpResendCooldownSeconds}
                  className="h-10 w-full rounded-md border border-[var(--border)] px-3"
                  disabled={!canUpdate}
                  required
                />
                <p className="text-xs text-[var(--muted)]">Seconds before users can request another OTP.</p>
              </label>
            </div>
          </div>

          <div className="crm-panel">
            <h2 className="mb-4 text-base font-semibold">Runtime Controls</h2>
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">OTP delivery</p>
                <p className="mt-1 font-medium">{system.otpDeliveryChannel.toUpperCase()}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Storage driver</p>
                <p className="mt-1 font-medium">{system.storageDriver}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Task location</p>
                <p className="mt-1 font-medium">{boolLabel(system.taskLocationRequired)}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Attachment limit</p>
                <p className="mt-1 font-medium">{system.taskAttachmentMaxMb} MB</p>
              </div>
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">SMTP</p>
                <p className="mt-1 font-medium">{boolLabel(system.smtpConfigured)}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Cache / rate limit</p>
                <p className="mt-1 font-medium">{system.cacheDriver} / {system.rateLimitDriver}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">These controls are currently sourced from environment configuration, so they are visible here but not edited from the UI.</p>
          </div>
        </div>

        <div className="space-y-5">
          <div className="crm-panel">
            <h2 className="mb-4 text-base font-semibold">Tenant Scope</h2>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-[var(--muted)]">Service partner</dt>
                <dd>{getServicePartnerPrimaryName(servicePartner)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Code</dt>
                <dd>{servicePartner.code}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>{servicePartner.status}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Legal name</dt>
                <dd>{servicePartner.legalName?.trim() || "-"}</dd>
              </div>
            </dl>
          </div>

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Notes</h2>
            <ul className="space-y-2 text-sm text-[var(--muted)]">
              <li>Timezone affects how tenant-level data should be interpreted in reports and workflows.</li>
              <li>OTP policy controls how long verification codes remain valid and how aggressively retries are limited.</li>
              <li>System controls are shown here so admins can confirm current runtime behavior without opening environment files.</li>
            </ul>
          </div>
        </div>
      </div>

      {canUpdate ? (
        <FormActions cancelHref="/" submitLabel="Save settings" />
      ) : (
        <div className="crm-panel">
          <p className="text-sm text-[var(--muted)]">You can view these settings, but you do not have permission to update them.</p>
        </div>
      )}
    </form>
  );
}
