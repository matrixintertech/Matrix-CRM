function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-[#e7eef9] ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#e3eaf6] bg-white p-6 shadow-sm">
        <SkeletonBlock className="h-4 w-28" />
        <SkeletonBlock className="mt-4 h-10 w-64" />
        <SkeletonBlock className="mt-3 h-4 w-full max-w-2xl" />
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <SkeletonBlock className="h-20" />
          <SkeletonBlock className="h-20" />
          <SkeletonBlock className="h-20" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-4 h-8 w-16" />
            <SkeletonBlock className="mt-3 h-4 w-28" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 2xl:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
          <SkeletonBlock className="h-6 w-40" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-14" />
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
            <SkeletonBlock className="h-6 w-32" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <SkeletonBlock key={index} className="h-16" />
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#e3eaf6] bg-white p-5 shadow-sm">
            <SkeletonBlock className="h-6 w-36" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonBlock key={index} className="h-16" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
