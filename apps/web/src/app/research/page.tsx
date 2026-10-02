/**
 * Research — the learning ladder with evidence-class discipline (workspace
 * goes live in UI-008; foundation renders the honest state).
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/research");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function ResearchPage() {
  return <WorkspacePlaceholder route={route} />;
}
