/**
 * Settings — the operator account-settings section (S3-001 shell; the
 * settings surface arrives with the dashboard backend). Honest
 * placeholder; the test/live mode toggle already lives in the sidebar.
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/settings");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function SettingsPage() {
  return <WorkspacePlaceholder route={route} />;
}
