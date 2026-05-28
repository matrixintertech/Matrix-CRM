const styles: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  INACTIVE: "bg-slate-100 text-slate-700 ring-slate-200",
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  REJECTED: "bg-red-50 text-red-700 ring-red-200",
  ON_HOLD: "bg-orange-50 text-orange-800 ring-orange-200",
  SUSPENDED: "bg-red-50 text-red-700 ring-red-200",
  PLATFORM: "bg-teal-50 text-teal-700 ring-teal-200",
  TENANT: "bg-sky-50 text-sky-700 ring-sky-200",
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-200",
  RAISED: "bg-amber-50 text-amber-800 ring-amber-200",
  TRIAGED: "bg-sky-50 text-sky-700 ring-sky-200",
  PM_ASSIGNED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  SM_ASSIGNED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  QUOTE_PREPARING: "bg-violet-50 text-violet-700 ring-violet-200",
  QUOTE_SUBMITTED: "bg-violet-50 text-violet-700 ring-violet-200",
  QUOTE_APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  QUOTE_REJECTED: "bg-rose-50 text-rose-700 ring-rose-200",
  IN_PROGRESS: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  BLOCKED: "bg-orange-50 text-orange-800 ring-orange-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CLOSED: "bg-slate-100 text-slate-700 ring-slate-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${styles[value] ?? styles.INACTIVE}`}>
      {value.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}
