"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { FocusEventHandler, MouseEventHandler, PropsWithChildren } from "react";

type PrefetchLinkProps = PropsWithChildren<
  LinkProps & {
    className?: string;
    prefetchMode?: "auto" | "intent" | "off";
    onClick?: MouseEventHandler<HTMLAnchorElement>;
    onMouseEnter?: MouseEventHandler<HTMLAnchorElement>;
    onFocus?: FocusEventHandler<HTMLAnchorElement>;
  }
>;

export function PrefetchLink({
  children,
  href,
  prefetchMode = "intent",
  onClick,
  onMouseEnter,
  onFocus,
  ...props
}: PrefetchLinkProps) {
  const router = useRouter();
  const didPrefetchRef = useRef(false);
  const hrefString = typeof href === "string" ? href : href.toString();
  const canPrefetch = hrefString.startsWith("/");

  const prefetch = () => {
    if (!canPrefetch || didPrefetchRef.current || prefetchMode === "off") {
      return;
    }

    didPrefetchRef.current = true;
    router.prefetch(hrefString);
  };

  return (
    <Link
      {...props}
      href={href}
      prefetch={prefetchMode === "auto" && canPrefetch}
      onClick={onClick}
      onMouseEnter={(event) => {
        if (prefetchMode === "intent") {
          prefetch();
        }
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        if (prefetchMode === "intent") {
          prefetch();
        }
        onFocus?.(event);
      }}
    >
      {children}
    </Link>
  );
}
