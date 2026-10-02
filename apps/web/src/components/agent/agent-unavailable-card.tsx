/**
 * AgentUnavailableCard (UI-007) — honest degradation for a
 * requested-but-unretrievable organization (reference §7 pattern).
 */
import { EmptyState } from "@/components/empty-state";
import type { AgentRetrieval } from "@/lib/agent-retrieval";

export interface AgentUnavailableCardProps {
  retrieval:
    | Extract<AgentRetrieval<unknown>, { status: "not-configured" }>
    | Extract<AgentRetrieval<unknown>, { status: "error" }>;
}

export function AgentUnavailableCard({ retrieval }: AgentUnavailableCardProps) {
  const reason =
    retrieval.status === "not-configured"
      ? `lookup of the ${retrieval.kind} is impossible in this studio configuration — ${retrieval.reason}`
      : `lookup failed — ${retrieval.message}${retrieval.statusCode === undefined ? "" : ` (HTTP ${retrieval.statusCode})`}`;
  const note =
    retrieval.status === "not-configured"
      ? "Configure the server-side key (see apps/web/README.md) and retry; no data is fabricated in the meantime."
      : `Typed SDK error code: ${retrieval.code}. A 404 means no such ${retrieval.kind} exists for this tenant.`;
  return <EmptyState title="Agent declaration unavailable" reason={reason} note={note} />;
}
