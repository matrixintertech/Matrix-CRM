export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatOptional(value: string | null | undefined): string {
  return value?.trim() ? value : "-";
}
