/**
 * Integrations — adapter capability cards with verification honesty
 * (workspace goes live in UI-009; foundation renders the honest state).
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/integrations");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function IntegrationsPage() {
  return <WorkspacePlaceholder route={route} />;
}
