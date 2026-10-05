"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_SECTIONS } from "@/content/navigation";

/**
 * Sidebar navigation with the full docs IA: collapsible sections, live
 * search filter, active-page state, sticky on desktop, and a drawer
 * variant for mobile (rendered by the site header).
 */

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    // docs.stripe.com pattern: the full IA is visible by default — the
    // section containing the active page is pinned open, and users can
    // collapse anything. On the docs home (no active section) everything
    // stays expanded so the whole portal is discoverable.
    return new Set<string>();
  });

  const filtering = query.trim().length > 0;
  const needle = query.trim().toLowerCase();

  const sections = useMemo(() => {
    if (!filtering) return DOCS_SECTIONS;
    return DOCS_SECTIONS.map((section) => ({
      ...section,
      pages: section.pages.filter(
        (page) =>
          page.title.toLowerCase().includes(needle) ||
          page.description.toLowerCase().includes(needle),
      ),
    })).filter((section) => section.pages.length > 0);
  }, [filtering, needle]);

  const totalMatches = sections.reduce((sum, section) => sum + section.pages.length, 0);

  function toggle(sectionId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  return (
    <div className="sidebar-nav">
      <div className="sidebar-search">
        <svg className="sidebar-search-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M6.5 12a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Zm4.2-.3 3.3 3.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search these docs"
          aria-label="Search documentation pages"
          className="sidebar-search-input"
        />
      </div>
      {sections.map((section) => {
        const expanded = filtering || !collapsed.has(section.id);
        return (
          <div key={section.id} className="sidebar-section">
            <button
              type="button"
              className="sidebar-section-btn"
              aria-expanded={expanded}
              aria-controls={`sidebar-section-${section.id}`}
              onClick={() => toggle(section.id)}
            >
              <span>{section.title}</span>
              <svg
                className="sidebar-chevron"
                viewBox="0 0 12 12"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {expanded && (
              <ul className="sidebar-pages" id={`sidebar-section-${section.id}`}>
                {section.pages.map((page) => {
                  const active = page.path === pathname;
                  return (
                    <li key={page.id} className="sidebar-page-item">
                      <Link
                        href={page.path}
                        onClick={onNavigate}
                        className="sidebar-page-link"
                        data-active={active ? "true" : "false"}
                        aria-current={active ? "page" : undefined}
                      >
                        <span>{page.title}</span>
                        {page.status === "target" ? (
                          <span className="sidebar-status" title="Target contract — lands with the S2 lane">
                            S2
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {filtering && totalMatches === 0 && (
        <p className="sidebar-empty">No pages match “{query.trim()}”.</p>
      )}
      {!filtering && (
        <div className="sidebar-extras">
          <Link
            href="/changelog"
            onClick={onNavigate}
            className="sidebar-extra-link"
            data-active={pathname === "/changelog" ? "true" : "false"}
            aria-current={pathname === "/changelog" ? "page" : undefined}
          >
            <span>Changelog</span>
            <span className="sidebar-extra-hint">What shipped, newest first</span>
          </Link>
        </div>
      )}
      <p className="sidebar-contracts">Contracts v0.1.0 · frozen (CONTRACT-001)</p>
    </div>
  );
}

/** Desktop sticky rail. */
export function Sidebar() {
  return (
    <aside className="docs-sidebar" aria-label="Documentation sidebar">
      <SidebarNav />
    </aside>
  );
}
