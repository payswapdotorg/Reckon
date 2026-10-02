/**
 * Scheduler — ranking vs switching vs interruption (workspace goes live in
 * UI-006; foundation renders the honest state).
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/scheduler");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function SchedulerPage() {
  return <WorkspacePlaceholder route={route} />;
}
