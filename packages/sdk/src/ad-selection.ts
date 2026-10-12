/**
 * @reckon/sdk — AD-004 host-side ad-selection composition helpers.
 *
 * PURE functions over the FROZEN contracts (no transport, no kernel
 * imports, no persistence shapes — the SDK's thin-contract law):
 *
 * - `buildAdBearingCandidates` — the host-facing helper for declaring ad
 *   candidacy alongside organic candidates in ONE DecisionRequest:
 *   gate an AD-003 `AdQueryResult`'s lanes at the caller clock (law 3),
 *   map the gated-in ads to `CandidateReference`s carrying the frozen
 *   ad-lane `source` vocabulary (law 9 provenance; the same mapping
 *   semantics as the contracts' `adCandidatesToCandidateSet` —
 *   positional `rankHint`, best `scoreHint`), collect the ad items /
 *   realizations / projected per-item constraints the decision path
 *   needs, and merge with the organic candidate set. NO ranking happens
 *   here: retrieval hints are hints; ranking authority stays with the
 *   decision kernel (ADR-005 "no parallel ad-ranking contract").
 *
 * - `adUserValueRewardTerm` — the documented bridge from host-declared
 *   ad user value (law 7: USER value, never commercial value) into the
 *   policy engine's EXISTING per-experience declared-value channel: a
 *   `RewardTerm` whose `params.values` keys the RESOLVED experience ids
 *   (obtained from `reckon.experiences.resolve` over the ad items +
 *   realizations this helper returns) to the ads' declared user-value
 *   scores. The host merges the term into their request's reward spec;
 *   nothing is invented (absent evidence stays absent and is disclosed
 *   by the policy engine's uncertainty channel).
 *
 * DETERMINISM: both helpers are pure and clock-free except for the
 * CALLER-supplied `at`/declared values; identical inputs yield
 * byte-identical outputs.
 */
import {
  AD_CANDIDATE_SOURCES,
  CandidateSetSchema,
  adEligibilityToConstraints,
  isAdAvailableAt,
  isAdCandidateCurrentlyAvailable,
  type AdQueryResult,
  type AdRetrievalReason,
  type AdUserValueAssessment,
  type CandidateReference,
  type CandidateSet,
  type CatalogItem,
  type HardConstraint,
  type Realization,
  type RewardTerm,
  type TimestampMs,
} from "@reckon/contracts";

/** A candidate source that declares ad candidacy (the frozen ad-lane vocabulary). */
export const AD_CANDIDATE_SOURCE_VALUES = [
  AD_CANDIDATE_SOURCES.remembered,
  AD_CANDIDATE_SOURCES.available,
] as const;

/** Does a candidate source declare ad candidacy? (Mirrors the API-side check.) */
export function isAdCandidateSource(source: string): boolean {
  return source === AD_CANDIDATE_SOURCES.remembered || source === AD_CANDIDATE_SOURCES.available;
}

/** The gated output of one ad query result's lanes at a caller clock. */
export interface AdCandidacySelection {
  /** The ad candidates (provenance-carrying `CandidateReference`s) that passed the selection gates. */
  readonly candidates: readonly CandidateReference[];
  /** The ads' catalog items (deduped by itemId; remembered lane first). */
  readonly items: readonly CatalogItem[];
  /** The ads' realizations (deduped by realizationId). */
  readonly realizations: readonly Realization[];
  /**
   * Per-item hard constraints projected from declared ad eligibility
   * (`adEligibilityToConstraints`): flight window → `time-window`,
   * gates → `policy-rights`. Lanes UNION their projections (two
   * time-window constraints AND together — the honest intersection).
   */
  readonly itemConstraints: Readonly<Record<string, readonly HardConstraint[]>>;
  /** Declared ad USER value by itemId (law 7 — user value, never commercial). */
  readonly userValueByItemId: Readonly<Record<string, AdUserValueAssessment>>;
  /** Honest disclosures: every gate exclusion, with its reason. */
  readonly notes: readonly string[];
}

/**
 * Gate an AD-003 ad query result's lanes at the CALLER-supplied clock
 * (law 3: expired ≠ currently available — remembered ads must pass
 * `isAdAvailableAt`, provider-supplied ads must pass
 * `isAdCandidateCurrentlyAvailable`) and collect the candidacy truth.
 * Deterministic; NO ranking (lane order is preserved verbatim; hints are
 * the same retrieval hints the contracts' own mapping emits).
 */
export function selectAdCandidacy(
  result: Pick<AdQueryResult, "remembered" | "available">,
  at: TimestampMs,
): AdCandidacySelection {
  const candidates: CandidateReference[] = [];
  const itemsById = new Map<string, CatalogItem>();
  const realizationsById = new Map<string, Realization>();
  const itemConstraints: Record<string, readonly HardConstraint[]> = {};
  const userValueByItemId: Record<string, AdUserValueAssessment> = {};
  const notes: string[] = [];

  let rank = 1;
  for (const candidate of result.remembered) {
    if (!isAdAvailableAt(candidate.record.ad, at)) {
      notes.push(
        `remembered ad ${candidate.record.ad.itemId} excluded: the ad's own catalog window is closed at the selection clock (at ${at})`,
      );
      continue;
    }
    // Same mapping semantics as the contracts' adCandidatesToCandidateSet.
    candidates.push({
      itemId: candidate.record.ad.itemId,
      realizationIds: candidate.record.realizations.map((r) => r.realizationId),
      source: AD_CANDIDATE_SOURCES.remembered,
      rankHint: rank++,
      ...(maxRetrievalScore(candidate.whyRetrieved) !== undefined
        ? { scoreHint: maxRetrievalScore(candidate.whyRetrieved) }
        : {}),
    });
    collectAdTruth(candidate.record.ad, candidate.record.realizations, candidate.eligibility, undefined);
  }
  for (const candidate of result.available) {
    if (!isAdCandidateCurrentlyAvailable(candidate, at)) {
      notes.push(
        `provider-supplied ad ${candidate.ad.itemId} excluded: the availability window was closed at the selection clock (at ${at})`,
      );
      continue;
    }
    candidates.push({
      itemId: candidate.ad.itemId,
      realizationIds: candidate.realizations.map((r) => r.realizationId),
      source: AD_CANDIDATE_SOURCES.available,
      rankHint: rank++,
      ...(maxRetrievalScore(candidate.whyRetrieved) !== undefined
        ? { scoreHint: maxRetrievalScore(candidate.whyRetrieved) }
        : {}),
    });
    collectAdTruth(candidate.ad, candidate.realizations, candidate.eligibility, candidate.userValue);
  }

  return {
    candidates,
    items: [...itemsById.values()],
    realizations: [...realizationsById.values()],
    itemConstraints,
    userValueByItemId,
    notes,
  };

  function collectAdTruth(
    ad: CatalogItem,
    realizations: readonly Realization[],
    eligibility: Parameters<typeof adEligibilityToConstraints>[0] | undefined,
    userValue: AdUserValueAssessment | undefined,
  ): void {
    if (!itemsById.has(ad.itemId)) itemsById.set(ad.itemId, ad);
    for (const realization of realizations) {
      if (!realizationsById.has(realization.realizationId)) {
        realizationsById.set(realization.realizationId, realization);
      }
    }
    if (eligibility !== undefined) {
      const projected = adEligibilityToConstraints(eligibility);
      if (projected.length > 0) {
        itemConstraints[ad.itemId] = unionConstraints(itemConstraints[ad.itemId] ?? [], projected);
      }
    }
    if (userValue !== undefined && userValueByItemId[ad.itemId] === undefined) {
      userValueByItemId[ad.itemId] = userValue;
    }
  }
}

/** The merged, decision-ready output for one ad-bearing request. */
export interface AdBearingCandidates {
  /** ONE candidate set: organic candidates + gated-in ad candidates (validated through the frozen schema). */
  readonly candidateSet: CandidateSet;
  /** Ad items for the request's host truth (deduped; feed the decision's catalog truth or `experiences.resolve`). */
  readonly items: readonly CatalogItem[];
  /** Ad realizations (deduped). */
  readonly realizations: readonly Realization[];
  /** Per-item constraints projected from declared ad eligibility. */
  readonly itemConstraints: Readonly<Record<string, readonly HardConstraint[]>>;
  /** Declared ad USER value by itemId (for `adUserValueRewardTerm`). */
  readonly userValueByItemId: Readonly<Record<string, AdUserValueAssessment>>;
  /** Honest disclosures (gate exclusions + merge notes). */
  readonly notes: readonly string[];
}

/**
 * Build the ad-bearing candidate set for a DecisionRequest: gate the ad
 * query result's lanes at the caller clock, map the gated-in ads to
 * provenance-carrying candidate references, and merge them with the
 * organic candidate set into ONE set (the request's single candidate
 * universe — the decision kernel scores ads and organic candidates in
 * the SAME pipeline; there is no ad ranking here).
 *
 * The organic set may be omitted (ads-only). Throws a typed error when
 * the merged set would be empty (the frozen CandidateSet requires at
 * least one candidate — mirroring the contracts' own mapping).
 */
export function buildAdBearingCandidates(input: {
  /** The merged set's id (caller-chosen, stable for idempotent requests). */
  readonly setId: string;
  /**
   * The organic candidate set (optional — ads-only requests omit it).
   * Only `candidates` (and `provenance`) are consumed; an organic set's
   * own `setId` is ignored in favor of the merged `setId`.
   */
  readonly organic?: CandidateSet;
  /** The AD-003 query result (`reckon.ads.query` output). */
  readonly adQueryResult: Pick<AdQueryResult, "remembered" | "available">;
  /** The caller-supplied evaluation clock (law 3 — REQUIRED). */
  readonly at: TimestampMs;
}): AdBearingCandidates {
  const selection = selectAdCandidacy(input.adQueryResult, input.at);
  const notes = [...selection.notes];
  if (selection.candidates.length === 0) {
    notes.push("the ad query result yielded no currently-eligible ad candidates at the selection clock");
  }
  const merged = [
    ...(input.organic?.candidates ?? []),
    ...selection.candidates,
  ];
  const parsed = CandidateSetSchema.safeParse({
    setId: input.setId,
    candidates: merged,
    ...(input.organic?.provenance !== undefined ? { provenance: input.organic.provenance } : {}),
  });
  if (!parsed.success) {
    throw new TypeError(
      `buildAdBearingCandidates: the merged candidate set failed the frozen CandidateSet contract (${parsed.error.issues
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("; ")}) — a candidate set requires at least one candidate`,
    );
  }
  return {
    candidateSet: parsed.data,
    items: selection.items,
    realizations: selection.realizations,
    itemConstraints: selection.itemConstraints,
    userValueByItemId: selection.userValueByItemId,
    notes,
  };
}

/**
 * Build the ad USER-value reward term (the documented bridge into the
 * policy engine's EXISTING per-experience declared-value channel — law 7:
 * user value only, commercial value has NO ranking path by design).
 *
 * `experiences` are the RESOLVED ad experiences (from
 * `reckon.experiences.resolve` over the ad items + realizations
 * `buildAdBearingCandidates` returns); every experience whose itemId has
 * a declared user value contributes `params.values[experienceId] = score`
 * (clamped to [0,1]). Experiences without declared user value are simply
 * absent from the values map — the policy engine treats the term as
 * unevaluated for them and discloses it via uncertainty (never guessed).
 *
 * Returns null when no resolved experience carries declared user value
 * (nothing to declare — no empty reward term is invented).
 */
export function adUserValueRewardTerm(input: {
  /** Resolved ad experiences (e.g. `reckon.experiences.resolve` output). */
  readonly experiences: readonly { readonly experienceId: string; readonly itemId: string }[];
  /** Declared ad user value by itemId (`buildAdBearingCandidates` output). */
  readonly userValueByItemId: Readonly<Record<string, AdUserValueAssessment>>;
  /** Reward term id (default "reckon.ad.user-value"). */
  readonly termId?: string;
  /** Reward term version (default "1"). */
  readonly version?: string;
  /** Term weight (default 1). */
  readonly weight?: number;
}): RewardTerm | null {
  const values: Record<string, number> = {};
  for (const experience of input.experiences) {
    const userValue = input.userValueByItemId[experience.itemId];
    if (userValue === undefined) continue;
    const score = Math.min(1, Math.max(0, userValue.score));
    values[experience.experienceId] = score;
  }
  if (Object.keys(values).length === 0) return null;
  return {
    termId: input.termId ?? "reckon.ad.user-value",
    version: input.version ?? "1",
    kind: "satisfaction-proxy",
    weight: input.weight ?? 1,
    params: { values },
  };
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

function maxRetrievalScore(reasons: readonly AdRetrievalReason[]): number | undefined {
  let max: number | undefined;
  for (const reason of reasons) {
    if (reason.score !== undefined && (max === undefined || reason.score > max)) {
      max = reason.score;
    }
  }
  return max;
}

/** Deterministic constraint-list union (dedup by canonical key, order-preserving). */
function unionConstraints(
  existing: readonly HardConstraint[] | undefined,
  incoming: readonly HardConstraint[],
): HardConstraint[] {
  const base = existing ?? [];
  const seen = new Set<string>(base.map(canonicalConstraintKey));
  const out: HardConstraint[] = [...base];
  for (const constraint of incoming) {
    const key = canonicalConstraintKey(constraint);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(constraint);
  }
  return out;
}

function canonicalConstraintKey(constraint: HardConstraint): string {
  const entries = Object.entries(constraint as unknown as Record<string, unknown>)
    .filter(([key]) => key !== "kind")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .sort();
  return [constraint.kind, ...entries].join("|");
}
