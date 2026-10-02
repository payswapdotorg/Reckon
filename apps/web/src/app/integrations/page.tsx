/**
 * Integrations — the integration workspace (UI-009): adapter capability
 * cards aligned EXACTLY with the existing adapter declarations.
 *
 * §14 honesty law (structural): a provider is NEVER displayed as
 * "connected" merely because the mapper exists — the declarations'
 * liveVerification is fixture-only until a real provider path is
 * verified, and the cards display exactly that (Gate Q).
 *
 * force-dynamic: the declaration read resolves at request time.
 */
import type { Metadata } from "next";
import { AdapterCapabilityCard } from "@/components/integration/adapter-capability-card";
import { WorkspacePage } from "@/components/workspace-page";
import { getReckonApiDisplayConfig } from "@/lib/reckon-client";
import { listAdapters } from "@/lib/integration-retrieval";
import { requireWorkspaceRoute } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const route = requireWorkspaceRoute("/integrations");

export const metadata: Metadata = {
  title: route.title,
  description: route.subtitle,
};

export default async function IntegrationsPage() {
  const [listing, apiConfig] = await Promise.all([listAdapters(), getReckonApiDisplayConfig()]);

  return (
    <WorkspacePage title={route.title} subtitle={route.subtitle}>
      {listing.status === "found" ? (
        listing.adapters.map((adapter) => (
          <AdapterCapabilityCard key={adapter.adapterId} adapter={adapter} />
        ))
      ) : listing.status === "not-configured" ? (
        <p className="text-sm text-neutral-500">
          Adapter declarations unavailable in this studio configuration — the server-side SDK
          client is not configured (RECKON_DEMO_API_KEY). No capability status is fabricated.
        </p>
      ) : (
        <p className="text-sm text-neutral-500">
          Adapter declaration listing failed — {listing.message}
          {listing.statusCode === undefined ? "" : ` (HTTP ${listing.statusCode})`}. Typed SDK
          error code: {listing.code}. The studio surfaces the precise failure it observed
          {apiConfig.demoApiKeyConfigured ? "" : " (no demo API key configured)"}.
        </p>
      )}
    </WorkspacePage>
  );
}
