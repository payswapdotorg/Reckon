/**
 * Funnel analytics (S3-002) — PURE decisions → outcomes →
 * preference-delta funnel stage mapping, unit-tested in
 * test/analytics-funnel.test.ts. No "server-only", no env access, no
 * React (the root NodeNext typecheck covers this file through the test).
 *
 * THE FUNNEL (documented, exact semantics):
 *  - Stage 1 "decisions": decisions made through the API — unique
 *    decision ids from the decision trail (POST /v1/decisions records).
 *  - Stage 2 "outcomes": decisions with at least one OBSERVED outcome
 *    event linked back via decisionId (the decision → outcome linkage).
 *  - Stage 3 "preference-delta": preference deltas appended for subjects
 *    that have a LINKED outcome (POST /v1/preferences/events records).
 *    The frozen PreferenceDelta carries no outcome id, so stage 3 links
 *    at the SUBJECT level — a documented, correlational linkage, never
 *    presented as attribution (the caveat renders verbatim).
 *
 * EVIDENCE LAW: as everywhere in analytics, research-class outcomes
 * (fixture/simulated/counterfactual) are counted separately and EXCLUDED
 * from the linkage; unlinked outcomes (no decisionId) are counted and
 * excluded too. Rates are NULL on zero denominators — never fabricated.
 *
 * The decision + outcome trail reads are the SAME pending routes the CTR
 * view consumes (re-exported here); the preference-delta trail adds
 * GET /v1/preferences/events (append-only today — the list read is
 * pending). All are named verbatim in not-wired states.
 */

import {
  listDecisionTrail,
  listOutcomeTrail,
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
  type DecisionTrailPage,
  type DecisionTrailRecord,
  type OutcomeTrailPage,
  type OutcomeTrailRecord,
} from "./analytics-ctr-lift.js";
import { isResearchOutcomeEvidence } from "./analytics-ctr-lift.js";
import {
  attemptSurfaceCall,
  parsePaginationEnvelope,
  type FetchLike,
  type PaginationEnvelope,
  type SurfaceEndpoint,
  type SurfaceResult,
} from "./developers-api.js";
import type { EvidenceClassId } from "./evidence.js";

export { PENDING_DECISION_LIST_ROUTE, PENDING_OUTCOME_LIST_ROUTE };
export type { DecisionTrailPage, DecisionTrailRecord, OutcomeTrailPage, OutcomeTrailRecord };

/** The preference-delta trail read (append-only today; the list read is pending). */
export const PENDING_PREFERENCE_DELTA_LIST_ROUTE = "GET /v1/preferences/events";

/* ================================================================== *
 * Preference-delta trail records + strict wire guards
 * ================================================================== */

/** The frozen SubjectReference kinds (contracts/domain.ts). */
const SUBJECT_KIND_VOCABULARY = new Set<string>(["user", "audience", "account", "session"]);

/**
 * One preference-delta trail row — a structural subset of the frozen
 * PreferenceDelta (identity + subject; the fields this mapping consumes).
 */
export interface PreferenceDeltaTrailRecord {
  readonly deltaId: string;
  readonly subjectKind: string;
  readonly subjectRef: string;
}

export interface PreferenceDeltaTrailPage {
  readonly deltas: readonly PreferenceDeltaTrailRecord[];
  readonly pagination: PaginationEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asSubject(value: unknown): { kind: string; ref: string } | null {
  if (!isRecord(value)) return null;
  const kind = asNonEmptyString(value["kind"]);
  const ref = asNonEmptyString(value["ref"]);
  if (kind === null || ref === null) return null;
  if (!SUBJECT_KIND_VOCABULARY.has(kind)) return null;
  return { kind, ref };
}

export function parsePreferenceDeltaTrailRecord(value: unknown): PreferenceDeltaTrailRecord | null {
  if (!isRecord(value)) return null;
  const deltaId = asNonEmptyString(value["deltaId"]);
  const subject = asSubject(value["subject"]);
  if (deltaId === null || subject === null) return null;
  return { deltaId, subjectKind: subject.kind, subjectRef: subject.ref };
}

export function parsePreferenceDeltaTrailPage(value: unknown): PreferenceDeltaTrailPage | null {
  if (!isRecord(value) || !Array.isArray(value["data"])) return null;
  const deltas: PreferenceDeltaTrailRecord[] = [];
  for (const row of value["data"]) {
    const record = parsePreferenceDeltaTrailRecord(row);
    if (record === null) return null;
    deltas.push(record);
  }
  const pagination = parsePaginationEnvelope(value["pagination"]);
  if (pagination === null) return null;
  return { deltas, pagination };
}

/**
 * GET /v1/preferences/events — the preference-delta trail (pending;
 * named verbatim when not-wired). The decision/outcome trail fetchers
 * are re-used from the CTR module (the same data sources).
 */
export async function listPreferenceDeltaTrail(
  endpoint: SurfaceEndpoint,
  options: { readonly startingAfter?: string; readonly limit?: number },
  fetchImpl: FetchLike,
): Promise<SurfaceResult<PreferenceDeltaTrailPage>> {
  const params = new URLSearchParams();
  if (options.startingAfter !== undefined && options.startingAfter.length > 0) {
    params.set("starting_after", options.startingAfter);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const result = await attemptSurfaceCall(endpoint, PENDING_PREFERENCE_DELTA_LIST_ROUTE, `/v1/preferences/events${query}`, { method: "GET" }, fetchImpl);
  if (!result.ok) return result;
  const page = parsePreferenceDeltaTrailPage(result.body);
  if (page === null) {
    return {
      ok: false,
      failure: {
        outcome: "error",
        detail:
          `${PENDING_PREFERENCE_DELTA_LIST_ROUTE} answered 200 but the body did not match the expected ` +
          `S2-001 list envelope with preference-delta rows ({ data: [{ deltaId, subject: { kind, ref } }, …], pagination }) — ` +
          `the response was withheld rather than guessed.`,
        pendingRoute: PENDING_PREFERENCE_DELTA_LIST_ROUTE,
        httpStatus: 200,
      },
    };
  }
  return { ok: true, data: page };
}

export { listDecisionTrail, listOutcomeTrail };

/* ================================================================== *
 * Funnel stage mapping
 * ================================================================== */

export const FUNNEL_STAGE_IDS = ["decisions", "outcomes", "preference-delta"] as const;
export type FunnelStageId = (typeof FUNNEL_STAGE_IDS)[number];

export const FUNNEL_STAGE_LABELS: Record<FunnelStageId, string> = {
  decisions: "Decisions",
  outcomes: "Linked outcomes",
  "preference-delta": "Preference deltas",
};

export const FUNNEL_STAGE_DESCRIPTIONS: Record<FunnelStageId, string> = {
  decisions: "Decisions made through the API (POST /v1/decisions).",
  outcomes: "Decisions with at least one observed outcome linked back via decisionId.",
  "preference-delta": "Preference deltas appended for subjects with a linked outcome (subject-level linkage).",
};

export interface FunnelCounts {
  /** Unique decision ids in the trail (stage 1). */
  readonly decisions: number;
  /** Decisions with ≥1 observed linked outcome (stage 2). */
  readonly decisionsWithOutcome: number;
  /** Preference deltas whose subject has a linked outcome (stage 3). */
  readonly deltasForSubjects: number;
  /** Observed outcomes without a decisionId — unattributable, excluded. */
  readonly unlinkedOutcomes: number;
  /** Research-class outcomes — counted, excluded from the linkage. */
  readonly researchOutcomes: number;
  /** Deltas whose subject has NO linked outcome — outside the funnel. */
  readonly deltasWithoutOutcomeSubject: number;
}

/**
 * Map the REAL records to funnel stage counts. Pure and deterministic:
 * unique ids only, observed-evidence outcomes only for the linkage, and
 * the stage-3 subject match keyed by `kind|ref`.
 */
export function funnelCounts(
  decisions: readonly DecisionTrailRecord[],
  outcomes: readonly OutcomeTrailRecord[],
  deltas: readonly PreferenceDeltaTrailRecord[],
): FunnelCounts {
  const decisionIds = new Set<string>();
  for (const decision of decisions) {
    decisionIds.add(decision.decisionId);
  }

  let unlinkedOutcomes = 0;
  let researchOutcomes = 0;
  const decisionsWithOutcome = new Set<string>();
  const linkedSubjects = new Set<string>();
  for (const outcome of outcomes) {
    if (isResearchOutcomeEvidence(outcome.evidenceClass)) {
      researchOutcomes += 1;
      continue;
    }
    if (outcome.decisionId === null) {
      unlinkedOutcomes += 1;
      continue;
    }
    decisionsWithOutcome.add(outcome.decisionId);
    linkedSubjects.add(`${outcome.subjectKind}|${outcome.subjectRef}`);
  }

  const seenDeltaIds = new Set<string>();
  let deltasForSubjects = 0;
  let deltasWithoutOutcomeSubject = 0;
  for (const delta of deltas) {
    if (seenDeltaIds.has(delta.deltaId)) {
      continue;
    }
    seenDeltaIds.add(delta.deltaId);
    if (linkedSubjects.has(`${delta.subjectKind}|${delta.subjectRef}`)) {
      deltasForSubjects += 1;
    } else {
      deltasWithoutOutcomeSubject += 1;
    }
  }

  return {
    decisions: decisionIds.size,
    decisionsWithOutcome: decisionsWithOutcome.size,
    deltasForSubjects,
    unlinkedOutcomes,
    researchOutcomes,
    deltasWithoutOutcomeSubject,
  };
}

export interface FunnelStageView {
  readonly id: FunnelStageId;
  readonly label: string;
  readonly description: string;
  readonly count: number;
  /** count / decisions × 100, one decimal — null when stage 1 is empty. */
  readonly shareOfFirstPct: number | null;
  /** count / previous-stage count × 100, one decimal — null when the previous stage is empty. */
  readonly shareOfPreviousPct: number | null;
}

/** Stage views with honest rates (null on zero denominators). */
export function funnelStages(counts: FunnelCounts): readonly FunnelStageView[] {
  const values = [counts.decisions, counts.decisionsWithOutcome, counts.deltasForSubjects];
  const previousCounts = [counts.decisions, counts.decisionsWithOutcome];
  return FUNNEL_STAGE_IDS.map((id, index) => {
    const count = values[index] ?? 0;
    const previous = previousCounts[index - 1] ?? null;
    return {
      id,
      label: FUNNEL_STAGE_LABELS[id],
      description: FUNNEL_STAGE_DESCRIPTIONS[id],
      count,
      shareOfFirstPct:
        counts.decisions > 0 ? Math.round((count / counts.decisions) * 1000) / 10 : null,
      shareOfPreviousPct:
        previous !== null && previous > 0 ? Math.round((count / previous) * 1000) / 10 : null,
    };
  });
}

/* ================================================================== *
 * Caveats (deterministic from the counts)
 * ================================================================== */

export interface FunnelCaveat {
  readonly id: string;
  readonly sentence: string;
}

export function funnelCaveats(counts: FunnelCounts): readonly FunnelCaveat[] {
  const caveats: FunnelCaveat[] = [
    {
      id: "subject-level-linkage",
      sentence:
        "Stage 3 links preference deltas to outcomes at the SUBJECT level (the frozen PreferenceDelta carries no outcome id) — a delta here is correlated with outcomes, not attributed to one.",
    },
  ];
  if (counts.decisions === 0) {
    caveats.push({
      id: "empty-first-stage",
      sentence: "No decisions are in the window — the funnel has no first stage, so every rate is withheld.",
    });
  } else {
    if (counts.decisionsWithOutcome === 0) {
      caveats.push({
        id: "zero-denominator",
        sentence: "The linked-outcomes stage is empty, so the preference-delta step rate is withheld.",
      });
    }
  }
  if (counts.researchOutcomes > 0) {
    caveats.push({
      id: "research-evidence-excluded",
      sentence: `${counts.researchOutcomes} outcome(s) carry research evidence classes (fixture/simulated/counterfactual) — counted here, excluded from the linkage.`,
    });
  }
  if (counts.unlinkedOutcomes > 0) {
    caveats.push({
      id: "unlinked-outcomes-excluded",
      sentence: `${counts.unlinkedOutcomes} observed outcome(s) carry no decisionId — unattributable, excluded from the linkage.`,
    });
  }
  if (counts.deltasWithoutOutcomeSubject > 0) {
    caveats.push({
      id: "deltas-outside-funnel",
      sentence: `${counts.deltasWithoutOutcomeSubject} preference delta(s) belong to subjects without a linked outcome — they sit outside this funnel.`,
    });
  }
  return caveats;
}

/* ================================================================== *
 * View model (built ONLY from real fetched records → evidence "observed")
 * ================================================================== */

export interface FunnelView {
  readonly evidenceClass: EvidenceClassId;
  readonly stages: readonly FunnelStageView[];
  readonly exclusionLabels: readonly { readonly label: string; readonly value: string }[];
  readonly caveats: readonly FunnelCaveat[];
}

/** Render-ready view model over the funnel counts (evidence: observed). */
export function funnelView(counts: FunnelCounts): FunnelView {
  const stages = funnelStages(counts);
  return {
    evidenceClass: "observed",
    stages,
    exclusionLabels: [
      { label: "Unlinked outcomes (excluded)", value: String(counts.unlinkedOutcomes) },
      { label: "Research outcomes (excluded)", value: String(counts.researchOutcomes) },
      { label: "Deltas outside the funnel", value: String(counts.deltasWithoutOutcomeSubject) },
    ],
    caveats: funnelCaveats(counts),
  };
}
