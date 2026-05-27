import { redirect } from "next/navigation";

import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

export function getForbiddenPath(returnTo?: string | null) {
  const safeReturnTo = getSafeRedirectPath(returnTo, "/");

  if (safeReturnTo === "/") {
    return "/forbidden";
  }

  const params = new URLSearchParams({ returnTo: safeReturnTo });
  return `/forbidden?${params.toString()}`;
}

export function redirectForbidden(returnTo?: string | null): never {
  redirect(getForbiddenPath(returnTo));
}
