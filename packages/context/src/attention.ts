/**
 * Derived attention view (W1-002) — a PURE function of a
 * `ContextSnapshot`: an available-attention estimate combining the
 * snapshot's `attention` block with its `fatigue` signals.
 *
 * Rules honored:
 * - Pure and deterministic: no clock, no store, no side effects.
 * - The host's `attention.quality` classification is reported
 *   verbatim (typed enum) — never silently reclassified.
 * - Fatigue only ADJUSTS the magnitude estimate and is reported
 *   separately; it can never fully erase attention (capped at 0.9) and
 *   never invents an estimate where the host supplied none.
 */
import type { ContextSnapshot } from "@reckon/contracts";

export type AttentionQuality =
  | "full"
  | "partial"
  | "background"
  | "interrupted"
  | "unknown";

/** Derived, point-in-time view of available attention. */
export interface AttentionView {
  /** True when the snapshot carried an `attention` block at all. */
  readonly estimated: boolean;
  /** Host-supplied available-attention budget (ms), or null when not estimated. */
  readonly availableMs: number | null;
  /** Host-supplied quality classification, verbatim (typed enum). */
  readonly quality: AttentionQuality;
  /**
   * Deterministic fatigue penalty in [0, 0.9]:
   * 0.6 * clamp(repetitionLevel, 0, 1) + 0.4 * min(recentInterruptions / 10, 1),
   * clamped to at most 0.9.
   */
  readonly fatiguePenalty: number;
  /**
   * availableMs scaled by (1 - fatiguePenalty); null when availableMs
   * is null.
   */
  readonly adjustedAvailableMs: number | null;
}

/** Upper bound for the fatigue penalty — fatigue alone never fully zeroes attention. */
export const MAX_FATIGUE_PENALTY = 0.9;

/** Interruption count that saturates the interruption component. */
export const INTERRUPTION_SATURATION = 10;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Derive the attention view from a context snapshot.
 *
 * ```ts
 * const view = deriveAttentionView(snapshot);
 * ```
 */
export function deriveAttentionView(snapshot: ContextSnapshot): AttentionView {
  const attention = snapshot.attention;
  const fatigue = snapshot.fatigue;

  const repetition = fatigue?.repetitionLevel !== undefined ? clamp01(fatigue.repetitionLevel) : 0;
  const interruptions =
    fatigue?.recentInterruptions !== undefined ? fatigue.recentInterruptions : 0;
  const interruptionComponent = Math.min(interruptions / INTERRUPTION_SATURATION, 1);
  const rawPenalty = 0.6 * repetition + 0.4 * interruptionComponent;
  const fatiguePenalty = Math.min(rawPenalty, MAX_FATIGUE_PENALTY);

  const estimated = attention !== undefined;
  const availableMs = attention?.availableMs !== undefined ? attention.availableMs : null;
  const quality: AttentionQuality = attention?.quality ?? "unknown";
  const adjustedAvailableMs =
    availableMs !== null ? availableMs * (1 - fatiguePenalty) : null;

  return {
    estimated,
    availableMs,
    quality,
    fatiguePenalty,
    adjustedAvailableMs,
  };
}
