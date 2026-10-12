/**
 * Sidebar — reference §2/§6: dark fixed left rail (~250px, full viewport
 * height) with brand block, grouped SidebarNav and a footer separated by
 * a hairline. Below tablet width (§8) it becomes an off-canvas drawer with
 * overlay, slide transition (~250ms), Escape-to-close and close-on-navigate.
 *
 * Client component: drawer state + pathname-driven nav active state.
 *
 * TL6-003: the footer workspace block renders the studio SESSION state —
 * the signed-in account (initials avatar, email, tier, sign-out) or the
 * signed-out state with the sign-in/create-account links. The raw
 * session token never reaches this component (httpOnly cookie).
 */
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ModeBadge } from "./mode-badge.js";
import { ModeToggle } from "./mode-toggle.js";
import { useNavDrawer } from "./nav-drawer.js";
import styles from "./sidebar.module.css";

export interface SidebarProps {
  /** Honest, non-secret environment label (e.g. "local"). */
  readonly envLabel: string;
  /** Honest, non-secret API host the studio points at (e.g. "127.0.0.1:8080"). */
  readonly apiHostLabel: string;
  /** Display-safe signed-in account metadata, or null (TL6-003). */
  readonly account: { readonly email: string; readonly fullName: string; readonly tier: string } | null;
}

/** Initials for the avatar block (e.g. "Ada Founder" → "AF"). */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return "R";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? "" : "";
  return (first + last).toUpperCase() || "R";
}

export function Sidebar({ envLabel, apiHostLabel, account }: SidebarProps) {
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
        {/* S3-001: the account-level test/live toggle — the dashboard's
            signature affordance, top of the rail (Stripe placement). */}
        <ModeToggle />
        <div className={styles.navScroll}>
          <SidebarNav />
        </div>
        <div className={styles.footer}>
          {account !== null ? (
            <div className={styles.workspace}>
              <span className={styles.workspaceAvatar} aria-hidden="true">
                {initialsOf(account.fullName)}
              </span>
              <span className={styles.workspaceText}>
                <span className={styles.workspaceName} title={account.email}>
                  {account.email}
                </span>
                <span className={styles.workspaceSub}>
                  <Badge uppercase>{account.tier}</Badge>
                </span>
              </span>
            </div>
          ) : (
            <div className={styles.workspace}>
              <span className={styles.workspaceAvatar} aria-hidden="true">
                ·
              </span>
              <span className={styles.workspaceText}>
                <span className={styles.workspaceName}>Not signed in</span>
                <span className={styles.workspaceSub}>account keys need a session</span>
              </span>
            </div>
          )}
          <div className={styles.sessionRow}>
            {account !== null ? (
              <SignOutButton />
            ) : (
              <span className={styles.sessionLinks}>
                <Link className={styles.sessionLink} href="/login">
                  Sign in
                </Link>
                <span aria-hidden="true" className={styles.sessionDot}>
                  ·
                </span>
                <Link className={styles.sessionLink} href="/signup">
                  Create account
                </Link>
              </span>
            )}
          </div>
          <div className={styles.statusRow}>
            <ModeBadge />
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
