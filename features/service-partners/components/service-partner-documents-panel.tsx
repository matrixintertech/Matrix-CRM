import Link from "next/link";

import {
  deleteServicePartnerDocumentAction,
  uploadServicePartnerDocumentAction,
} from "@/features/service-partners/actions/service-partner.actions";
import type { ServicePartnerDocumentView } from "@/features/service-partners/services/service-partner.service";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ServicePartnerDocumentsPanel({
  servicePartnerId,
  documents,
  canManage,
}: {
  servicePartnerId: string;
  documents: ServicePartnerDocumentView[];
  canManage: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Documents</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Upload GST certificates, cancelled cheques, and other company documents.</p>
        </div>
        <p className="text-xs text-[var(--muted)]">{documents.length} file(s)</p>
      </div>

      {canManage ? (
        <form
          action={uploadServicePartnerDocumentAction.bind(null, servicePartnerId)}
          className="space-y-3 rounded-md border border-[var(--border)] p-4"
        >
          <input type="hidden" name="redirectTo" value={`/service-partners/${servicePartnerId}`} />
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Document label</span>
              <input
                name="documentLabel"
                className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                maxLength={80}
                placeholder="GST Certificate, Cancelled Cheque, Bank Letter"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">File</span>
              <input
                name="file"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                className="block h-9 w-full rounded-md border border-[var(--border)] px-3 py-1 text-sm"
                required
              />
            </label>
          </div>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Note</span>
            <textarea
              name="note"
              maxLength={1000}
              className="min-h-24 w-full rounded-md border border-[var(--border)] px-3 py-2"
              placeholder="Optional note about this document"
            />
          </label>
          <p className="text-xs text-[var(--muted)]">Allowed: JPG, JPEG, PNG, WEBP, PDF. Upload each document separately so labels stay clear.</p>
          <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium">
            Upload document
          </button>
        </form>
      ) : (
        <p className="rounded-md border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
          You do not have permission to manage service partner documents.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {documents.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No service partner documents uploaded yet.</p>
        ) : (
          documents.map((document) => (
            <article key={document.id} className="rounded-md border border-[var(--border)] p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{document.fileName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {(document.documentLabel || "Document")} / {document.mimeType} / {formatFileSize(document.fileSize)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={document.fileUrl} target="_blank" rel="noreferrer" className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium">
                    Open
                  </Link>
                  {canManage ? (
                    <form action={deleteServicePartnerDocumentAction.bind(null, servicePartnerId, document.id)}>
                      <input type="hidden" name="redirectTo" value={`/service-partners/${servicePartnerId}`} />
                      <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-700">
                        Delete
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Uploaded by {document.uploadedBy?.name?.trim() || document.uploadedBy?.email || document.uploadedBy?.phone || "Unknown"} on{" "}
                {formatDateTime(document.createdAt)}
              </p>
              <p className="mt-2 text-sm text-slate-700">{formatOptional(document.note)}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
