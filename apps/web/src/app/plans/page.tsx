/**
 * Plans — rolling experience plans (workspace goes live in UI-005;
 * foundation renders the honest state).
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/plans");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function PlansPage() {
  return <WorkspacePlaceholder route={route} />;
}
