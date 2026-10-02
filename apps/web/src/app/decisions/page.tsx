/**
 * Decisions — context, candidates, experiences and the selected decision
 * (workspace goes live in UI-004; foundation renders the honest state).
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/decisions");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function DecisionsPage() {
  return <WorkspacePlaceholder route={route} />;
}
