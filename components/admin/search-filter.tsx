type SearchFilterProps = {
  query?: string;
  status?: string;
  statusOptions?: { label: string; value: string }[];
  placeholder?: string;
};

export function SearchFilter({ query, status, statusOptions, placeholder = "Search" }: SearchFilterProps) {
  return (
    <form className="flex flex-col gap-2 sm:flex-row" action="">
      <input
        type="search"
        name="q"
        defaultValue={query}
        placeholder={placeholder}
        className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
      />
      {statusOptions ? (
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-9 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
        >
          <option value="">All statuses</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
        Apply
      </button>
    </form>
  );
}
