import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createUserAction } from "@/features/users/actions/user.actions";
import { UserForm } from "@/features/users/components/user-form";
import { canManageServicePartners, getServicePartnerById } from "@/features/service-partners/services/service-partner.service";
import { redirectForbidden } from "@/lib/auth/access-control";
import { requirePermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewCompanyAdminPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please provide valid values and at least one contact channel.";
  }
  if (code === "duplicate") {
    return "A user with the same email or phone already exists.";
  }
  if (code === "role") {
    return "Company admin role not found for this tenant.";
  }
  if (code === "role-permission" || code === "permission-grant") {
    return "You do not have permission to assign that role.";
  }
  return undefined;
}

export default async function NewCompanyAdminPage({ params, searchParams }: NewCompanyAdminPageProps) {
  const session = await requirePermission("users.create");
  if (!canManageServicePartners(session)) {
    redirectForbidden("/service-partners");
  }

  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const servicePartner = await getServicePartnerById(session, id);

  if (!servicePartner) {
    notFound();
  }

  const companyAdminRole = await prisma.role.findFirst({
    where: {
      servicePartnerId: servicePartner.id,
      key: "company_admin",
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      key: true,
      scope: true,
    },
  });
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title="Add Company Admin"
        description={`Create a company admin for ${servicePartner.name}.`}
      />

      <div>
        <Link href={`/service-partners/${servicePartner.id}`} className="text-sm text-[var(--muted)] underline">
          Back to service partner
        </Link>
      </div>

      {!companyAdminRole ? (
        <EmptyState
          title="Company admin role missing"
          description="Run seed to provision default tenant roles, then retry."
        />
      ) : (
        <UserForm
          action={createUserAction}
          cancelHref={`/service-partners/${servicePartner.id}`}
          servicePartners={[{ id: servicePartner.id, name: servicePartner.name, code: servicePartner.code }]}
          roles={[
            {
              id: companyAdminRole.id,
              name: companyAdminRole.name,
              key: companyAdminRole.key,
              scope: companyAdminRole.scope,
              servicePartnerId: servicePartner.id,
            },
          ]}
          initialRoleIds={[companyAdminRole.id]}
          canChooseServicePartner={false}
          hiddenFields={{
            errorRedirect: `/service-partners/${servicePartner.id}/admins/new`,
            successRedirect: `/service-partners/${servicePartner.id}?success=company-admin-created`,
          }}
          errorMessage={errorMessage}
        />
      )}
    </section>
  );
}
