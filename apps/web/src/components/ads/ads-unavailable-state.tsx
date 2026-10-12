/**
 * AdsUnavailableState (AD-005) — the honest degradation state for an ads
 * surface that could not answer: the reference §7 pattern (foundation
 * EmptyState — red-tinted card, precise reason, single Retry) with the
 * typed SDK failure surfaced verbatim (error code + message + HTTP
 * status when the server answered). Never a fabricated fallback.
 */
import { EmptyState } from "@/components/empty-state";
import type { AdsFailure } from "@/lib/ads-retrieval";

export interface AdsUnavailableStateProps {
  /** The surface that failed (e.g. "The ad query", "The record detail"). */
  readonly surface: string;
  readonly failure: AdsFailure;
}

export function AdsUnavailableState({ surface, failure }: AdsUnavailableStateProps) {
  const reason = `${surface} failed — ${failure.message}${
    failure.statusCode === undefined ? "" : ` (HTTP ${failure.statusCode})`
  }`;
  const note = `Typed SDK error code: ${failure.code}. The studio surfaces the precise failure it observed — the API is the authority; retry re-attempts the same call. No data is fabricated in the meantime.`;
  return <EmptyState title={`${surface} unavailable`} reason={reason} note={note} />;
}

/** The not-configured degradation (no demo key — the same honest pattern). */
export function AdsNotConfiguredState({ surface, reason }: { surface: string; reason: string }) {
  return (
    <EmptyState
      title={`${surface} is not configured`}
      reason={`${surface} is impossible in this studio configuration — ${reason}`}
      note="The studio renders only real Reckon API state — configure the server-side key (see apps/web/README.md) and retry; no data is fabricated in the meantime."
      actionLabel="Retry"
    />
  );
}
