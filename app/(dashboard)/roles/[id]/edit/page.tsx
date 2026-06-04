import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateRoleAction } from "@/features/rbac/actions/role.actions";
import { RoleForm } from "@/features/rbac/components/role-form";
import { getRoleById, listRoleServicePartnersForForm } from "@/features/rbac/services/role.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditRolePageProps = {
  params: Promise<{ id: string }>;
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
  if (code === "protected") {
    return "Protected roles cannot be edited.";
  }
  return undefined;
}

export default async function EditRolePage({ params, searchParams }: EditRolePageProps) {
  const session = await requirePermission("roles.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const [role, servicePartners] = await Promise.all([getRoleById(session, id), listRoleServicePartnersForForm(session)]);

  if (!role) {
    notFound();
  }

  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Role" description="Update role metadata and scope." />
      <div>
        <Link href={`/roles/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <RoleForm
        action={updateRoleAction.bind(null, id)}
        cancelHref={`/roles/${id}`}
        servicePartners={servicePartners}
        canChooseServicePartner={false}
        canChooseScope={session.user.isSuperAdmin && !role.isSystem}
        errorMessage={errorMessage}
        role={{
          name: role.name,
          key: role.key,
          description: role.description,
          scope: role.scope,
          level: role.level,
          servicePartnerId: role.servicePartnerId,
          isSystem: role.isSystem || role.key === "super_admin",
        }}
      />
    </section>
  );
}
