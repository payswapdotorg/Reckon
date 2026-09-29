/**
 * W3-005/W3-006 — the media vertical proof harness (test infrastructure).
 *
 * Proves the full vertical for ADAPTER-MAPPED contract data through the
 * REAL Worker-2 kernels — no reimplementation, no shortcuts:
 *
 *   context → candidates → experience → decision → schedule
 *
 *   normalizeCandidates (W2-001)  → expandExperiences (W2-003)
 *   → evaluatePolicy (W2-002)     → decide (W2-004 scheduler)
 *
 * The harness additionally assembles the contract `DecisionRequest`
 * (schema-validated) and the contract `DecisionResult` envelope from
 * the scheduler decision, so every stage of the vertical is a
 * schema-valid frozen contract record. Outcome events and preference
 * deltas close the loop in the adapter tests via the adapters' own
 * mapping methods (outcome → preference delta).
 *
 * Pure, total, deterministic: caller-supplied timestamps only, derived
 * ids from canonical content digests. Zero LLM calls anywhere.
 */
import {
  DecisionRequestSchema,
  DecisionResultSchema,
  contentDigest,
  type AttentionPolicy,
  type CandidateSet,
  type CatalogItem,
  type ContextSnapshot,
  type DecisionRequest,
  type DecisionResult,
  type Experience,
  type HardConstraint,
  type Id,
  type Objective,
  type Realization,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
// Cross-package composition of the REAL kernels (established repo
// pattern: relative imports, no package.json/lockfile change).
import {
  evaluatePolicy,
  normalizeCandidates,
  type NormalizedCandidate,
  type PolicyExclusion,
  type ScoredExperience,
} from "../../decision/src/index.js";
import {
  expandExperiences,
  type ExpansionOutput,
  type FormatKind,
  type ObjectiveFitFn,
} from "../../experience/src/index.js";
import {
  decide,
  type PlanState,
  type SchedulerDecision,
  type SchedulerInput,
} from "../../scheduler/src/index.js";

/** Vertical harness error (typed value, never a raw throw). */
export interface VerticalError {
  code: "VERTICAL_FAILED";
  message: string;
  issues?: { path: string; message: string }[];
}

export type VerticalResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: VerticalError };

function verticalFailure(
  message: string,
  issues?: { path: string; message: string }[],
): { ok: false; error: VerticalError } {
  return { ok: false, error: { code: "VERTICAL_FAILED", message, ...(issues !== undefined ? { issues } : {}) } };
}

/** A fresh idle plan state (vertical start). */
export function idleState(): PlanState {
  return { status: "idle", queue: [], resumeCheckpoints: [] };
}

/** Everything one vertical run needs (contract-shaped, adapter-agnostic). */
export interface VerticalInput {
  tenant: TenantScope;
  subject: SubjectReference;
  objective: Objective;
  attentionPolicy: AttentionPolicy;
  context: ContextSnapshot;
  candidateSet: CandidateSet;
  items: CatalogItem[];
  realizations: Realization[];
  /** Hard constraints gating eligibility (defense in depth re-applies them). */
  constraints: HardConstraint[];
  /** Host format policy for the expander. */
  allowedFormats: FormatKind[];
  /** Injected host objective-fit policy (adapter-provided, deterministic). */
  objectiveFit: ObjectiveFitFn;
  policySelector: { policyId: string; version: string };
  /** Caller-supplied decision time (never invented). */
  at: number;
  requestId: Id;
  idempotencyKey: Id;
  /** Observed plan state (default: idle). */
  startState?: PlanState;
  /** Current experience, required when startState is playing/interrupted. */
  currentExperience?: Experience;
  /** Optional scheduler intents (switch evaluation, host flags, tokens). */
  intents?: Omit<SchedulerInput, "currentState" | "request" | "scored">;
}

/** Every intermediate record of one vertical run. */
export interface VerticalOutput {
  /** W2-001: normalized candidates (host capability truth merged). */
  normalized: NormalizedCandidate[];
  /** W2-003: expanded experiences + honest exclusions. */
  expansion: ExpansionOutput;
  /** W2-002: policy evaluation detail (scored + excluded + rewardApplied). */
  scored: ScoredExperience[];
  excluded: PolicyExclusion[];
  rewardApplied: boolean;
  /** Contract decision request (schema-validated). */
  request: DecisionRequest;
  /** W2-004: the scheduler decision (action, transition, schedule delta). */
  decision: SchedulerDecision;
  /** Contract decision result envelope (schema-validated). */
  result: DecisionResult;
}

/**
 * Run the full decision vertical over adapter-mapped contract data.
 * Every stage runs through the real W2 kernels; failures surface as
 * typed errors with the kernel's own message.
 */
export function runVertical(input: VerticalInput): VerticalResult<VerticalOutput> {
  // Stage 1 — candidate normalization (W2-001).
  const normalized = normalizeCandidates({
    candidates: input.candidateSet,
    items: input.items,
    realizations: input.realizations,
    tenant: input.tenant,
  });
  if (!normalized.ok) {
    return verticalFailure(`vertical: normalization failed: ${normalized.error.message}`, normalized.error.issues);
  }

  // Stage 2 — experience expansion (W2-003), with the injected host
  // objective-fit policy.
  const expansion = expandExperiences(
    {
      candidates: normalized.value,
      items: input.items,
      realizations: input.realizations,
      formatPolicy: { allowedFormats: input.allowedFormats },
      objective: input.objective,
      constraints: input.constraints,
    },
    { objectiveFit: input.objectiveFit },
  );
  if (!expansion.ok) {
    return verticalFailure(`vertical: expansion failed: ${expansion.error.message}`, expansion.error.issues);
  }
  if (expansion.value.experiences.length === 0) {
    return verticalFailure("vertical: no expandable experiences (all candidates excluded)");
  }

  // Stage 3 — policy evaluation (W2-002). NO default engagement reward:
  // no RewardSpec is declared, so scoring uses objective-fit evidence only.
  const policy = evaluatePolicy({
    experiences: expansion.value.experiences.map((entry) => entry.experience),
    objective: input.objective,
    constraints: input.constraints,
    policyId: input.policySelector.policyId,
    policyVersion: input.policySelector.version,
  });
  if (!policy.ok) {
    return verticalFailure(`vertical: policy evaluation failed: ${policy.error.message}`, policy.error.issues);
  }
  if (policy.value.scored.length === 0) {
    return verticalFailure("vertical: policy evaluation produced no eligible experiences");
  }

  // Stage 4 — contract decision request (schema-validated).
  const parsedRequest = DecisionRequestSchema.safeParse({
    requestId: input.requestId,
    tenant: input.tenant,
    subject: input.subject,
    objective: input.objective,
    attentionPolicy: input.attentionPolicy,
    context: { contextId: input.context.contextId },
    candidates: input.candidateSet,
    constraints: input.constraints,
    ...(input.currentExperience !== undefined ? { currentExperience: input.currentExperience } : {}),
    policySelector: {
      policyId: input.policySelector.policyId,
      version: input.policySelector.version,
    },
    at: input.at,
    idempotencyKey: input.idempotencyKey,
  });
  if (!parsedRequest.success) {
    return verticalFailure(
      "vertical: constructed decision request failed schema validation",
      parsedRequest.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const request = parsedRequest.data;

  // Stage 5 — the scheduler decision (W2-004).
  const decision = decide({
    currentState: input.startState ?? idleState(),
    request,
    scored: policy.value.scored,
    ...(input.intents !== undefined ? input.intents : {}),
  });
  if (!decision.ok) {
    return verticalFailure(`vertical: scheduler decide failed: ${decision.error.message}`);
  }

  // Stage 6 — contract decision result envelope (schema-validated).
  // Latency is omitted (never measured, never invented); uncertainty
  // is the winning experience's real evidence-sparsity metadata.
  const selected = decision.value.selectedExperience;
  const alternatives = policy.value.scored
    .filter((entry) => entry.experience.experienceId !== decision.value.selectedExperienceId)
    .map((entry) => ({
      experienceId: entry.experience.experienceId,
      score: entry.score,
      ...(entry.uncertainty !== undefined ? { uncertainty: entry.uncertainty } : {}),
    }));
  const decisionId = `dec-${contentDigest({
    requestId: input.requestId,
    action: decision.value.action,
    at: input.at,
    selectedId: decision.value.selectedExperienceId ?? null,
  }).slice(0, 24)}`;
  const parsedResult = DecisionResultSchema.safeParse({
    decisionId,
    requestId: input.requestId,
    tenant: input.tenant,
    action: decision.value.action,
    ...(selected !== undefined ? { selectedExperience: selected } : {}),
    alternatives,
    ...(policy.value.scored[0].uncertainty !== undefined
      ? { uncertainty: policy.value.scored[0].uncertainty }
      : {}),
    policy: {
      policyId: input.policySelector.policyId,
      version: input.policySelector.version,
    },
    scheduleDelta: decision.value.scheduleDelta,
    reasons: decision.value.reasons,
    provenance: { system: "reckon-vertical-harness", version: "0.1.0" },
    at: input.at,
  });
  if (!parsedResult.success) {
    return verticalFailure(
      "vertical: constructed decision result failed schema validation",
      parsedResult.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }

  return {
    ok: true,
    value: {
      normalized: normalized.value,
      expansion: expansion.value,
      scored: policy.value.scored,
      excluded: policy.value.excluded,
      rewardApplied: policy.value.rewardApplied,
      request,
      decision: decision.value,
      result: parsedResult.data,
    },
  };
}

/** Unwrap a vertical result for test assertions (throws with the typed error). */
export function unwrapVertical<T>(result: VerticalResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `vertical failed: ${result.error.message}${result.error.issues !== undefined ? ` (${JSON.stringify(result.error.issues)})` : ""}`,
    );
  }
  return result.value;
}
