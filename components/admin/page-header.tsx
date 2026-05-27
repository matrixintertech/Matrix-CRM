import Link from "next/link";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: {
    label: string;
    href: string;
  };
};

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-[var(--muted)]">{description}</p> : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-white"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
