/**
 * Developers › API keys (S3-001) — the key manager: list (name, prefix,
 * mode, created, last used), create flow (the once-only secret), revoke
 * (live-mode confirm gated). Data arrives through the honest seam: the
 * page server-side attempts GET /v1/api-keys and renders exactly what
 * was observed — the not-wired state names the pending route, never a
 * fake success (Gate Q).
 */
import type { Metadata } from "next";
import { ApiKeysManager } from "@/components/developers/api-keys-manager";
import { WorkspacePage } from "@/components/workspace-page";
import { fetchApiKeys } from "@/lib/developers-surface";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/developers/keys");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function ApiKeysPage() {
  const result = await fetchApiKeys();

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      <ApiKeysManager result={result} />
    </WorkspacePage>
  );
}
