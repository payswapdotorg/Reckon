/**
 * Settings — the operator account-settings section (TL6-003): the
 * account-access surface (the real studio session state — display-safe
 * identity, tier, sign in/out) plus the honest placeholder for the
 * settings backend that arrives with later dashboard waves. The
 * test/live mode toggle already lives in the sidebar.
 */
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionStatusCard } from "@/components/auth/session-status-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getStudioAccountDisplay } from "@/lib/account-surface";
import { requireWorkspaceRoute } from "@/lib/workspace";
import styles from "./settings-page.module.css";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/settings");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function SettingsPage() {
  const account = await getStudioAccountDisplay();

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <SessionStatusCard account={account} surfaceName="Settings" />
      <Card tone="degraded">
        <CardHeader>
          <CardTitle>Workspace settings</CardTitle>
          <CardDescription>
            The workspace-identity, defaults and danger-zone surfaces arrive with the operator dashboard backend —
            nothing here is fabricated meanwhile (Gate Q).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className={styles.pendingNote}>
            Pending surfaces: workspace identity, notification defaults, data-retention controls, account deletion.
            The account&apos;s API keys are managed on{" "}
            <a className={styles.pendingLink} href="/developers/keys">
              Developers → API keys
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </WorkspacePage>
  );
}
