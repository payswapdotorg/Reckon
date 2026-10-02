/**
 * Agents — agent bodies and organization graphs (workspace goes live in
 * UI-007; foundation renders the honest state).
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/agents");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function AgentsPage() {
  return <WorkspacePlaceholder route={route} />;
}
