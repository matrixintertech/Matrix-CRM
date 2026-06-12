import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type TimelineEntry = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  remarks: string | null;
  changedAt: Date;
  changedBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

export function ServiceRequestTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No status timeline available yet.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const changedBy = entry.changedBy?.name || entry.changedBy?.email || entry.changedBy?.phone || "System";

        return (
          <div key={entry.id} className="rounded-[20px] border border-[#e8eef8] bg-[#fbfcff] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge value={entry.toStatus} />
              <span className="text-[var(--muted)]">
                from {entry.fromStatus ? entry.fromStatus : "-"} by {changedBy}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">{formatDateTime(entry.changedAt)}</p>
            <p className="mt-2 text-sm">{formatOptional(entry.remarks)}</p>
          </div>
        );
      })}
    </div>
  );
}
