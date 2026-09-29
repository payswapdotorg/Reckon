/**
 * PreferenceStore PORT (ADR-001 port/adapter law) — preference state
 * plus deltas (W1-003).
 *
 * ONE-TOPIC LAW: preference state has BOTH stable and situational
 * scopes. A situational delta (scope carrying contextKind and/or
 * contextId) NEVER writes into the stable dimension store — one topic
 * or view must not permanently redefine long-term taste.
 */
import type { Id, TenantScope, TimestampMs } from "@reckon/contracts";
import type { PreferenceDelta, SubjectReference } from "@reckon/contracts";

/** Where a delta was routed. */
export type PreferenceScopeRoute = "stable" | "situational";

/** Scope filter for `dimensions()`. Default "all". */
export type PreferenceScopeFilter = "all" | "stable" | "situational";

/** Model lineage recorded per dimension value (last-writer-wins). */
export interface ModelLineage {
  readonly modelId: string;
  readonly version: string;
}

/** A single dimension's accumulated (undecayed) state, as a view. */
export interface PreferenceDimensionView {
  readonly dimension: string;
  readonly value: number | string | boolean | null;
  readonly confidence: number;
  readonly model: ModelLineage;
  /** Timestamp of the last write (delta.timestamp, caller-supplied). */
  readonly updatedAt: TimestampMs;
  readonly deltaCount: number;
}

/** A situational dimension view additionally carries its context scope. */
export interface SituationalPreferenceDimensionView extends PreferenceDimensionView {
  readonly contextScope: {
    readonly contextKind?: string;
    readonly contextId?: Id;
  };
}

/** Snapshot of preference state for a subject at an evaluation time. */
export interface PreferenceSnapshot {
  readonly subject: SubjectReference;
  readonly tenant: TenantScope;
  /**
   * Caller-supplied evaluation time. `null` means "as accumulated" —
   * no decay/expiry filtering is applied (pure state).
   */
  readonly at: TimestampMs | null;
  readonly stable: readonly PreferenceDimensionView[];
  readonly situational: readonly SituationalPreferenceDimensionView[];
}

/** Result of `apply`. */
export interface PreferenceApplyResult {
  readonly routedScope: PreferenceScopeRoute;
  readonly dimension: string;
  /** Resulting accumulated value (post-op, pre-decay). */
  readonly value: number | string | boolean | null;
  /** Resulting accumulated confidence, clamped to [0, 1]. */
  readonly confidence: number;
  /** True when the dimension is now tombstoned (op "remove"). */
  readonly removed: boolean;
  /** True when this exact delta was already applied (idempotent). */
  readonly duplicate: boolean;
  /** Model lineage recorded for the last write. */
  readonly model: ModelLineage;
}

/** A logged, applied delta with its digest (full delta log retained). */
export interface PreferenceLogEntry {
  readonly delta: PreferenceDelta;
  readonly contentDigest: string;
  readonly routedScope: PreferenceScopeRoute;
  /** Monotonic per-store sequence (1-based). */
  readonly sequence: number;
}

/**
 * PreferenceStore PORT.
 *
 * Routing rule (structural): a delta whose `scope` carries
 * `contextKind` and/or `contextId` routes to the SITUATIONAL store;
 * a delta without those keys (including a scope with only a temporal
 * window) routes to the STABLE store. The two stores never cross.
 *
 * Decay/expiry: `snapshot(at)` computes decayed values as a PURE,
 * deterministic function of the caller-supplied time (fixed
 * timestamps replay identically). `dimensions()` and `snapshot()`
 * without `at` return the accumulated state undecayed.
 */
export interface PreferenceStore {
  /**
   * Validate (PreferenceDeltaSchema — unknown shapes rejected with a
   * typed error) and apply a delta.
   *
   * Idempotent per (tenant, deltaId): re-applying the IDENTICAL delta
   * returns the original result with `duplicate: true`; re-using the
   * deltaId with different content is a typed conflict.
   */
  apply(delta: PreferenceDelta): PreferenceApplyResult;

  /**
   * Snapshot at an evaluation time: decayed values (halfLife) and
   * expiry filtering (expiresAt / scope.validUntil) computed PURELY
   * from `at`; `at` omitted ⇒ accumulated state without temporal
   * filtering.
   */
  snapshot(subject: SubjectReference, tenant: TenantScope, at?: TimestampMs): PreferenceSnapshot;

  /** Dimension views (accumulated state). Filter by scope. */
  dimensions(
    subject: SubjectReference,
    tenant: TenantScope,
    scope?: PreferenceScopeFilter
  ): readonly (PreferenceDimensionView | SituationalPreferenceDimensionView)[];

  /**
   * Full delta log (retained verbatim, append-oriented), in apply
   * order — the audit/lineage view behind `apply`.
   */
  log(
    subject: SubjectReference,
    tenant: TenantScope,
    scope?: PreferenceScopeFilter
  ): readonly PreferenceLogEntry[];
}
