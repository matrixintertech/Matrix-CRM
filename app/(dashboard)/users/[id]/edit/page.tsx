import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateUserAction } from "@/features/users/actions/user.actions";
import { UserForm } from "@/features/users/components/user-form";
import { getUserById, listServicePartnersForUserForm } from "@/features/users/services/user.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditUserPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please provide a valid service partner and at least one of email or phone.";
  }
  if (code === "duplicate") {
    return "A user with the same email or phone already exists.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  return undefined;
}

export default async function EditUserPage({ params, searchParams }: EditUserPageProps) {
  const session = await requirePermission("users.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const [user, servicePartners] = await Promise.all([getUserById(session, id), listServicePartnersForUserForm(session)]);

  if (!user) {
    notFound();
  }

  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit User" description="Update user identity, contact details, and status." />
      <div>
        <Link href={`/users/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <UserForm
        action={updateUserAction.bind(null, id)}
        cancelHref={`/users/${id}`}
        servicePartners={servicePartners}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        user={{
          name: user.name,
          email: user.email,
          phone: user.phone,
          status: user.status,
          servicePartnerId: user.servicePartnerId,
        }}
      />
    </section>
  );
}
