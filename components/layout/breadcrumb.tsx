import Link from "next/link";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-[#6f84ab]">
      <ol className="flex min-w-0 flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-2">
              {item.href && !isLast ? (
                <Link href={item.href} className="truncate transition hover:text-[#274fdd]">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? "truncate font-medium text-[#10264d]" : "truncate"}>{item.label}</span>
              )}
              {!isLast && (
                <span className="text-[#9badcc]">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m7 4 6 6-6 6" />
                  </svg>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
