const styles: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  INACTIVE: "bg-slate-100 text-slate-700 ring-slate-200",
  SUSPENDED: "bg-red-50 text-red-700 ring-red-200",
  PLATFORM: "bg-teal-50 text-teal-700 ring-teal-200",
  TENANT: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles[value] ?? styles.INACTIVE}`}>
      {value.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}
