"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import type { FocusEventHandler, MouseEventHandler, PropsWithChildren } from "react";

type PrefetchLinkProps = PropsWithChildren<
  LinkProps & {
    className?: string;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
    onMouseEnter?: MouseEventHandler<HTMLAnchorElement>;
    onFocus?: FocusEventHandler<HTMLAnchorElement>;
  }
>;

export function PrefetchLink({ children, href, onClick, onMouseEnter, onFocus, ...props }: PrefetchLinkProps) {
  const router = useRouter();
  const hrefString = typeof href === "string" ? href : href.toString();

  const prefetch = () => {
    if (hrefString.startsWith("/")) {
      router.prefetch(hrefString);
    }
  };

  return (
    <Link
      {...props}
      href={href}
      prefetch
      onClick={onClick}
      onMouseEnter={(event) => {
        prefetch();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetch();
        onFocus?.(event);
      }}
    >
      {children}
    </Link>
  );
}
