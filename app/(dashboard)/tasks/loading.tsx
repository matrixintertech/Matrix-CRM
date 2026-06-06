function RowSkeleton() {
  return <div className="h-12 animate-pulse rounded-xl bg-[#e9eef7]" />;
}

export default function TasksLoading() {
  return (
    <section className="space-y-5">
      <div className="space-y-3">
        <div className="h-9 w-56 animate-pulse rounded-xl bg-[#e9eef7]" />
        <div className="h-4 w-80 animate-pulse rounded-xl bg-[#eef3fb]" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-10 w-32 animate-pulse rounded-xl bg-[#eef3fb]" />
        ))}
      </div>
      <div className="grid gap-3 rounded-2xl border border-[#dbe5f4] bg-white p-4 md:grid-cols-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-10 animate-pulse rounded-xl bg-[#eef3fb]" />
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-[#dbe5f4] bg-white p-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <RowSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}
