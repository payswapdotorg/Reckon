/**
 * Recommendations — the operator section for the recommendation monitor
 * (S3-001 shell; the monitor itself arrives with the dashboard backend).
 * Honest placeholder + related live surfaces until then.
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/recommendations");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function RecommendationsPage() {
  return <WorkspacePlaceholder route={route} />;
}
