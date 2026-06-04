import Link from "next/link";

import {
  requestEmailChangeAction,
  sendEmailChangeOtpAction,
  verifyEmailChangeAction,
} from "@/features/users/actions/email-change.actions";
import { getLatestEmailChangeRequestForUser } from "@/features/users/services/email-change.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils/format";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type ProfilePageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getMessage(params: SearchParamsInput) {
  const success = getStringParam(params, "success");
  const error = getStringParam(params, "error");

  if (success === "email-change-requested") {
    return { type: "success" as const, text: "Email change request submitted for approval." };
  }
  if (success === "email-change-otp-sent") {
    return { type: "success" as const, text: "Verification OTP sent to the new email address." };
  }
  if (success === "email-change-verified") {
    return { type: "success" as const, text: "Email updated successfully after OTP verification." };
  }
  if (error === "email-change-duplicate") {
    return { type: "error" as const, text: "The requested email is already in use." };
  }
  if (error === "email-change-pending") {
    return { type: "error" as const, text: "An email change request is already pending for this user." };
  }
  if (error === "email-change-expired") {
    return { type: "error" as const, text: "The verification OTP expired. Request a fresh OTP." };
  }
  if (error?.startsWith("email-change")) {
    return { type: "error" as const, text: "Unable to complete the email change flow." };
  }

  return null;
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const session = await requirePermission("profile.email_change.request");
  const [params, user, latestRequest, canReadRequests] = await Promise.all([
    resolveSearchParams(searchParams),
    getCurrentUser(),
    getLatestEmailChangeRequestForUser(session.user.id),
    hasPermission(session, "email_change_requests.read"),
  ]);

  if (!user) {
    return null;
  }

  const message = getMessage(params);
  const awaitingOtp = latestRequest?.status === "OTP_SENT" || latestRequest?.status === "APPROVED";

  return (
    <section className="crm-page">
      <div className="crm-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#122447]">Profile</h1>
            <p className="mt-1 text-sm text-[#6f84a9]">Request an email change, wait for approval, then verify ownership of the new address with OTP.</p>
          </div>
          {canReadRequests ? (
            <Link href="/email-change-requests" className="text-sm font-medium text-[var(--primary)] underline">
              Open approval queue
            </Link>
          ) : null}
        </div>
      </div>

      {message ? (
        <p className={message.type === "success" ? "crm-alert crm-alert--success" : "crm-alert crm-alert--error"}>{message.text}</p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.2fr,1fr]">
        <div className="crm-panel">
          <h2 className="mb-4 text-base font-semibold">Current account email</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Name</dt>
              <dd>{user.name?.trim() || "-"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Current email</dt>
              <dd>{user.email ?? "-"}</dd>
            </div>
          </dl>

          <form action={requestEmailChangeAction} className="mt-5 space-y-3 rounded-xl border border-[var(--border)] p-4">
            <div>
              <p className="text-sm font-medium text-[#122447]">Request email change</p>
              <p className="mt-1 text-xs text-[var(--muted)]">The request goes to Super Admin approval first. OTP is sent only to the new email after approval.</p>
            </div>
            <label className="space-y-1 text-sm">
              <span className="font-medium">New email</span>
              <input type="email" name="newEmail" className="h-10 w-full rounded-md border border-[var(--border)] px-3" required />
            </label>
            <button type="submit" className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white">
              Submit request
            </button>
          </form>
        </div>

        <div className="crm-panel">
          <h2 className="mb-4 text-base font-semibold">Latest email change request</h2>
          {!latestRequest ? (
            <p className="text-sm text-[var(--muted)]">No email change requests found for this account.</p>
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-[var(--muted)]">Status</dt>
                  <dd>{latestRequest.status}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Requested new email</dt>
                  <dd>{latestRequest.newEmail}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Requested at</dt>
                  <dd>{formatDateTime(latestRequest.requestedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Reviewed at</dt>
                  <dd>{formatDateTime(latestRequest.reviewedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">OTP expires at</dt>
                  <dd>{formatDateTime(latestRequest.expiresAt)}</dd>
                </div>
              </dl>

              {awaitingOtp ? (
                <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
                  <form action={sendEmailChangeOtpAction} className="space-y-3">
                    <input type="hidden" name="requestId" value={latestRequest.id} />
                    <div>
                      <p className="text-sm font-medium text-[#122447]">Send or resend verification OTP</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">OTP is delivered to {latestRequest.newEmail} only after approval.</p>
                    </div>
                    <button type="submit" className="rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium">
                      Send OTP
                    </button>
                  </form>

                  <form action={verifyEmailChangeAction} className="space-y-3">
                    <input type="hidden" name="requestId" value={latestRequest.id} />
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">OTP code</span>
                      <input name="code" inputMode="numeric" className="h-10 w-full rounded-md border border-[var(--border)] px-3" required />
                    </label>
                    <button type="submit" className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white">
                      Verify and update email
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
