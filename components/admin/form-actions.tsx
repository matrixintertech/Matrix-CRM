import Link from "next/link";

export function FormActions({ cancelHref, submitLabel = "Save" }: { cancelHref: string; submitLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
      <Link href={cancelHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium">
        Cancel
      </Link>
      <button type="submit" className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white">
        {submitLabel}
      </button>
    </div>
  );
}
