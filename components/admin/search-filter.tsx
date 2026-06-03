type SearchFilterProps = {
  query?: string;
  status?: string;
  statusOptions?: { label: string; value: string }[];
  placeholder?: string;
};

export function SearchFilter({ query, status, statusOptions, placeholder = "Search" }: SearchFilterProps) {
  return (
    <form className="flex flex-col gap-3 rounded-2xl border border-[#d8e3f4] bg-white p-3.5 shadow-[0_10px_24px_rgba(25,56,120,0.04)] sm:flex-row sm:items-center" action="">
      <label className="relative min-w-0 flex-1">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7f92b8]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={placeholder}
          className="h-10 min-w-0 w-full rounded-xl border border-[#d2def1] bg-[#fcfdff] pl-10 pr-3 text-sm text-[#15305f] placeholder:text-[#8aa0c7] focus:border-[#3f64ff] focus:outline-none focus:ring-2 focus:ring-[#d9e5ff]"
        />
      </label>
      {statusOptions ? (
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-10 rounded-xl border border-[#d2def1] bg-[#fcfdff] px-3 text-sm text-[#15305f] focus:border-[#3f64ff] focus:outline-none focus:ring-2 focus:ring-[#d9e5ff]"
        >
          <option value="">All statuses</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="submit"
        className="inline-flex h-10 items-center justify-center rounded-xl bg-[#2f5ef8] px-4 text-sm font-semibold text-white shadow-[0_10px_18px_rgba(47,94,248,0.16)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9db4ff]"
      >
        Apply
      </button>
    </form>
  );
}
