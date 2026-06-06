export default function ServiceRequestsLoading() {
  return (
    <section className="space-y-5">
      <div className="space-y-3">
        <div className="h-9 w-64 animate-pulse rounded-xl bg-[#e9eef7]" />
        <div className="h-4 w-80 animate-pulse rounded-xl bg-[#eef3fb]" />
      </div>
      <div className="grid gap-3 rounded-2xl border border-[#dbe5f4] bg-white p-4 md:grid-cols-5">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-10 animate-pulse rounded-xl bg-[#eef3fb]" />
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-[#dbe5f4] bg-white p-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-xl bg-[#eef3fb]" />
        ))}
      </div>
    </section>
  );
}
