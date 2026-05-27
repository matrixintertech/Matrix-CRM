import { AccessDenied } from "@/components/auth/access-denied";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type ForbiddenPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

export default async function ForbiddenPage({ searchParams }: ForbiddenPageProps) {
  const params = await resolveSearchParams(searchParams);
  const returnTo = getSafeRedirectPath(getStringParam(params, "returnTo"), "/");

  return (
    <AccessDenied
      title="Access denied"
      description="Your account is authenticated, but it does not have permission to access this area."
      returnTo={returnTo}
    />
  );
}
