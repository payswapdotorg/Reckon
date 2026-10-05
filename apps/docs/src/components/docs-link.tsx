import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Routing adapter for the docs portal. Internal links go through the
 * App Router <Link>; external links open safely in a new tab. This is the
 * ONLY component in the portal that touches next/link, so the surface
 * stays swappable in one file.
 */
export function DocsLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return (
      <a
        href={href}
        className={className ?? "docs-link"}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className ?? "docs-link"}>
      {children}
    </Link>
  );
}
