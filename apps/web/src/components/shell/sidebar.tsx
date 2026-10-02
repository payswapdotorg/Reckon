/**
 * Sidebar — reference §2/§6: dark fixed left rail (~250px, full viewport
 * height) with brand block, grouped SidebarNav and a footer separated by a
 * hairline. Below tablet width (§8) it becomes an off-canvas drawer with
 * overlay, slide transition (~250ms), Escape-to-close and close-on-navigate.
 *
 * Client component: drawer state + pathname-driven nav active state.
 */
"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import { Badge } from "@/components/ui/badge";
import { useNavDrawer } from "./nav-drawer";
import styles from "./sidebar.module.css";

export interface SidebarProps {
  /** Honest, non-secret environment label (e.g. "local"). */
  envLabel: string;
  /** Honest, non-secret API host the studio points at (e.g. "127.0.0.1:8080"). */
  apiHostLabel: string;
}

export function Sidebar({ envLabel, apiHostLabel }: SidebarProps) {
  const { isOpen, close } = useNavDrawer();
  const pathname = usePathname();

  // Close the drawer when the route changes (§8 mobile drawer behavior).
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  return (
    <>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <div
        className={isOpen ? `${styles.overlay} ${styles.overlayVisible}` : styles.overlay}
        aria-hidden="true"
        onClick={close}
      />
      <aside
        id="reckon-sidebar"
        aria-label="Reckon Studio navigation"
        className={isOpen ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar}
        data-open={isOpen ? "true" : "false"}
      >
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            R
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandWordmark}>Reckon</span>
            <span className={styles.brandTagline}>Decision infrastructure</span>
          </span>
        </div>
        <div className={styles.navScroll}>
          <SidebarNav />
        </div>
        <div className={styles.footer}>
          <div className={styles.workspace}>
            <span className={styles.workspaceAvatar} aria-hidden="true">
              RS
            </span>
            <span className={styles.workspaceText}>
              <span className={styles.workspaceName}>Reckon Studio</span>
              <span className={styles.workspaceSub}>demo workspace</span>
            </span>
          </div>
          <div className={styles.statusRow}>
            <Badge uppercase>ENV: {envLabel}</Badge>
            <span className={styles.apiLabel} title="Reckon API origin this studio points at">
              {apiHostLabel}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
