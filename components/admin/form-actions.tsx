import Link from "next/link";

export function FormActions({ cancelHref, submitLabel = "Save" }: { cancelHref: string; submitLabel?: string }) {
  return (
    <div className="flex flex-col gap-3 border-t border-[#d9e4f5] pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-[#7588ac]">Review the information before saving. Required fields should stay clear and complete.</p>
      <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-2xl bg-white/95 p-3 shadow-[0_14px_34px_rgba(18,49,105,0.14)] backdrop-blur sm:static sm:flex-row sm:items-center sm:justify-end sm:bg-transparent sm:p-0 sm:shadow-none">
        <Link
          href={cancelHref}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#cfdbf2] bg-white px-4 text-sm font-medium text-[#2f476e] transition hover:bg-[#f5f8ff] sm:w-auto"
        >
          Cancel
        </Link>
        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#2f57f2] to-[#2e65ff] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(47,100,255,0.26)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9db4ff] sm:w-auto"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
