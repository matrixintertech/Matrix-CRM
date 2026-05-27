import Link from "next/link";

type AccessDeniedProps = {
  title?: string;
  description?: string;
  returnTo?: string;
};

export function AccessDenied({
  title = "Access denied",
  description = "You do not have permission to view this page.",
  returnTo = "/",
}: AccessDeniedProps) {
  return (
    <section className="mx-auto max-w-2xl rounded-md border border-[var(--border)] bg-white p-6">
      <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
      <div className="mt-5">
        <Link href={returnTo} className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium">
          Back
        </Link>
      </div>
    </section>
  );
}
