export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#cbd7ef] bg-[#f9fbff] px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-white text-[#5270b8] shadow-sm">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 7h16M4 12h10M4 17h7" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-[#10264d]">{title}</h2>
      {description ? <p className="mx-auto mt-1.5 max-w-xl text-sm leading-6 text-[#6b81ab]">{description}</p> : null}
    </div>
  );
}
