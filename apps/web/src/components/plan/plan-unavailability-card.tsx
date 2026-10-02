/**
 * PlanUnavailabilityCard (UI-005) — the honest degradation state for a
 * requested-but-unretrievable plan: reference §7 pattern (foundation
 * EmptyState — red-tinted card, precise reason, single Retry) with the
 * typed SDK failure surfaced verbatim. Mirrors the Decision workspace
 * (UI-004) — never a fabricated fallback.
 */
import { EmptyState } from "@/components/empty-state";
import type { PlanRetrieval } from "@/lib/plan-retrieval";

export interface PlanUnavailabilityCardProps {
  retrieval:
    | Extract<PlanRetrieval, { status: "not-configured" }>
    | Extract<PlanRetrieval, { status: "error" }>;
}

export function PlanUnavailabilityCard({ retrieval }: PlanUnavailabilityCardProps) {
  const reason =
    retrieval.status === "not-configured"
      ? `lookup of plan “${retrieval.requestedId}” is impossible in this studio configuration — ${retrieval.reason}`
      : `lookup of plan “${retrieval.requestedId}” failed — ${retrieval.message}` +
        (retrieval.statusCode === undefined ? "" : ` (HTTP ${retrieval.statusCode})`);

  const note =
    retrieval.status === "not-configured"
      ? "The studio renders only real Reckon API state — configure the server-side key (see apps/web/README.md) and retry; no data is fabricated in the meantime."
      : `Typed SDK error code: ${retrieval.code}. A 404 here means no plan exists under that id for this tenant; retry re-attempts the same lookup.`;

  return <EmptyState title="Plan unavailable" reason={reason} note={note} />;
}
