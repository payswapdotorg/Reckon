/**
 * Analytics — the operator section for CTR lift, latency percentiles,
 * drift indicators and funnels. S3-001 lands the shell; the analytics
 * VIEWS are the S3-002 work item (separate delivery) — this placeholder
 * states that precisely, with Research as the related live surface.
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/analytics");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function AnalyticsPage() {
  return <WorkspacePlaceholder route={route} />;
}
