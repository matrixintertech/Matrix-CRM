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
    <div className="flex flex-col gap-4 rounded-2xl border border-[#dce6f5] bg-white px-5 py-5 shadow-[0_10px_30px_rgba(19,52,109,0.05)] sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f84ab]">Workspace</p>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-[#0f2347] sm:text-[2rem]">{title}</h1>
          {description ? <p className="max-w-3xl text-sm leading-6 text-[#5f7398] sm:text-[15px]">{description}</p> : null}
        </div>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2f57f2] to-[#2e65ff] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(47,100,255,0.22)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9db4ff]"
        >
          {action.label}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      ) : null}
    </div>
  );
}
