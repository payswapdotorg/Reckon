/**
 * SIM-005 — Ladder Level 14: the EDUCATION synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Education — long-horizon goals, curriculum state, delayed
 *    outcomes, sequential planning."
 *
 * The host owns an adaptive-learning product (host-owned curriculum
 * catalog + prerequisite DAG, assessment engine, mastery state —
 * architecture law) and asks Reckon for the next lesson decision
 * through the PUBLIC surface only: manifest → connect sources → per
 * step: candidates → decision request (objective, attention policy,
 * constraints, planId) → host presents → outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - long-horizon goal: every request declares the foundations-track
 *   objective and couples to the rolling curriculum plan via
 *   DecisionRequest.planId ("plan-l14-foundations");
 * - curriculum state advances deterministically: units unlock only
 *   when their prerequisites are MASTERED (the prerequisite DAG is
 *   host-owned and re-checked at every assignment — a coherence guard
 *   records any violation; the canonical run has none);
 * - delayed outcomes: unit assessments mature 3 steps after
 *   assignment; the matured assessment emits a DELAYED completion
 *   outcome that references the ASSIGNMENT decision (decisionId +
 *   experienceId of the earlier step) with the delay carried in
 *   metrics — outcomes arrive many steps late, never fabricated early;
 *   two assignments (the step-7 remediation practice and the step-9
 *   statistics unit) mature AFTER the canonical run ends and stay
 *   honestly pending;
 * - sequential planning: the scripted lesson plan is sequentially
 *   coherent (assign → continue → interleave the parallel track →
 *   unlock on mastery → remediate below-threshold units with the
 *   practice realization → live tutor INTERRUPT → next track);
 * - mastery scores are scripted fixtures (A1 0.85, G1 0.72, A2 0.58,
 *   G2 0.81 against the 0.65 mastery threshold) — the A2 assessment
 *   fails the threshold at step 7, so the host re-plans the unit onto
 *   its practice realization (a same-item realization swap ⇒ SWITCH);
 * - the live tutor slot at step 8 (source "host-time-critical", the
 *   responder's well-known interrupt source) INTERRUPTs the practice
 *   session with a retained resume checkpoint — scarce human attention
 *   preempts self-study.
 *
 * Honest gap: the long-horizon curriculum plan (assign → assess →
 * unlock → remediate) is host-owned; decisions couple to the plan via
 * DecisionRequest.planId and ScheduleDelta.planId and the SDK/API
 * exposes plans.create/replan/get, but the SIM-001 harness port
 * composes only the standard decision loop — plan CRUD is not
 * reachable through the composed harness path (the manifest declares
 * `plan-management` partial / COMPOSITION_GAP, fourth domain of the
 * SIM-003/Wave-B finding after levels 5, 8 and 9).
 *
 * LAWS obeyed (SIM-005 work order):
 * - zero internal Reckon imports — only @reckon/contracts types + the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate).
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-c.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the curriculum DAG / assessment / mastery / sequencing code);
 * - `functions` — the named host functions: unitByItemId,
 *   prerequisitesOf, isUnlocked, masteryScoreFor, matureDueAssessments,
 *   lessonCandidates, lessonConstraints, provideDecisionInputs,
 *   consumeDecision, provideOutcome, providePreferenceDelta,
 *   createLevel14EducationHost (12 total).
 */
import type {
  DecisionResult,
  HostDecisionReaction,
  HostDecisionInputs,
  CatalogItemInput,
  RealizationInput,
  SimulationHostAdapter,
  SimulationManifestContentInput,
  SubjectReference,
  TenantScope,
} from "../harness/host-adapter.js";
import type { HardConstraint } from "@reckon/contracts";
import type { ExperienceInput } from "../harness/port.js";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l14-education" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l14-learner-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The education world: a 3-track curriculum (algebra, geometry,
// statistics) with a prerequisite DAG, a live-tutor service, a
// deterministic lesson plan, scripted mastery scores, and the pending /
// matured assessment bookkeeping that carries DELAYED outcomes.

interface CurriculumUnit {
  readonly itemId: string;
  readonly title: string;
  readonly subject: string;
  readonly track: string;
  readonly prerequisiteOf: string[];
  readonly standardRealizationId: string;
  readonly practiceRealizationId: string | null;
  readonly standardMinutes: number;
}

const CURRICULUM_UNITS: readonly CurriculumUnit[] = [
  { itemId: "l14-unit-algebra-basics", title: "Algebra foundations", subject: "algebra", track: "algebra", prerequisiteOf: ["l14-unit-algebra-functions"], standardRealizationId: "l14-real-algebra-basics-standard", practiceRealizationId: null, standardMinutes: 35 },
  { itemId: "l14-unit-algebra-functions", title: "Functions and graphs", subject: "algebra", track: "algebra", prerequisiteOf: [], standardRealizationId: "l14-real-algebra-functions-standard", practiceRealizationId: "l14-real-algebra-functions-practice", standardMinutes: 40 },
  { itemId: "l14-unit-geometry-intro", title: "Geometry essentials", subject: "geometry", track: "geometry", prerequisiteOf: ["l14-unit-geometry-triangles"], standardRealizationId: "l14-real-geometry-intro-standard", practiceRealizationId: null, standardMinutes: 30 },
  { itemId: "l14-unit-geometry-triangles", title: "Triangle congruence", subject: "geometry", track: "geometry", prerequisiteOf: [], standardRealizationId: "l14-real-geometry-triangles-standard", practiceRealizationId: null, standardMinutes: 45 },
  { itemId: "l14-unit-stats-basics", title: "Statistics basics", subject: "statistics", track: "statistics", prerequisiteOf: ["l14-unit-stats-inference"], standardRealizationId: "l14-real-stats-basics-standard", practiceRealizationId: null, standardMinutes: 35 },
  { itemId: "l14-unit-stats-inference", title: "Inferential statistics", subject: "statistics", track: "statistics", prerequisiteOf: [], standardRealizationId: "l14-real-stats-inference-standard", practiceRealizationId: null, standardMinutes: 50 },
  { itemId: "l14-tutor-live-session", title: "Live tutor session", subject: "tutoring", track: "tutoring", prerequisiteOf: [], standardRealizationId: "l14-real-tutor-30", practiceRealizationId: null, standardMinutes: 30 },
];

/** The prerequisite DAG (host-owned; unlocks require mastered prereqs). */
const PREREQUISITES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "l14-unit-algebra-functions": ["l14-unit-algebra-basics"],
  "l14-unit-geometry-triangles": ["l14-unit-geometry-intro"],
  "l14-unit-stats-inference": ["l14-unit-stats-basics"],
});

/** Assessments mature this many steps after assignment (delayed outcomes). */
const ASSESSMENT_DELAY_STEPS = 3;
/** The mastery threshold (below it the unit is remediated, not mastered). */
const MASTERY_THRESHOLD = 0.65;
/** The step at which the live tutor slot opens (scarce human attention). */
const TUTOR_STEP = 8;

/** Scripted mastery scores (fixture-class world behaviors). */
const SCRIPTED_MASTERY_SCORES: Readonly<Record<string, number>> = Object.freeze({
  "l14-unit-algebra-basics": 0.85,
  "l14-unit-geometry-intro": 0.72,
  "l14-unit-algebra-functions": 0.58,
  "l14-unit-geometry-triangles": 0.81,
});

/**
 * The sequentially coherent lesson plan (deterministic): assign A1 →
 * continue A1 → interleave track G1 → (A1 matures, A2 unlocks) assign
 * A2 → continue A2 → (G1 matures, G2 unlocks) assign G2 → (A2 matures
 * below threshold) remediate A2-practice → tutor INTERRUPT → (G2
 * matures) assign S1.
 */
const LESSON_PLAN_BY_STEP: readonly {
  readonly itemId: string;
  readonly realization: "standard" | "practice";
  readonly source: string;
}[] = [
  { itemId: "l14-unit-algebra-basics", realization: "standard", source: "host-curriculum-next" },
  { itemId: "l14-unit-algebra-basics", realization: "standard", source: "host-lesson-track" },
  { itemId: "l14-unit-geometry-intro", realization: "standard", source: "host-curriculum-next" },
  { itemId: "l14-unit-algebra-functions", realization: "standard", source: "host-curriculum-unlock" },
  { itemId: "l14-unit-algebra-functions", realization: "standard", source: "host-lesson-track" },
  { itemId: "l14-unit-geometry-triangles", realization: "standard", source: "host-curriculum-unlock" },
  { itemId: "l14-unit-algebra-functions", realization: "practice", source: "host-adaptive-practice" },
  { itemId: "l14-tutor-live-session", realization: "standard", source: "host-time-critical" },
  { itemId: "l14-unit-stats-basics", realization: "standard", source: "host-curriculum-next" },
];

interface PendingAssessment {
  readonly itemId: string;
  readonly realizationId: string;
  readonly assignedAtStep: number;
  readonly decisionId: string;
  readonly experienceId: string | undefined;
  readonly dueStep: number;
}

interface MaturedAssessment {
  readonly itemId: string;
  readonly assignedAtStep: number;
  readonly maturedAtStep: number;
  readonly decisionId: string;
  readonly experienceId: string | undefined;
  readonly score: number;
  readonly mastered: boolean;
}

interface AssignmentRecord {
  readonly step: number;
  readonly itemId: string;
  readonly realizationId: string;
  readonly source: string;
}

interface Level14WorldState {
  presentations: number;
  assignments: AssignmentRecord[];
  continuedSteps: number[];
  pending: PendingAssessment[];
  matured: MaturedAssessment[];
  maturedThisStep: MaturedAssessment[];
  masteredUnits: string[];
  belowThresholdUnits: string[];
  unlockedSteps: Array<{ readonly itemId: string; readonly step: number }>;
  interruptionSteps: number[];
  coherenceViolations: Array<{ readonly step: number; readonly itemId: string }>;
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  subjectWeights: Map<string, number>;
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level14WorldView {
  readonly presentations: number;
  readonly assignments: readonly AssignmentRecord[];
  readonly continuedSteps: readonly number[];
  readonly pendingAtEnd: readonly PendingAssessment[];
  readonly matured: readonly MaturedAssessment[];
  readonly masteredUnits: readonly string[];
  readonly belowThresholdUnits: readonly string[];
  readonly unlockedSteps: readonly { readonly itemId: string; readonly step: number }[];
  readonly interruptionSteps: readonly number[];
  readonly coherenceViolations: readonly { readonly step: number; readonly itemId: string }[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly subjectWeights: Readonly<Record<string, number>>;
}

/** Host catalog knowledge: the unit behind an item id. */
function unitByItemId(itemId: string | undefined): CurriculumUnit | undefined {
  return CURRICULUM_UNITS.find((unit) => unit.itemId === itemId);
}

/** The prerequisites of a unit (empty for root units). */
function prerequisitesOf(itemId: string): readonly string[] {
  return PREREQUISITES[itemId] ?? [];
}

/** Is the unit unlocked (all prerequisites mastered)? */
function isUnlocked(itemId: string, masteredUnits: readonly string[]): boolean {
  return prerequisitesOf(itemId).every((prereq) => masteredUnits.includes(prereq));
}

/** The scripted mastery score for a unit's assessment. */
function masteryScoreFor(itemId: string): number {
  return SCRIPTED_MASTERY_SCORES[itemId] ?? 0.5;
}

/**
 * Mature every assessment due at this step: the pending entry leaves
 * the queue, its scripted score is applied, mastery advances, and the
 * matured record is queued for the DELAYED completion outcome.
 */
function matureDueAssessments(state: Level14WorldState, step: number): void {
  state.maturedThisStep = [];
  const stillPending: PendingAssessment[] = [];
  for (const pending of state.pending) {
    if (pending.dueStep > step) {
      stillPending.push(pending);
      continue;
    }
    const score = masteryScoreFor(pending.itemId);
    const mastered = score >= MASTERY_THRESHOLD;
    const matured: MaturedAssessment = {
      itemId: pending.itemId,
      assignedAtStep: pending.assignedAtStep,
      maturedAtStep: step,
      decisionId: pending.decisionId,
      experienceId: pending.experienceId,
      score,
      mastered,
    };
    state.matured.push(matured);
    state.maturedThisStep.push(matured);
    if (mastered && !state.masteredUnits.includes(pending.itemId)) {
      state.masteredUnits.push(pending.itemId);
      for (const dependent of unitByItemId(pending.itemId)?.prerequisiteOf ?? []) {
        state.unlockedSteps.push({ itemId: dependent, step });
      }
    } else if (!mastered && !state.belowThresholdUnits.includes(pending.itemId)) {
      state.belowThresholdUnits.push(pending.itemId);
    }
  }
  state.pending = stillPending;
}

/** Retrieval: the lesson plan's candidate for this step. */
function lessonCandidates(step: number): {
  readonly itemId: string;
  readonly realizationIds: string[];
  readonly source: string;
  readonly rankHint: number;
}[] {
  const planned = LESSON_PLAN_BY_STEP[step - 1]!;
  const unit = unitByItemId(planned.itemId)!;
  const realizationId =
    planned.realization === "practice" && unit.practiceRealizationId !== null
      ? unit.practiceRealizationId
      : unit.standardRealizationId;
  return [{ itemId: unit.itemId, realizationIds: [realizationId], source: planned.source, rankHint: 1 }];
}

/** Sequential-coherence constraints on every request. */
function lessonConstraints(): HardConstraint[] {
  return [
    { kind: "catalog-rule", ruleId: "l14-curriculum-dag" },
    { kind: "custom", constraintId: "l14-mastery-gate", params: { minMasteryScore: MASTERY_THRESHOLD } },
    { kind: "max-latency", latencyMs: 300 },
  ];
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL14_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: CURRICULUM_UNITS.map((unit) => ({
    itemId: unit.itemId,
    kind: "media" as const,
    labels: ["lesson", unit.subject, unit.track],
    attributes: {
      title: unit.title,
      subject: unit.subject,
      track: unit.track,
      standardMinutes: unit.standardMinutes,
      prerequisites: prerequisitesOf(unit.itemId).join(","),
    },
  })),
  realizations: CURRICULUM_UNITS.flatMap((unit) => {
    const standard = {
      realizationId: unit.standardRealizationId,
      itemId: unit.itemId,
      kind: "lesson-standard",
      constraints: { durationMinutes: unit.standardMinutes, difficulty: "standard" },
    };
    return unit.practiceRealizationId === null
      ? [standard]
      : [
          standard,
          {
            realizationId: unit.practiceRealizationId,
            itemId: unit.itemId,
            kind: "lesson-practice",
            constraints: { durationMinutes: Math.max(15, unit.standardMinutes - 10), difficulty: "remediation" },
          },
        ];
  }),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL14_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l14-education",
    name: "Atlas Learning Path",
    hostAdapterId: "adapter-l14-education-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    {
      capability: "catalog-registration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/items"],
      sdkMethods: ["catalog.upsertItem"],
    },
    {
      capability: "realization-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertRealization"],
      notes: "standard and remediation-practice realizations per unit carry the host-owned duration/difficulty delivery characteristics",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "the sequentially coherent lesson plan (assign → continue → unlock-on-mastery → remediation practice → tutor interrupt)",
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "the long-horizon foundations-track objective is declared on every decision request (in-request field)",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "curriculum-DAG catalog rule + custom mastery gate + max-latency budget on every request",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "balanced attention; the live tutor slot (host-time-critical) is the admitted interrupt",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "requests carry currentExperience for the live lesson (CONTINUE working, SWITCH on unlock/remediation, INTERRUPT on the tutor slot) and planId coupling to the rolling curriculum plan",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (QUEUE assignment, CONTINUE progress, SWITCH unlock/remediation, INTERRUPT tutor slot with retained checkpoint)",
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "DELAYED completion outcomes reference the ASSIGNMENT decision (decisionId + experienceId of the earlier step) with the assessment delay carried in metrics — outcomes arrive many steps late, never fabricated early",
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
    },
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
    {
      capability: "plan-management",
      status: "partial",
      evidenceClass: "fixture",
      friction: "COMPOSITION_GAP",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes:
        "the long-horizon curriculum plan (assign → assess → unlock → remediate) is host-owned; decisions couple to the plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path, fourth domain of the SIM-003/Wave-B finding after levels 5, 8 and 9",
    },
  ],
};

/** The Level 14 Reckon-Complete profile: what this archetype REQUIRES. */
export const level14EducationProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l14-education",
  name: "Education",
  description: "SIM-005 ladder level 14 — long-horizon goals, curriculum state, delayed outcomes, sequential planning.",
  ladderLevel: 14,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "realization-declaration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "constraint-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "schedule-execution" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
    { capability: "plan-management" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 14 host (fresh world state — replay-safe by construction). */
export interface Level14Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level14WorldView;
}

export function createLevel14EducationHost(): Level14Host {
  const state: Level14WorldState = {
    presentations: 0,
    assignments: [],
    continuedSteps: [],
    pending: [],
    matured: [],
    maturedThisStep: [],
    masteredUnits: [],
    belowThresholdUnits: [],
    unlockedSteps: [],
    interruptionSteps: [],
    coherenceViolations: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    subjectWeights: new Map([["algebra", 1], ["geometry", 1], ["statistics", 1], ["tutoring", 1]]),
  };
  /** The experience the previous PRESENTED decision selected (the live lesson). */
  let liveExperience: ExperienceInput | undefined;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l14-education-1",
    hostSystem: {
      hostId: "host-l14-education",
      name: "Atlas Learning Path",
      version: "0.1.0",
    },
    glue: { functions: 12, loc: 555, customAdapterLoc: 169 },
    manifestContent: LEVEL14_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL14_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL14_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      // World transition: assessments due this step mature now (mastery
      // advances, dependents unlock) — BEFORE this step's candidate.
      matureDueAssessments(state, step);
      return {
        contextId: `ctx-l14-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l14-foundations-track",
          version: "1",
          kind: "learn",
          params: { track: "foundations", horizon: "long", assessmentDelaySteps: ASSESSMENT_DELAY_STEPS },
        },
        attentionPolicy: {
          policyId: "ap-l14-study-balanced",
          version: "1",
          style: "balanced",
          params: { maxLessonSwitchesPerSession: 3 },
        },
        candidates: {
          setId: `cs-l14-${step}`,
          candidates: lessonCandidates(step).map((candidate) => ({ ...candidate })),
        },
        constraints: lessonConstraints(),
        policySelector: { policyId: "atlas-learning-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
        planId: "plan-l14-foundations",
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const unit = unitByItemId(result.selectedExperience?.itemId);
      state.presentations += 1;
      if (result.action === "INTERRUPT") {
        // The live tutor slot interrupts the practice session.
        state.interruptionSteps.push(step);
        liveExperience = result.selectedExperience;
        return { presented: true };
      }
      if (unit === undefined || unit.itemId === "l14-tutor-live-session") {
        liveExperience = result.selectedExperience;
        return { presented: true };
      }
      // Sequential-coherence guard: a unit may only be assigned when its
      // prerequisites are all mastered (the host re-checks the DAG).
      if (!isUnlocked(unit.itemId, state.masteredUnits)) {
        state.coherenceViolations.push({ step, itemId: unit.itemId });
      }
      const planned = LESSON_PLAN_BY_STEP[step - 1]!;
      const realizationId = result.selectedExperience?.realizationId ?? unit.standardRealizationId;
      if (result.action === "CONTINUE") {
        state.continuedSteps.push(step);
      } else {
        state.assignments.push({ step, itemId: unit.itemId, realizationId, source: planned.source });
        // A new assignment schedules its DELAYED assessment.
        state.pending.push({
          itemId: unit.itemId,
          realizationId,
          assignedAtStep: step,
          decisionId: result.decisionId,
          experienceId: result.selectedExperience?.experienceId,
          dueStep: step + ASSESSMENT_DELAY_STEPS,
        });
      }
      liveExperience = result.selectedExperience;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const matured = state.maturedThisStep.find((entry) => entry.maturedAtStep === step);
      const interrupted = state.interruptionSteps.includes(step);
      const continued = state.continuedSteps.includes(step);
      let eventType: "start" | "completion" | "interruption-accept" | "custom" = "custom";
      let customEventType: string | undefined = "lesson-progress";
      let decisionId = result.decisionId;
      let experienceId = result.selectedExperience?.experienceId;
      let metrics: Record<string, number>;
      if (matured !== undefined) {
        // DELAYED outcome: the matured assessment references the
        // ASSIGNMENT decision (many steps earlier), never the current one.
        eventType = "completion";
        customEventType = undefined;
        decisionId = matured.decisionId;
        experienceId = matured.experienceId;
        metrics = {
          masteryScore: matured.score,
          masteryThreshold: MASTERY_THRESHOLD,
          mastered: matured.mastered ? 1 : 0,
          assessmentDelaySteps: matured.maturedAtStep - matured.assignedAtStep,
          assignedAtStep: matured.assignedAtStep,
          maturedAtStep: matured.maturedAtStep,
        };
      } else if (interrupted) {
        eventType = "interruption-accept";
        customEventType = undefined;
        metrics = { tutorSessionMinutes: 30, resumedFromCheckpoint: 1 };
      } else if (continued) {
        eventType = "custom";
        customEventType = "lesson-progress";
        metrics = { progressPct: 40 + 10 * step, pendingAssessments: state.pending.length };
      } else if (state.outcomeSteps.length === 1) {
        eventType = "start";
        customEventType = undefined;
        metrics = {
          assessmentDueStep: step + ASSESSMENT_DELAY_STEPS,
          pendingAssessments: state.pending.length,
          curriculumUnitsMastered: state.masteredUnits.length,
        };
      } else {
        eventType = "custom";
        customEventType = "lesson-assigned";
        metrics = {
          assessmentDueStep: step + ASSESSMENT_DELAY_STEPS,
          pendingAssessments: state.pending.length,
          curriculumUnitsMastered: state.masteredUnits.length,
        };
      }
      state.outcomeTypes.push(eventType);
      return {
        eventId: `ev-l14-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId,
        experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics,
        idempotencyKey: `idem-out-l14-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const unit = unitByItemId(result.selectedExperience?.itemId) ?? CURRICULUM_UNITS[0]!;
      const dimension = `subject.${unit.subject}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.subjectWeights.get(unit.subject) ?? 1) + 0.15;
      state.subjectWeights.set(unit.subject, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l14-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.4 + 0.06 * step),
        model: { modelId: "atlas-subject-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get assignments() { return state.assignments.map((entry) => ({ ...entry })); },
      get continuedSteps() { return [...state.continuedSteps]; },
      get pendingAtEnd() { return state.pending.map((entry) => ({ ...entry })); },
      get matured() { return state.matured.map((entry) => ({ ...entry })); },
      get masteredUnits() { return [...state.masteredUnits]; },
      get belowThresholdUnits() { return [...state.belowThresholdUnits]; },
      get unlockedSteps() { return state.unlockedSteps.map((entry) => ({ ...entry })); },
      get interruptionSteps() { return [...state.interruptionSteps]; },
      get coherenceViolations() { return state.coherenceViolations.map((entry) => ({ ...entry })); },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get subjectWeights() { return Object.fromEntries([...state.subjectWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level14EducationMeta = {
  level: 14,
  name: "Education",
  hostAdapterId: "adapter-l14-education-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["plan-management|COMPOSITION_GAP"] as readonly string[],
} as const;
