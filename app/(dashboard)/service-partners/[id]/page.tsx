import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import {
  deleteServicePartnerDocumentAction,
  uploadServicePartnerDocumentAction,
} from "@/features/service-partners/actions/service-partner.actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { ServicePartnerStatusActions } from "@/features/service-partners/components/service-partner-status-actions";
import {
  canManageServicePartners,
  getServicePartnerById,
  listServicePartnerDocuments,
} from "@/features/service-partners/services/service-partner.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { getServicePartnerPrimaryName } from "@/lib/service-partners/display";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type ServicePartnerDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Service partner created successfully.";
  }
  if (code === "updated") {
    return "Service partner updated successfully.";
  }
  if (code === "company-admin-created") {
    return "Company admin created successfully.";
  }
  if (code === "document-uploaded") {
    return "Service partner document uploaded successfully.";
  }
  if (code === "document-deleted") {
    return "Service partner document deleted successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  if (code === "platform-protected") {
    return "This action is blocked for the platform service partner.";
  }
  if (code === "document-validation") {
    return "Document upload failed validation. Check the file type, label, and size.";
  }
  if (code === "document-storage") {
    return "Service partner document uploads are not configured for this environment.";
  }
  if (code === "document-not-found") {
    return "Service partner document could not be found.";
  }
  return undefined;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function ServicePartnerDetailPage({ params, searchParams }: ServicePartnerDetailPageProps) {
  const session = await requirePermission("service_partners.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const servicePartner = await getServicePartnerById(session, id);

  if (!servicePartner) {
    notFound();
  }

  const [canUpdate, canDelete, canCreateUsers, canReadUsers, canUpdateUsers, canReadClients, canReadBranches, canReadRequests, canReadReports, canReadInvoices, canReadVendorPayments] = await Promise.all([
    hasPermission(session, "service_partners.update"),
    hasPermission(session, "service_partners.delete"),
    hasPermission(session, "users.create"),
    hasPermission(session, "users.read"),
    hasPermission(session, "users.update"),
    hasPermission(session, "clients.read"),
    hasPermission(session, "branches.read"),
    hasPermission(session, "service_requests.read"),
    hasPermission(session, "reports.read"),
    hasPermission(session, "invoices.read"),
    hasPermission(session, "vendor_payments.read"),
  ]);
  const canManage = canManageServicePartners(session);
  const companyAdmins =
    canManage && canReadUsers
      ? await prisma.user.findMany({
          where: {
            servicePartnerId: servicePartner.id,
            deletedAt: null,
            roles: {
              some: {
                role: {
                  key: "company_admin",
                  deletedAt: null,
                },
              },
            },
          },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            lastLoginAt: true,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 20,
        })
      : [];
  const [recentClients, recentBranches, recentUsers, requestSummary, financeSummary, documents] = await Promise.all([
    canReadClients
      ? prisma.client.findMany({
          where: {
            servicePartnerId: servicePartner.id,
            deletedAt: null,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    canReadBranches
      ? prisma.branch.findMany({
          where: {
            servicePartnerId: servicePartner.id,
            deletedAt: null,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            name: true,
            code: true,
          },
        })
      : Promise.resolve([]),
    canReadUsers
      ? prisma.user.findMany({
          where: {
            servicePartnerId: servicePartner.id,
            deletedAt: null,
          },
          orderBy: [{ createdAt: "desc" }],
          take: 6,
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    canReadRequests
      ? prisma.serviceRequest.groupBy({
          by: ["status"],
          where: {
            servicePartnerId: servicePartner.id,
            deletedAt: null,
          },
          _count: {
            _all: true,
          },
        })
      : Promise.resolve([]),
    canReadReports || canReadInvoices || canReadVendorPayments
      ? Promise.all([
          canReadInvoices
            ? prisma.invoice.aggregate({
                where: {
                  servicePartnerId: servicePartner.id,
                  deletedAt: null,
                },
                _sum: {
                  grandTotal: true,
                },
                _count: {
                  _all: true,
                },
              })
            : Promise.resolve(null),
          canReadVendorPayments
            ? prisma.vendorPayment.aggregate({
                where: {
                  servicePartnerId: servicePartner.id,
                },
                _sum: {
                  amount: true,
                },
                _count: {
                  _all: true,
                },
              })
            : Promise.resolve(null),
        ])
      : Promise.resolve([null, null] as const),
    listServicePartnerDocuments(session, servicePartner.id),
  ]);

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={getServicePartnerPrimaryName(servicePartner)}
        description="Review service partner details and tenant-level statistics."
        action={canUpdate && canManage ? { label: "Edit service partner", href: `/service-partners/${servicePartner.id}/edit` } : undefined}
      />

      <div>
        <Link href="/service-partners" className="text-sm text-[var(--muted)] underline">
          Back to service partners
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-4 text-base font-semibold">Summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Code</dt>
                <dd>{servicePartner.code}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={servicePartner.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Name</dt>
                <dd>{getServicePartnerPrimaryName(servicePartner)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Legal name</dt>
                <dd>{formatOptional(servicePartner.legalName)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Email</dt>
                <dd>{formatOptional(servicePartner.email)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Phone</dt>
                <dd>{formatOptional(servicePartner.phone)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">GST No.</dt>
                <dd>{formatOptional(servicePartner.gstNumber)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Bank name</dt>
                <dd>{formatOptional(servicePartner.bankName)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Bank branch</dt>
                <dd>{formatOptional(servicePartner.bankBranch)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">IFSC No.</dt>
                <dd>{formatOptional(servicePartner.bankIfscCode)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">A/C No.</dt>
                <dd>{formatOptional(servicePartner.bankAccountNumber)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Address</dt>
                <dd>{formatOptional(servicePartner.address)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Short profile</dt>
                <dd>{formatOptional(servicePartner.shortProfile)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">City</dt>
                <dd>{formatOptional(servicePartner.city)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">State</dt>
                <dd>{formatOptional(servicePartner.state)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Country</dt>
                <dd>{formatOptional(servicePartner.country)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Postal code</dt>
                <dd>{formatOptional(servicePartner.postalCode)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Documents</dt>
                <dd>{documents.length}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{formatDateTime(servicePartner.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Updated</dt>
                <dd>{formatDateTime(servicePartner.updatedAt)}</dd>
              </div>
            </dl>
          </div>
          {canManage && canUpdate ? (
            <div className="rounded-md border border-[var(--border)] bg-white p-5">
              <h2 className="mb-3 text-base font-semibold">Status & deletion</h2>
              <ServicePartnerStatusActions
                servicePartnerId={servicePartner.id}
                canDelete={canDelete}
                canManage={canManage}
              />
            </div>
          ) : null}

          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Documents</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Upload GST certificates, cancelled cheques, and other company documents.</p>
              </div>
              <p className="text-xs text-[var(--muted)]">{documents.length} file(s)</p>
            </div>

            {canManage && canUpdate ? (
              <form
                action={uploadServicePartnerDocumentAction.bind(null, servicePartner.id)}
                className="space-y-3 rounded-md border border-[var(--border)] p-4"
                encType="multipart/form-data"
              >
                <input type="hidden" name="redirectTo" value={`/service-partners/${servicePartner.id}`} />
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
                        {canManage && canUpdate ? (
                          <form action={deleteServicePartnerDocumentAction.bind(null, servicePartner.id, document.id)}>
                            <input type="hidden" name="redirectTo" value={`/service-partners/${servicePartner.id}`} />
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
        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="mb-3 text-base font-semibold">Tenant usage</h2>
            <p className="text-[var(--muted)]">Users: {servicePartner._count.users}</p>
            <p className="text-[var(--muted)]">Clients: {servicePartner._count.clients}</p>
            <p className="text-[var(--muted)]">Branches: {servicePartner._count.branches}</p>
            <Link href={`/clients?servicePartnerId=${servicePartner.id}`} className="mt-3 inline-block text-sm underline">
              Open clients
            </Link>
          </div>

          {canManage && canReadUsers ? (
            <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Company Admins</h2>
                {canCreateUsers ? (
                  <Link href={`/service-partners/${servicePartner.id}/admins/new`} className="text-sm font-medium text-[var(--primary)] underline">
                    Add Company Admin
                  </Link>
                ) : null}
              </div>
              {companyAdmins.length === 0 ? (
                <p className="text-[var(--muted)]">No company admins found for this service partner.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Phone</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Last Login</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyAdmins.map((admin) => (
                        <tr key={admin.id} className="border-t border-[var(--border)]">
                          <td className="px-3 py-2 font-medium">{admin.name?.trim() || admin.email || admin.phone || "Company Admin"}</td>
                          <td className="px-3 py-2">{formatOptional(admin.email)}</td>
                          <td className="px-3 py-2">{formatOptional(admin.phone)}</td>
                          <td className="px-3 py-2">
                            <StatusBadge value={admin.status} />
                          </td>
                          <td className="px-3 py-2">{admin.lastLoginAt ? formatDateTime(admin.lastLoginAt) : "-"}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Link href={`/users/${admin.id}`} className="text-xs font-medium text-[var(--primary)] underline">
                                View
                              </Link>
                              {canUpdateUsers ? (
                                <Link href={`/users/${admin.id}/edit`} className="text-xs font-medium text-[var(--primary)] underline">
                                  Edit
                                </Link>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {canReadClients ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="mb-3 text-base font-semibold">Clients</h2>
            {recentClients.length === 0 ? (
              <p className="text-[var(--muted)]">No clients found for this company.</p>
            ) : (
              <div className="space-y-2">
                {recentClients.map((client) => (
                  <Link key={client.id} href={`/clients/${client.id}`} className="block rounded-md border border-[var(--border)] px-3 py-2">
                    <p className="font-medium">{client.name}</p>
                    <p className="text-xs text-[var(--muted)]">{client.code} / {client.status}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {canReadBranches ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="mb-3 text-base font-semibold">Branches</h2>
            {recentBranches.length === 0 ? (
              <p className="text-[var(--muted)]">No branches found for this company.</p>
            ) : (
              <div className="space-y-2">
                {recentBranches.map((branch) => (
                  <Link key={branch.id} href={`/branches/${branch.id}`} className="block rounded-md border border-[var(--border)] px-3 py-2">
                    <p className="font-medium">{branch.name}</p>
                    <p className="text-xs text-[var(--muted)]">{branch.code}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {canReadUsers ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="mb-3 text-base font-semibold">Users</h2>
            {recentUsers.length === 0 ? (
              <p className="text-[var(--muted)]">No users found for this company.</p>
            ) : (
              <div className="space-y-2">
                {recentUsers.map((user) => (
                  <Link key={user.id} href={`/users/${user.id}`} className="block rounded-md border border-[var(--border)] px-3 py-2">
                    <p className="font-medium">{user.name?.trim() || user.email || user.id}</p>
                    <p className="text-xs text-[var(--muted)]">{user.email ?? "-"} / {user.status}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {canReadRequests ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="mb-3 text-base font-semibold">Service Request Summary</h2>
            {requestSummary.length === 0 ? (
              <p className="text-[var(--muted)]">No service requests found for this company.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {requestSummary.map((entry) => (
                  <div key={entry.status} className="rounded-md border border-[var(--border)] px-3 py-2">
                    <p className="font-medium">{entry.status}</p>
                    <p className="text-xs text-[var(--muted)]">Count: {entry._count._all}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {canReadReports || canReadInvoices || canReadVendorPayments ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm xl:col-span-2">
            <h2 className="mb-3 text-base font-semibold">Financial Summary</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Vendor Invoices</p>
                <p className="mt-1 font-medium">{financeSummary[0]?._count._all ?? 0}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Vendor Invoice Total</p>
                <p className="mt-1 font-medium">{Number(financeSummary[0]?._sum.grandTotal ?? 0).toFixed(2)}</p>
              </div>
              <div className="rounded-md border border-[var(--border)] px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Vendor Payments</p>
                <p className="mt-1 font-medium">{Number(financeSummary[1]?._sum.amount ?? 0).toFixed(2)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
