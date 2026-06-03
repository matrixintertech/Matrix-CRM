import Link from "next/link";

export function FormActions({ cancelHref, submitLabel = "Save" }: { cancelHref: string; submitLabel?: string }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-[#d9e4f5] pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-[#7588ac]">Review the information before saving. Required fields should stay clear and complete.</p>
      <div className="flex items-center justify-end gap-2">
        <Link
          href={cancelHref}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-[#cfdbf2] bg-white px-4 text-sm font-medium text-[#2f476e] transition hover:bg-[#f5f8ff]"
        >
        Cancel
        </Link>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-[#2f57f2] to-[#2e65ff] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(47,100,255,0.26)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9db4ff]"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
