"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./sidebar.js";

/**
 * Sticky site header with the brand mark, top-level section links, the
 * quickstart CTA, and the mobile navigation drawer.
 */

const SECTION_LINKS: readonly { href: string; label: string; match: string }[] = [
  { href: "/get-started/quickstart", label: "Get started", match: "/get-started" },
  { href: "/api-reference/authentication", label: "API reference", match: "/api-reference" },
  { href: "/webhooks", label: "Webhooks", match: "/webhooks" },
  { href: "/sdks", label: "SDKs", match: "/sdks" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Focus management: when the drawer opens, move focus into it. The
  // drawer closes via link onClick handlers, Escape, the backdrop and the
  // close button (no setState-in-effect cascades).
  useEffect(() => {
    if (drawerOpen) {
      drawerRef.current?.querySelector<HTMLElement>(".drawer-close")?.focus();
    }
  }, [drawerOpen]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <header className="docs-header">
      <div className="header-inner">
        <button
          type="button"
          className="header-menu-btn"
          aria-expanded={drawerOpen}
          aria-controls="docs-drawer"
          aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            {drawerOpen ? (
              <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            )}
          </svg>
        </button>

        <Link
          href="/"
          className="header-logo"
          aria-label="Reckon documentation home"
          onClick={() => setDrawerOpen(false)}
        >
          <span className="logo-mark" aria-hidden="true">R</span>
          <span className="logo-word">Reckon</span>
          <span className="logo-docs">Docs</span>
        </Link>

        <nav className="header-nav" aria-label="Primary">
          {SECTION_LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.match}/`) || (link.match === "/" && pathname === "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className="header-link"
                data-active={active ? "true" : "false"}
                onClick={() => setDrawerOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-actions">
          <Link href="/get-started/quickstart" className="header-cta" onClick={() => setDrawerOpen(false)}>
            Serve your first recommendation
            <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false" className="cta-arrow">
              <path d="M2 7h10M8 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        className="docs-drawer-backdrop"
        data-open={drawerOpen ? "true" : "false"}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div
        id="docs-drawer"
        ref={drawerRef}
        className="docs-drawer"
        role="dialog"
        aria-modal={drawerOpen ? "true" : "false"}
        aria-label="Documentation navigation"
        data-open={drawerOpen ? "true" : "false"}
        inert={!drawerOpen}
      >
        <div className="docs-drawer-head">
          <span className="drawer-title">Documentation</span>
          <button
            type="button"
            className="drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="m3.5 3.5 9 9m0-9-9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <SidebarNav onNavigate={() => setDrawerOpen(false)} />
      </div>
    </header>
  );
}
