import { EmailChangeRequestStatus } from "@prisma/client";

import {
  approveEmailChangeRequestAction,
  rejectEmailChangeRequestAction,
} from "@/features/users/actions/email-change.actions";
import { listEmailChangeRequests } from "@/features/users/services/email-change.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { formatDateTime } from "@/lib/utils/format";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EmailChangeRequestsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getMessage(params: SearchParamsInput) {
  const success = getStringParam(params, "success");
  const error = getStringParam(params, "error");

  if (success === "approved") {
    return { type: "success" as const, text: "Email change request approved and OTP sent to the new email." };
  }
  if (success === "rejected") {
    return { type: "success" as const, text: "Email change request rejected." };
  }
  if (error) {
    return { type: "error" as const, text: "Unable to update the email change request." };
  }

  return null;
}

export default async function EmailChangeRequestsPage({ searchParams }: EmailChangeRequestsPageProps) {
  const session = await requirePermission("email_change_requests.read");
  const [params, canApprove, canReject] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "email_change_requests.approve"),
    hasPermission(session, "email_change_requests.reject"),
  ]);

  const statusParam = getStringParam(params, "status");
  const status = Object.values(EmailChangeRequestStatus).find((value) => value === statusParam);
  const q = getStringParam(params, "q");
  const rows = await listEmailChangeRequests(session, { status, q });
  const message = getMessage(params);

  return (
    <section className="crm-page">
      <div className="crm-panel">
        <h1 className="text-2xl font-semibold text-[#122447]">Email Change Requests</h1>
        <p className="mt-1 text-sm text-[#6f84a9]">Review pending requests, approve them to send OTP to the new email, or reject them with a reason.</p>
      </div>

      {message ? (
        <p className={message.type === "success" ? "crm-alert crm-alert--success" : "crm-alert crm-alert--error"}>{message.text}</p>
      ) : null}

      <div className="crm-panel overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Old Email</th>
              <th className="px-3 py-2">New Email</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Requested</th>
              <th className="px-3 py-2">Reviewed</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{row.user.name?.trim() || row.user.email || row.user.id}</td>
                <td className="px-3 py-2">{row.servicePartner.name}</td>
                <td className="px-3 py-2">{row.oldEmail}</td>
                <td className="px-3 py-2">{row.newEmail}</td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2">{formatDateTime(row.requestedAt)}</td>
                <td className="px-3 py-2">{formatDateTime(row.reviewedAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-2">
                    {canApprove &&
                    (row.status === EmailChangeRequestStatus.PENDING_APPROVAL || row.status === EmailChangeRequestStatus.APPROVED) ? (
                      <form action={approveEmailChangeRequestAction} className="inline-flex">
                        <input type="hidden" name="requestId" value={row.id} />
                        <button type="submit" className="rounded-md border border-emerald-200 px-3 py-1 text-xs font-medium text-emerald-700">
                          Approve
                        </button>
                      </form>
                    ) : null}
                    {canReject &&
                    [EmailChangeRequestStatus.PENDING_APPROVAL, EmailChangeRequestStatus.APPROVED, EmailChangeRequestStatus.OTP_SENT].some((statusValue) => statusValue === row.status) ? (
                      <form action={rejectEmailChangeRequestAction} className="space-y-2">
                        <input type="hidden" name="requestId" value={row.id} />
                        <input
                          name="rejectionReason"
                          placeholder="Rejection reason"
                          className="h-8 w-full rounded-md border border-[var(--border)] px-2 text-xs"
                        />
                        <button type="submit" className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-700">
                          Reject
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="px-3 py-4 text-sm text-[var(--muted)]">No email change requests found.</p> : null}
      </div>
    </section>
  );
}
