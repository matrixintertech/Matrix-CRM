import { RoleScope } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createRoleAction } from "@/features/rbac/actions/role.actions";
import { RoleForm } from "@/features/rbac/components/role-form";
import { listRoleServicePartnersForForm } from "@/features/rbac/services/role.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewRolePageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please provide valid role values.";
  }
  if (code === "duplicate") {
    return "A role with the same key already exists for this tenant.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  return undefined;
}

export default async function NewRolePage({ searchParams }: NewRolePageProps) {
  const session = await requirePermission("roles.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listRoleServicePartnersForForm(session),
  ]);
  const defaultServicePartner = servicePartners[0];

  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Role" description="Create a role for tenant or platform access control." />
      <div>
        <Link href="/roles" className="text-sm text-[var(--muted)] underline">
          Back to roles
        </Link>
      </div>
      {!defaultServicePartner ? (
        <EmptyState title="No service partner found" description="Create a service partner before creating roles." />
      ) : (
        <RoleForm
          action={createRoleAction}
          cancelHref="/roles"
          servicePartners={servicePartners}
          canChooseServicePartner={session.user.isSuperAdmin}
          canChooseScope={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          role={{
            name: "",
            key: "",
            description: "",
            scope: RoleScope.TENANT,
            level: 0,
            servicePartnerId: defaultServicePartner.id,
            isSystem: false,
          }}
        />
      )}
    </section>
  );
}
