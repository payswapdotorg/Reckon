/**
 * DecisionUnavailableState (UI-004) — the honest degradation state for a
 * requested-but-unretrievable decision: the reference §7 pattern
 * (foundation EmptyState — red-tinted card, precise reason, single Retry)
 * with the typed SDK failure surfaced verbatim (error code + message +
 * HTTP status when the server answered).
 *
 * Never a fabricated fallback — when the API cannot answer, the workspace
 * says exactly what it observed.
 */
import { EmptyState } from "@/components/empty-state";
import type { DecisionRetrieval } from "@/lib/decision-retrieval";

export interface DecisionUnavailableStateProps {
  retrieval:
    | Extract<DecisionRetrieval, { status: "not-configured" }>
    | Extract<DecisionRetrieval, { status: "error" }>;
}

export function DecisionUnavailableState({ retrieval }: DecisionUnavailableStateProps) {
  const reason =
    retrieval.status === "not-configured"
      ? `lookup of decision “${retrieval.requestedId}” is impossible in this studio configuration — ${retrieval.reason}`
      : `lookup of decision “${retrieval.requestedId}” failed — ${retrieval.message}` +
        (retrieval.statusCode === undefined ? "" : ` (HTTP ${retrieval.statusCode})`);

  const note =
    retrieval.status === "not-configured"
      ? "The studio renders only real Reckon API state — configure the server-side key (see apps/web/README.md) and retry; no data is fabricated in the meantime."
      : `Typed SDK error code: ${retrieval.code}. The studio surfaces the precise failure it observed — the API is the authority; retry re-attempts the same lookup.`;

  return <EmptyState title="Decision unavailable" reason={reason} note={note} />;
}
