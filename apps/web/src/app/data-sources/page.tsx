/**
 * Data Sources — the operator section for catalogs, event streams and
 * adapter inputs (S3-001 shell; the registry arrives with the dashboard
 * backend — adapter capability cards are viewable in Integrations
 * today). Honest placeholder.
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/data-sources");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function DataSourcesPage() {
  return <WorkspacePlaceholder route={route} />;
}
