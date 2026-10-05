/**
 * Models — the operator section for the model registry (S3-001 shell;
 * the registry itself arrives with the dashboard backend — agent model
 * assignments are viewable in Agents today). Honest placeholder.
 */
import type { Metadata } from "next";
import { WorkspacePlaceholder } from "@/components/workspace-placeholder";
import { requireWorkspaceRoute } from "@/lib/workspace";

const route = requireWorkspaceRoute("/models");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default function ModelsPage() {
  return <WorkspacePlaceholder route={route} />;
}
