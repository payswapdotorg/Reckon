/**
 * AppShell — reference §2: dark fixed left sidebar + light main content
 * area ("pro tool" dashboard shell), sticky content header, single-column
 * content with airy padding. Server component: it reads the (non-secret)
 * API display config server-side and hands only labels to the client shell
 * pieces — no secret can leak into a client bundle this way.
 *
 * S3-001: the shell is wrapped in the DashboardModeProvider — the
 * account-level test/live mode context (toggle, indicators, confirm
 * gating) lives here so every route inherits it.
 */
import { Sidebar } from "./sidebar.js";
import { SiteHeader } from "./site-header.js";
import { NavDrawerProvider } from "./nav-drawer.js";
import { DashboardModeProvider } from "./mode-provider.js";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import type { ReactNode } from "react";
import styles from "./app-shell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  const apiConfig = getReckonApiDisplayConfig();
  return (
    <DashboardModeProvider>
      <NavDrawerProvider>
        <Sidebar envLabel={apiConfig.envLabel} apiHostLabel={apiConfig.apiHostLabel} />
        <div className={styles.mainColumn}>
          <SiteHeader />
          <main id="main-content" className={styles.content}>
            {children}
          </main>
        </div>
      </NavDrawerProvider>
    </DashboardModeProvider>
  );
}
