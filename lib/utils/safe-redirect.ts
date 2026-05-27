export function getSafeRedirectPath(value: FormDataEntryValue | string | null | undefined, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}
