/**
 * SiteHeader — reference §2: content header with breadcrumb
 * (`Reckon Studio > Developers > API keys`), search field with ⌘K hint,
 * primary CTA on the right; compact on mobile (§8): hamburger +
 * icon-search + short CTA.
 *
 * S3-001: the breadcrumb renders the FULL parent chain (nested developer
 * routes) and the header carries the account mode badge — one of the
 * shell-wide mode indicators that recolor with the test/live toggle.
 *
 * Client component: breadcrumb derives from the pathname; the hamburger
 * drives the nav drawer; the search trigger opens the command palette.
 */
"use client";

import { ChevronRight, Menu, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { breadcrumbTrailFor, getWorkspaceRoute } from "@/lib/workspace";
import { ModeBadge } from "./mode-badge.js";
import { CommandPalette } from "./command-palette.js";
import { useNavDrawer } from "./nav-drawer.js";
import styles from "./site-header.module.css";

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const { isOpen: drawerOpen, toggle } = useNavDrawer();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const trail = breadcrumbTrailFor(pathname);
  const currentTitle = getWorkspaceRoute(pathname)?.title ?? "Reckon Studio";

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button
          type="button"
          className={styles.menuButton}
          aria-label="Open navigation"
          aria-controls="reckon-sidebar"
          aria-expanded={drawerOpen}
          onClick={toggle}
        >
          <Menu aria-hidden="true" strokeWidth={1.75} size={20} />
        </button>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/" className={styles.breadcrumbRoot}>
            Reckon Studio
          </Link>
          {trail.length > 1
            ? trail.slice(0, -1).map((route) => (
                <span className={styles.breadcrumbCrumb} key={route.href}>
                  <ChevronRight
                    className={styles.breadcrumbSeparator}
                    aria-hidden="true"
                    size={14}
                  />
                  <Link href={route.href} className={styles.breadcrumbParent}>
                    {route.title}
                  </Link>
                </span>
              ))
            : null}
          <ChevronRight className={styles.breadcrumbSeparator} aria-hidden="true" size={14} />
          <span className={styles.breadcrumbCurrent} aria-current="page">
            {currentTitle}
          </span>
        </nav>
      </div>
      <div className={styles.right}>
        <span className={styles.modeBadge}>
          <ModeBadge />
        </span>
        <SearchInput onClick={() => setPaletteOpen(true)} />
        <Button href="/decisions" variant="primary" size="md" className={styles.cta}>
          <Plus aria-hidden="true" strokeWidth={2} size={15} />
          <span className={styles.ctaLong}>New decision</span>
          <span className={styles.ctaShort}>Decision</span>
        </Button>
        <CommandPalette
          open={paletteOpen}
          onOpen={() => setPaletteOpen(true)}
          onClose={() => setPaletteOpen(false)}
        />
      </div>
    </header>
  );
}
