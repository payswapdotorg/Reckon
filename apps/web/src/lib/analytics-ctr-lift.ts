/**
 * CTR-lift analytics (S3-002) — PURE, dependency-free computation over the
 * REAL outcome/decision records the Reckon API exposes, unit-tested in
 * test/analytics-ctr-lift.test.ts. No "server-only", no env access, no
 * React (the root NodeNext typecheck covers this file through the test).
 *
 * WHAT IT COMPUTES (documented, exact semantics):
 *  - Exposure grouping: a decision is EXPOSED when at least one OBSERVED
 *    `impression` outcome links back to it via `decisionId` (the decision →
 *    impression linkage); every other decision is UNEXPOSED (decided, but
 *    no confirmed delivery).
 *  - Engagement: a decision ENGAGED when at least one OBSERVED click-through
 *    outcome (`start`, `conversion`, `purchase` — a named, documented subset
 *    of the frozen OUTCOME_EVENT_TYPES vocabulary) links back to it, at or
 *    after the first impression's `occurredAt` in the exposed group.
 *  - CTR per group = engaged decisions / group decisions, with a Wilson
 *    score 95% interval (explainable, dependency-free).
 *  - LIFT = exposed CTR vs the unexposed baseline: absolute difference in
 *    percentage points and the ratio — NULL (never fabricated) whenever a
 *    denominator is zero.
 *  - CONFIDENCE CAVEAT RENDERING MODEL: every caveat is a deterministic
 *    function of the result — observational (exposure is not randomized),
 *    small-sample, empty-baseline, zero-baseline-CTR, research-evidence
 *    exclusions, unlinked-outcome exclusions. The UI renders these
 *    verbatim; it never invents reassurance (Gate Q).
 *
 * EVIDENCE LAW (frozen contracts, outcomes.ts): outcome events carry a
 * typed evidenceClass; `simulated` / `counterfactual` / `fixture` outcomes
 * can never masquerade as observed production evidence. This module
 * partitions outcomes BEFORE computing: observed classes feed the rates,
 * research classes are counted and reported separately — never mixed in.
 *
 * WIRE SHAPES: the pending list reads follow the S2-001 envelope
 * (`{ data: [...], pagination: { has_more, next_cursor } }`). Record guards
 * are strict mirrors of the frozen contract fields this view consumes — a
 * 200 body that does not match is an ERROR outcome (withheld rather than
 * guessed), exactly the developers-api.ts law.
 */

import {
  attemptSurfaceCall,
  parsePaginationEnvelope,
  type FetchLike,
  type PaginationEnvelope,
  type SurfaceEndpoint,
  type SurfaceResult,
} from "./developers-api.js";
import type { EvidenceClassId } from "./evidence.js";

/* ================================================================== *
 * Pending analytics routes (named verbatim in honest states)
 * ================================================================== */

/**
 * The decision-trail read the CTR view needs. The API exposes
 * POST /v1/decisions and GET /v1/decisions/{id} only — a list read does
 * not exist yet, so this route is pending and named in not-wired states.
 */
export const PENDING_DECISION_LIST_ROUTE = "GET /v1/decisions";

/**
 * The outcome-trail read. Outcomes are append-only through the public API
 * (POST /v1/outcomes); no list/read surface exists yet.
 */
export const PENDING_OUTCOME_LIST_ROUTE = "GET /v1/outcomes";

/* ================================================================== *
 * Frozen-vocabulary mirrors (documented subsets of the contracts)
 * ================================================================== */

/** The exposure event: the recommendation became user-visible. */
export const IMPRESSION_EVENT_TYPE = "impression";

/**
 * The click-through set — the frozen OUTCOME_EVENT_TYPES this view counts
 * as a click-through on a recommendation ("start" = the subject began the
 * recommended experience; "conversion"/"purchase" = the deeper funnel).
 * Hosts wanting a different definition change this set, never the data.
 */
export const CLICK_THROUGH_EVENT_TYPES: readonly string[] = ["start", "conversion", "purchase"];

/**
 * The frozen OutcomeEvent evidence vocabulary (contracts/primitives.ts
 * EVIDENCE_CLASSES). Rows outside this vocabulary are rejected by the
 * wire guard — never silently relabeled.
 */
const OUTCOME_EVIDENCE_VOCABULARY = new Set<string>([
  "production-observed",
  "staging",
  "controlled-local",
  "fixture",
  "simulated",
  "counterfactual",
]);

/**
 * Observed-class outcomes usable as production CTR evidence (the frozen
 * OBSERVED_EVIDENCE_CLASSES mirror, contracts/outcomes.ts).
 */
export const OBSERVED_OUTCOME_EVIDENCE_CLASSES: readonly string[] = [
  "production-observed",
  "staging",
  "controlled-local",
];

/**
 * Research-class outcomes that can NEVER enter the production rates
 * (the frozen RESEARCH_EVIDENCE_CLASSES mirror). Counted, reported
 * separately, excluded.
 */
export const RESEARCH_OUTCOME_EVIDENCE_CLASSES: readonly string[] = [
  "fixture",
  "simulated",
  "counterfactual",
];

/**
 * The frozen OUTCOME_EVENT_TYPES vocabulary (contracts/outcomes.ts) —
 * the wire guard accepts exactly these eventType values.
 */
const OUTCOME_EVENT_TYPE_VOCABULARY = new Set<string>([
  "impression",
  "start",
  "completion",
  "abandonment",
  "seek",
  "skip",
  "save",
  "share",
  "purchase",
  "conversion",
  "explicit-feedback",
  "interruption-accept",
  "interruption-reject",
  "return",
  "resume",
  "context-transition",
  "correction",
  "custom",
]);

/** The frozen SubjectReference kinds (contracts/domain.ts). */
const SUBJECT_KIND_VOCABULARY = new Set<string>(["user", "audience", "account", "session"]);

export function isObservedOutcomeEvidence(evidenceClass: string): boolean {
  return OBSERVED_OUTCOME_EVIDENCE_CLASSES.includes(evidenceClass);
}

export function isResearchOutcomeEvidence(evidenceClass: string): boolean {
  return RESEARCH_OUTCOME_EVIDENCE_CLASSES.includes(evidenceClass);
}

export function isClickThroughEventType(eventType: string): boolean {
  return CLICK_THROUGH_EVENT_TYPES.includes(eventType);
}

/* ================================================================== *
 * Trail records + strict wire guards (the S2-001 list envelope)
 * ================================================================== */

/**
 * One decision-trail row — a structural subset of the frozen
 * DecisionResult (the fields this view consumes). The full contract row
 * is tolerated; only the required fields are projected.
 */
export interface DecisionTrailRecord {
  readonly decisionId: string;
}

/**
 * One outcome-trail row — a structural subset of the frozen OutcomeEvent:
 * the linkage (decisionId), the type vocabulary, occurrence time, the
 * evidence class and the subject (used by the funnel stage mapping).
 */
export interface OutcomeTrailRecord {
  readonly eventId: string;
  /** The decision → impression linkage; null = unlinked (cannot be attributed). */
  readonly decisionId: string | null;
  readonly eventType: string;
  readonly occurredAt: number;
  readonly evidenceClass: string;
  readonly subjectKind: string;
  readonly subjectRef: string;
}

export interface DecisionTrailPage {
  readonly decisions: readonly DecisionTrailRecord[];
  readonly pagination: PaginationEnvelope;
}

export interface OutcomeTrailPage {
  readonly outcomes: readonly OutcomeTrailRecord[];
  readonly pagination: PaginationEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asEvidenceClass(value: unknown): string | null {
  return typeof value === "string" && OUTCOME_EVIDENCE_VOCABULARY.has(value) ? value : null;
}

function asOutcomeEventType(value: unknown): string | null {
  return typeof value === "string" && OUTCOME_EVENT_TYPE_VOCABULARY.has(value) ? value : null;
}

/** A decision id: non-empty string (opaque to the dashboard). */
function asDecisionId(value: unknown): string | null {
  return asNonEmptyString(value);
}

/** The frozen SubjectReference { kind, ref } shape, projected to flat fields. */
function asSubject(value: unknown): { kind: string; ref: string } | null {
  if (!isRecord(value)) return null;
  const kind = asNonEmptyString(value["kind"]);
  const ref = asNonEmptyString(value["ref"]);
  if (kind === null || ref === null) return null;
  if (!SUBJECT_KIND_VOCABULARY.has(kind)) return null;
  return { kind, ref };
}

export function parseDecisionTrailRecord(value: unknown): DecisionTrailRecord | null {
  if (!isRecord(value)) return null;
  const decisionId = asDecisionId(value["decisionId"]);
  if (decisionId === null) return null;
  return { decisionId };
}

export function parseDecisionTrailPage(value: unknown): DecisionTrailPage | null {
  if (!isRecord(value) || !Array.isArray(value["data"])) return null;
  const decisions: DecisionTrailRecord[] = [];
  for (const row of value["data"]) {
    const record = parseDecisionTrailRecord(row);
    if (record === null) return null;
    decisions.push(record);
  }
  const pagination = parsePaginationEnvelope(value["pagination"]);
  if (pagination === null) return null;
  return { decisions, pagination };
}

export function parseOutcomeTrailRecord(value: unknown): OutcomeTrailRecord | null {
  if (!isRecord(value)) return null;
  const eventId = asNonEmptyString(value["eventId"]);
  const eventType = asOutcomeEventType(value["eventType"]);
  const occurredAt = asFiniteNumber(value["occurredAt"]);
  const evidenceClass = asEvidenceClass(value["evidenceClass"]);
  const subject = asSubject(value["subject"]);
  if (eventId === null || eventType === null || occurredAt === null || evidenceClass === null || subject === null) {
    return null;
  }
  const decisionId = value["decisionId"] === undefined || value["decisionId"] === null ? null : asDecisionId(value["decisionId"]);
  if (decisionId === null && value["decisionId"] !== undefined && value["decisionId"] !== null) {
    return null;
  }
  return {
    eventId,
    decisionId,
    eventType,
    occurredAt,
    evidenceClass,
    subjectKind: subject.kind,
    subjectRef: subject.ref,
  };
}

export function parseOutcomeTrailPage(value: unknown): OutcomeTrailPage | null {
  if (!isRecord(value) || !Array.isArray(value["data"])) return null;
  const outcomes: OutcomeTrailRecord[] = [];
  for (const row of value["data"]) {
    const record = parseOutcomeTrailRecord(row);
    if (record === null) return null;
    outcomes.push(record);
  }
  const pagination = parsePaginationEnvelope(value["pagination"]);
  if (pagination === null) return null;
  return { outcomes, pagination };
}

/* ================================================================== *
 * Surface attempts (inject your own fetch in tests — the developers-api law)
 * ================================================================== */

function trailQuery(options: { readonly startingAfter?: string; readonly limit?: number }): string {
  const params = new URLSearchParams();
  if (options.startingAfter !== undefined && options.startingAfter.length > 0) {
    params.set("starting_after", options.startingAfter);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  return params.size > 0 ? `?${params.toString()}` : "";
}

function trailShapeError(pendingRoute: string, expected: string) {
  return {
    ok: false as const,
    failure: {
      outcome: "error" as const,
      detail:
        `${pendingRoute} answered 200 but the body did not match the expected ` +
        `${expected} — the response was withheld rather than guessed.`,
      pendingRoute,
      httpStatus: 200,
    },
  };
}

/** GET /v1/decisions — the decision trail (pending; named verbatim when not-wired). */
export async function listDecisionTrail(
  endpoint: SurfaceEndpoint,
  options: { readonly startingAfter?: string; readonly limit?: number },
  fetchImpl: FetchLike,
): Promise<SurfaceResult<DecisionTrailPage>> {
  const query = trailQuery(options);
  const result = await attemptSurfaceCall(endpoint, PENDING_DECISION_LIST_ROUTE, `/v1/decisions${query}`, { method: "GET" }, fetchImpl);
  if (!result.ok) return result;
  const page = parseDecisionTrailPage(result.body);
  if (page === null) {
    return trailShapeError(PENDING_DECISION_LIST_ROUTE, "S2-001 list envelope with decision rows ({ data: [{ decisionId }, …], pagination })");
  }
  return { ok: true, data: page };
}

/** GET /v1/outcomes — the outcome trail (pending; named verbatim when not-wired). */
export async function listOutcomeTrail(
  endpoint: SurfaceEndpoint,
  options: { readonly startingAfter?: string; readonly limit?: number },
  fetchImpl: FetchLike,
): Promise<SurfaceResult<OutcomeTrailPage>> {
  const query = trailQuery(options);
  const result = await attemptSurfaceCall(endpoint, PENDING_OUTCOME_LIST_ROUTE, `/v1/outcomes${query}`, { method: "GET" }, fetchImpl);
  if (!result.ok) return result;
  const page = parseOutcomeTrailPage(result.body);
  if (page === null) {
    return trailShapeError(PENDING_OUTCOME_LIST_ROUTE, "S2-001 list envelope with outcome rows ({ data: [{ eventId, decisionId?, eventType, occurredAt, evidenceClass, subject }], pagination })");
  }
  return { ok: true, data: page };
}

/* ================================================================== *
 * Wilson score interval (dependency-free, 95% by default)
 * ================================================================== */

export const WILSON_Z_95 = 1.96;

/**
 * The Wilson score interval for a binomial proportion — deterministic,
 * documented, no dependencies. Null when total <= 0 or successes fall
 * outside [0, total] (never a fabricated interval).
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z: number = WILSON_Z_95,
): { readonly low: number; readonly high: number } | null {
  if (total <= 0 || successes < 0 || successes > total || !Number.isFinite(z) || z <= 0) {
    return null;
  }
  const z2 = z * z;
  const p = successes / total;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  return { low: Math.max(0, center - spread), high: Math.min(1, center + spread) };
}

/* ================================================================== *
 * Exposure grouping + CTR + lift
 * ================================================================== */

export interface CtrGroupSummary {
  /** Group size: unique decisions in the group. */
  readonly decisions: number;
  /** Decisions with at least one qualifying click-through outcome. */
  readonly engaged: number;
  /** engaged / decisions — null when the group is empty (never fabricated). */
  readonly ctr: number | null;
  readonly wilsonLow: number | null;
  readonly wilsonHigh: number | null;
}

export type CtrLiftDirection = "lift" | "drop" | "flat" | "inconclusive";

export interface CtrLiftResult {
  /** Decisions with ≥1 observed impression linked via decisionId. */
  readonly exposed: CtrGroupSummary;
  /** Decisions with no linked impression — the (observational) baseline. */
  readonly unexposed: CtrGroupSummary;
  /** Linked impression events observed (event count, group-agnostic context). */
  readonly impressions: number;
  /** Linked click-through events observed (event count, group-agnostic context). */
  readonly clickThroughs: number;
  /** Research-class outcomes counted and EXCLUDED from every rate. */
  readonly researchOutcomeCount: number;
  /** Observed outcomes without a decisionId — cannot be attributed, excluded. */
  readonly unlinkedOutcomeCount: number;
  readonly lift: {
    /** (exposed CTR − unexposed CTR) × 100, in percentage points — null when either CTR is null. */
    readonly absolutePct: number | null;
    /** exposed CTR / unexposed CTR — null when the baseline CTR is null or 0. */
    readonly ratio: number | null;
    readonly direction: CtrLiftDirection;
  };
}

/** A group summary with every field null-safe on an empty group. */
function emptyGroup(): CtrGroupSummary {
  return { decisions: 0, engaged: 0, ctr: null, wilsonLow: null, wilsonHigh: null };
}

function summarizeGroup(decisions: number, engaged: number): CtrGroupSummary {
  if (decisions === 0) {
    return emptyGroup();
  }
  const ctr = engaged / decisions;
  const interval = wilsonInterval(engaged, decisions);
  return {
    decisions,
    engaged,
    ctr,
    wilsonLow: interval === null ? null : interval.low,
    wilsonHigh: interval === null ? null : interval.high,
  };
}

/**
 * Compute the exposure-grouped CTR lift over the REAL decision/outcome
 * records. Pure and deterministic: groups are built from unique decision
 * ids (duplicates collapse — a list route never repeats an id), the first
 * impression per decision is the EARLIEST linked impression by occurredAt
 * (input order breaks ties), and engagement in the exposed group requires
 * a click-through at or after that first impression.
 */
export function computeCtrLift(
  decisions: readonly DecisionTrailRecord[],
  outcomes: readonly OutcomeTrailRecord[],
): CtrLiftResult {
  // Partition outcomes FIRST (the evidence law): research outcomes are
  // counted and excluded; observed outcomes without a decisionId are
  // counted and excluded from linkage.
  let researchOutcomeCount = 0;
  let unlinkedOutcomeCount = 0;
  const linked: (OutcomeTrailRecord & { readonly decisionId: string })[] = [];
  for (const outcome of outcomes) {
    if (isResearchOutcomeEvidence(outcome.evidenceClass)) {
      researchOutcomeCount += 1;
      continue;
    }
    if (outcome.decisionId === null) {
      unlinkedOutcomeCount += 1;
      continue;
    }
    linked.push({ ...outcome, decisionId: outcome.decisionId });
  }

  // First impression per decision (earliest occurredAt wins; input order
  // breaks exact ties deterministically).
  const firstImpressionAt = new Map<string, number>();
  for (const outcome of linked) {
    if (outcome.eventType !== IMPRESSION_EVENT_TYPE) {
      continue;
    }
    const current = firstImpressionAt.get(outcome.decisionId);
    if (current === undefined || outcome.occurredAt < current) {
      firstImpressionAt.set(outcome.decisionId, outcome.occurredAt);
    }
  }

  // Click-throughs per decision (linked, observed, at/after the first
  // impression when one exists).
  const clickThroughDecisions = new Set<string>();
  let impressions = 0;
  let clickThroughs = 0;
  for (const outcome of linked) {
    if (outcome.eventType === IMPRESSION_EVENT_TYPE) {
      impressions += 1;
      continue;
    }
    if (!isClickThroughEventType(outcome.eventType)) {
      continue;
    }
    clickThroughs += 1;
    const firstAt = firstImpressionAt.get(outcome.decisionId);
    if (firstAt === undefined || outcome.occurredAt >= firstAt) {
      clickThroughDecisions.add(outcome.decisionId);
    }
  }

  // Groups over unique decision ids.
  const allDecisions = new Set<string>();
  for (const decision of decisions) {
    allDecisions.add(decision.decisionId);
  }
  let exposedCount = 0;
  let exposedEngaged = 0;
  let unexposedCount = 0;
  let unexposedEngaged = 0;
  for (const decisionId of allDecisions) {
    const exposed = firstImpressionAt.has(decisionId);
    const engaged = clickThroughDecisions.has(decisionId);
    if (exposed) {
      exposedCount += 1;
      if (engaged) {
        exposedEngaged += 1;
      }
    } else {
      unexposedCount += 1;
      if (engaged) {
        unexposedEngaged += 1;
      }
    }
  }

  const exposed = summarizeGroup(exposedCount, exposedEngaged);
  const unexposed = summarizeGroup(unexposedCount, unexposedEngaged);

  const absolutePct =
    exposed.ctr !== null && unexposed.ctr !== null ? (exposed.ctr - unexposed.ctr) * 100 : null;
  const ratio = unexposed.ctr !== null && unexposed.ctr > 0 && exposed.ctr !== null ? exposed.ctr / unexposed.ctr : null;
  let direction: CtrLiftDirection = "inconclusive";
  if (absolutePct !== null) {
    if (absolutePct > 0) {
      direction = "lift";
    } else if (absolutePct < 0) {
      direction = "drop";
    } else {
      direction = "flat";
    }
  }

  return {
    exposed,
    unexposed,
    impressions,
    clickThroughs,
    researchOutcomeCount,
    unlinkedOutcomeCount,
    lift: { absolutePct, ratio, direction },
  };
}

/* ================================================================== *
 * Confidence caveat rendering model (deterministic from the result)
 * ================================================================== */

export interface CtrCaveat {
  readonly id: string;
  readonly sentence: string;
}

/** Small samples below this group size carry the small-sample caveat. */
export const CTR_SMALL_SAMPLE_THRESHOLD = 30;

export function ctrCaveats(result: CtrLiftResult): readonly CtrCaveat[] {
  const caveats: CtrCaveat[] = [
    {
      id: "observational",
      sentence:
        "Exposure is not randomized — decisions with a confirmed impression may differ systematically from those without, so treat this lift as an observational comparison, not a causal one.",
    },
  ];
  if (result.exposed.decisions > 0 && result.exposed.decisions < CTR_SMALL_SAMPLE_THRESHOLD) {
    caveats.push({
      id: "small-sample-exposed",
      sentence: `The exposed group has n = ${result.exposed.decisions} decisions — its CTR interval is wide; treat the rate as unstable.`,
    });
  }
  if (result.unexposed.decisions > 0 && result.unexposed.decisions < CTR_SMALL_SAMPLE_THRESHOLD) {
    caveats.push({
      id: "small-sample-unexposed",
      sentence: `The unexposed baseline has n = ${result.unexposed.decisions} decisions — its CTR interval is wide; treat the rate as unstable.`,
    });
  }
  if (result.unexposed.decisions === 0) {
    caveats.push({
      id: "no-baseline",
      sentence: "No unexposed decisions are in the window — there is no baseline to lift against.",
    });
  } else if (result.unexposed.ctr === 0) {
    caveats.push({
      id: "zero-baseline-ctr",
      sentence: "The baseline CTR is 0 — a relative lift ratio is undefined; only the absolute difference is reported.",
    });
  }
  if (result.researchOutcomeCount > 0) {
    caveats.push({
      id: "research-evidence-excluded",
      sentence: `${result.researchOutcomeCount} outcome(s) carry research evidence classes (fixture/simulated/counterfactual) — counted here, excluded from every rate.`,
    });
  }
  if (result.unlinkedOutcomeCount > 0) {
    caveats.push({
      id: "unlinked-outcomes-excluded",
      sentence: `${result.unlinkedOutcomeCount} observed outcome(s) carry no decisionId — they cannot be attributed to a decision and are excluded from every rate.`,
    });
  }
  return caveats;
}

/* ================================================================== *
 * View model (built ONLY from real fetched records → evidence "observed")
 * ================================================================== */

function formatPct(value: number | null): string {
  return value === null ? "not computable" : `${(value * 100).toFixed(1)}%`;
}

function formatSignedPp(value: number | null): string {
  if (value === null) return "not computable";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)} pp`;
}

export interface CtrGroupView {
  readonly key: "exposed" | "unexposed";
  readonly title: string;
  readonly subtitle: string;
  readonly nLabel: string;
  readonly engagedLabel: string;
  readonly ctrLabel: string;
  readonly ciLabel: string;
}

export interface CtrLiftView {
  readonly evidenceClass: EvidenceClassId;
  readonly liftLabel: string;
  readonly liftRatioLabel: string | null;
  readonly liftSentence: string;
  readonly groups: readonly CtrGroupView[];
  readonly contextCounts: readonly { readonly label: string; readonly value: string }[];
  readonly caveats: readonly CtrCaveat[];
}

/** Render-ready view model over a computed result (evidence: observed). */
export function ctrLiftView(result: CtrLiftResult): CtrLiftView {
  const groups: CtrGroupView[] = [
    {
      key: "exposed",
      title: "Exposed",
      subtitle: "Decisions with a confirmed impression (decision → impression linkage)",
      nLabel: `n = ${result.exposed.decisions} decisions`,
      engagedLabel: `${result.exposed.engaged} engaged`,
      ctrLabel: formatPct(result.exposed.ctr),
      ciLabel:
        result.exposed.wilsonLow === null || result.exposed.wilsonHigh === null
          ? "95% CI not computable"
          : `95% CI ${(result.exposed.wilsonLow * 100).toFixed(1)}%–${(result.exposed.wilsonHigh * 100).toFixed(1)}%`,
    },
    {
      key: "unexposed",
      title: "Unexposed baseline",
      subtitle: "Decisions with no linked impression",
      nLabel: `n = ${result.unexposed.decisions} decisions`,
      engagedLabel: `${result.unexposed.engaged} engaged`,
      ctrLabel: formatPct(result.unexposed.ctr),
      ciLabel:
        result.unexposed.wilsonLow === null || result.unexposed.wilsonHigh === null
          ? "95% CI not computable"
          : `95% CI ${(result.unexposed.wilsonLow * 100).toFixed(1)}%–${(result.unexposed.wilsonHigh * 100).toFixed(1)}%`,
    },
  ];

  const liftLabel = formatSignedPp(result.lift.absolutePct);
  const liftRatioLabel = result.lift.ratio === null ? null : `×${result.lift.ratio.toFixed(2)}`;
  const liftSentence =
    result.lift.direction === "inconclusive"
      ? "Lift is not computable in this window — a group rate or the baseline is missing."
      : result.lift.direction === "lift"
        ? `The exposed CTR is ${Math.abs(result.lift.absolutePct ?? 0).toFixed(1)} percentage points higher than the unexposed baseline.`
        : result.lift.direction === "drop"
          ? `The exposed CTR is ${Math.abs(result.lift.absolutePct ?? 0).toFixed(1)} percentage points lower than the unexposed baseline.`
          : "The exposed CTR equals the unexposed baseline in this window.";

  const contextCounts = [
    { label: "Impression events", value: String(result.impressions) },
    { label: "Click-through events", value: String(result.clickThroughs) },
    { label: "Research outcomes (excluded)", value: String(result.researchOutcomeCount) },
    { label: "Unlinked outcomes (excluded)", value: String(result.unlinkedOutcomeCount) },
  ];

  return {
    evidenceClass: "observed",
    liftLabel,
    liftRatioLabel,
    liftSentence,
    groups,
    contextCounts,
    caveats: ctrCaveats(result),
  };
}
