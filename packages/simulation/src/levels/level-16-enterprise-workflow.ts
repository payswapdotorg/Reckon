/**
 * SIM-005 — Ladder Level 16: the ENTERPRISE WORKFLOW ORCHESTRATION
 * synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Enterprise workflow orchestration — approvals, long-lived plans,
 *    concurrency, audit, compensation."
 *
 * The host owns an operations-orchestration product (host-owned
 * workflow step catalog, approval-chain state machine, action-claim
 * registry, append-only audit ledger, compensation engine —
 * architecture law: Reckon NEVER owns approvals, entitlements or
 * process authority) and asks Reckon for the next workflow-step
 * decision through the PUBLIC surface only: manifest → connect
 * sources → per step: candidates → decision request (objective,
 *    attention policy, constraints, lane planId) → host presents →
 * outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - approvals: the purchase-order approval chain gates actions —
 *   submit → manager approval → director approval (high value) →
 *   budget check → payment dispatch; each gate advances the chain
 *   state machine deterministically and rides the request's
 *   policy-rights constraint;
 * - long-lived plans: two CONCURRENT plans (plan-l16-procurement-1
 *   and plan-l16-vendor-1) interleave lanes across the run; every
 *   request couples to its lane's plan via DecisionRequest.planId;
 * - concurrency without double-acting: an action-claim registry gives
 *   every executed action exactly one claiming plan; the step-7
 *   budget check is a SHARED action (both lanes need it) claimed once
 *   by the procurement lane with the vendor lane's need merged; the
 *   step-9 re-plan proposes re-submission of already-claimed
 *   uncompensated actions (po-submit, the failed dispatch) and the
 *   double-act guard BLOCKS them (recorded honestly);
 * - audit: every step lands in the host's append-only audit ledger
 *   with decision linkage (decisionId + outcome event id + lane plan);
 * - compensation: the scripted bank-verification failure at step 8
 *   fails the payment dispatch; the step-9 compensation action emits
 *   an append-oriented CORRECTION outcome (correctsEventId → the
 *   dispatch event) that compensates the failed dispatch — unlocking
 *   its re-execution — and the step-10 retry DISPATCHES successfully
 *   (the recovered workflow completes; the action claim registry
 *   allows exactly one compensated re-execution).
 *
 * Honest gaps (two declared partials — this is the most demanding
 * archetype of the wave):
 * - `plan-management` partial / COMPOSITION_GAP: the long-lived
 *   concurrent plans are host-owned; decisions couple via
 *   DecisionRequest.planId and ScheduleDelta.planId and the SDK/API
 *   exposes plans.create/replan/get, but the SIM-001 harness port
 *   composes only the standard decision loop — plan CRUD is not
 *   reachable through the composed harness path (fifth domain of the
 *   SIM-003/Wave-B finding after levels 5, 8, 9 and 14);
 * - `evidence-retrieval` partial / COMPOSITION_GAP: the audit ledger
 *   needs decision/outcome linkage retrieval; the public SDK exposes
 *   decision lookup (GET /v1/decisions/{id}), but the composed harness
 *   path composes only the six standard-loop operations (third domain
 *   after Wave B level 12 and Wave C level 13 — the 3-domain trigger
 *   entry, recorded honestly as a platformUpgradeCandidate by the
 *   frozen scorecard machinery; the upgrade itself belongs to TL3).
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
 *   (the approval-chain / claim-registry / compensation code);
 * - `functions` — the named host functions: stepActionByItemId,
 *   laneOfAction, doubleActAllowed, workflowCandidates,
 *   orchestrationConstraints, provideDecisionInputs, consumeDecision,
 *   provideOutcome, providePreferenceDelta,
 *   createLevel16EnterpriseWorkflowHost (10 total).
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
const TENANT: TenantScope = { tenantId: "tenant-l16-enterprise" };
const SUBJECT: SubjectReference = { kind: "account", ref: "acct-l16-meridian-ops" };

// --- glue:adapter:begin ----------------------------------------------------
// The enterprise world: 8 workflow steps across two concurrent plan
// lanes, the approval-chain state machine, the action-claim registry
// (no double-acting), the shared-action merge, the compensation
// engine, and the append-only audit ledger. Approvals, entitlements
// and process authority are HOST-owned (architecture law).

type PlanLane = "procurement" | "vendor";

interface WorkflowStepAction {
  readonly itemId: string;
  readonly title: string;
  readonly domain: string;
  readonly lane: PlanLane;
  readonly realizationId: string;
  readonly approverRank: number;
}

const WORKFLOW_STEPS: readonly WorkflowStepAction[] = [
  { itemId: "l16-step-po-submit", title: "Submit purchase order", domain: "procurement", lane: "procurement", realizationId: "l16-real-po-submit", approverRank: 1 },
  { itemId: "l16-step-manager-approval", title: "Manager approval gate", domain: "approvals", lane: "procurement", realizationId: "l16-real-manager-approval", approverRank: 2 },
  { itemId: "l16-step-director-approval", title: "Director approval gate", domain: "approvals", lane: "procurement", realizationId: "l16-real-director-approval", approverRank: 3 },
  { itemId: "l16-step-budget-check", title: "Finance budget verification", domain: "finance", lane: "procurement", realizationId: "l16-real-budget-check", approverRank: 2 },
  { itemId: "l16-step-vendor-onboard", title: "Vendor onboarding packet", domain: "vendor", lane: "vendor", realizationId: "l16-real-vendor-onboard", approverRank: 1 },
  { itemId: "l16-step-compliance-review", title: "Vendor compliance review", domain: "vendor", lane: "vendor", realizationId: "l16-real-compliance-review", approverRank: 2 },
  { itemId: "l16-step-payment-dispatch", title: "Payment dispatch", domain: "payments", lane: "procurement", realizationId: "l16-real-payment-dispatch", approverRank: 2 },
  { itemId: "l16-step-compensation-rollback", title: "Compensation rollback", domain: "compensation", lane: "procurement", realizationId: "l16-real-compensation-rollback", approverRank: 3 },
];

/** The two concurrent long-lived plans (lane plan ids). */
const PLAN_IDS: Readonly<Record<PlanLane, string>> = Object.freeze({
  procurement: "plan-l16-procurement-1",
  vendor: "plan-l16-vendor-1",
});
/** The purchase order value (drives the director-approval gate). */
const PO_VALUE_USD = 14_000;
/** The scripted bank-verification failure step. */
const BANK_FAILURE_STEP = 8;
/** The step at which the compensation rollback executes. */
const COMPENSATION_STEP = 9;
/** The step at which the compensated dispatch retries successfully. */
const RETRY_DISPATCH_STEP = 10;
/**
 * The step-9 re-plan proposal set (evaluated by the double-act guard):
 * re-submission of the purchase order and re-execution of the failed
 * dispatch are BLOCKED (already claimed, uncompensated at proposal
 * time); the compensation action itself is claimable.
 */
const REPLAN_PROPOSALS_AT_COMPENSATION: readonly string[] = [
  "l16-step-po-submit",
  "l16-step-payment-dispatch",
  "l16-step-compensation-rollback",
];

/** The scripted workflow per step: (action, source, lane). */
const WORKFLOW_PLAN_BY_STEP: readonly {
  readonly itemId: string;
  readonly source: string;
  readonly lane: PlanLane;
}[] = [
  { itemId: "l16-step-po-submit", source: "host-plan-next", lane: "procurement" },
  { itemId: "l16-step-vendor-onboard", source: "host-plan-next", lane: "vendor" },
  { itemId: "l16-step-manager-approval", source: "host-approval-chain", lane: "procurement" },
  { itemId: "l16-step-compliance-review", source: "host-plan-next", lane: "vendor" },
  { itemId: "l16-step-vendor-onboard", source: "host-plan-track", lane: "vendor" },
  { itemId: "l16-step-director-approval", source: "host-approval-chain", lane: "procurement" },
  { itemId: "l16-step-budget-check", source: "host-plan-next", lane: "procurement" },
  { itemId: "l16-step-payment-dispatch", source: "host-plan-next", lane: "procurement" },
  { itemId: "l16-step-compensation-rollback", source: "host-compensation", lane: "procurement" },
  { itemId: "l16-step-payment-dispatch", source: "host-compensation-retry", lane: "procurement" },
];

interface ActionClaim {
  readonly itemId: string;
  readonly lane: PlanLane;
  readonly step: number;
  /** A shared action claimed once, with the other lane's need merged. */
  readonly mergedLane: PlanLane | null;
}

interface AuditLedgerEntry {
  readonly step: number;
  readonly planId: string;
  readonly lane: PlanLane;
  readonly decisionId: string;
  readonly itemId: string;
  outcomeEventId: string | null;
}

interface Level16WorldState {
  presentations: number;
  laneRotation: PlanLane[];
  actionClaims: ActionClaim[];
  sharedActionClaims: ActionClaim[];
  doubleActBlocks: Array<{ readonly step: number; readonly itemId: string }>;
  compensationSteps: number[];
  compensationUnlocks: Array<{ readonly step: number; readonly itemId: string }>;
  compensatedActions: string[];
  approvalChainStates: Array<{ readonly step: number; readonly state: string }>;
  vendorStates: Array<{ readonly step: number; readonly state: string }>;
  auditLedger: AuditLedgerEntry[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  workflowWeights: Map<string, number>;
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level16WorldView {
  readonly presentations: number;
  readonly concurrentPlanIds: readonly string[];
  readonly laneRotation: readonly PlanLane[];
  readonly actionClaims: readonly ActionClaim[];
  readonly sharedActionClaims: readonly ActionClaim[];
  readonly doubleActBlocks: readonly { readonly step: number; readonly itemId: string }[];
  readonly compensationSteps: readonly number[];
  readonly compensationUnlocks: readonly { readonly step: number; readonly itemId: string }[];
  readonly approvalChainStates: readonly { readonly step: number; readonly state: string }[];
  readonly vendorStates: readonly { readonly step: number; readonly state: string }[];
  readonly auditLedger: readonly AuditLedgerEntry[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly workflowWeights: Readonly<Record<string, number>>;
}

/** Host catalog knowledge: the workflow step behind an item id. */
function stepActionByItemId(itemId: string | undefined): WorkflowStepAction | undefined {
  return WORKFLOW_STEPS.find((action) => action.itemId === itemId);
}

/** The plan lane that owns a workflow step. */
function laneOfAction(itemId: string): PlanLane {
  return stepActionByItemId(itemId)?.lane ?? "procurement";
}

/**
 * The double-act guard: may this action execute now? An unclaimed
 * action may; a claimed-but-COMPENSATED action may (exactly one
 * compensated re-execution); a claimed uncompensated action may NOT
 * (concurrent plans must not double-act).
 */
function doubleActAllowed(
  itemId: string,
  actionClaims: readonly ActionClaim[],
  compensatedActions: readonly string[],
): boolean {
  const claimed = actionClaims.find((claim) => claim.itemId === itemId);
  if (claimed === undefined) return true;
  return compensatedActions.includes(itemId);
}

/** Retrieval: the scripted workflow candidate for this step. */
function workflowCandidates(step: number): {
  readonly itemId: string;
  readonly realizationIds: string[];
  readonly source: string;
  readonly rankHint: number;
}[] {
  const planned = WORKFLOW_PLAN_BY_STEP[step - 1]!;
  const action = stepActionByItemId(planned.itemId)!;
  return [{ itemId: action.itemId, realizationIds: [action.realizationId], source: planned.source, rankHint: 1 }];
}

/** Approval-chain and concurrency constraints on every request. */
function orchestrationConstraints(): HardConstraint[] {
  return [
    { kind: "policy-rights", gateId: "l16-approval-chain" },
    { kind: "custom", constraintId: "l16-no-double-act", params: { guard: "action-claim-registry" } },
    { kind: "time-window", untilMs: 86_400_000 },
    { kind: "max-latency", latencyMs: 400 },
  ];
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL16_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: WORKFLOW_STEPS.map((action) => ({
    itemId: action.itemId,
    kind: "other" as const,
    labels: ["workflow-step", action.domain, `lane-${action.lane}`],
    attributes: {
      title: action.title,
      domain: action.domain,
      lane: action.lane,
      approverRank: action.approverRank,
    },
  })),
  realizations: WORKFLOW_STEPS.map((action) => ({
    realizationId: action.realizationId,
    itemId: action.itemId,
    kind: "workflow-step",
    constraints: {
      approverRank: action.approverRank,
      slaHours: 24,
      lane: action.lane,
    },
  })),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL16_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l16-enterprise-workflow",
    name: "Meridian Ops Orchestration",
    hostAdapterId: "adapter-l16-enterprise-workflow-1",
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
      notes: "workflow-step realizations carry the host-owned approver rank, SLA and plan lane",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "the concurrent-lane workflow rotation; the double-act guard shapes the step-9 re-plan proposals (uncompensated re-executions blocked host-side)",
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "the multi-plan orchestration objective is declared on every decision request (in-request field)",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "policy-rights approval-chain gate + custom no-double-act guard + SLA time-window + max-latency budget on every request",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "attention policy declared on every decision request (in-request field)",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "requests carry currentExperience for the live step and the lane planId coupling to the two concurrent long-lived plans",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (QUEUE the first step, SWITCH every subsequent step across lanes)",
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "the compensation rollback is an append-oriented CORRECTION outcome (correctsEventId) referencing the failed dispatch event; the retried dispatch completes the recovered workflow",
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
        "the long-lived concurrent plans (procurement + vendor lanes) are host-owned; decisions couple to each lane's plan via DecisionRequest.planId and ScheduleDelta.planId and the SDK/API exposes plans.create/replan/get, but the SIM-001 harness port composes only the standard decision loop — plan CRUD is not reachable through the composed harness path, fifth domain of the SIM-003/Wave-B finding after levels 5, 8, 9 and 14",
    },
    {
      capability: "evidence-retrieval",
      status: "partial",
      evidenceClass: "fixture",
      friction: "COMPOSITION_GAP",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes:
        "the audit ledger needs decision/outcome linkage retrieval; the public SDK exposes decision lookup (GET /v1/decisions/{id} via decisions.get), but the SIM-001 harness port composes only the six standard-loop operations — evidence retrieval is not reachable through the composed harness path, so the audit ledger stays host-side, third domain after Wave B level 12 and Wave C level 13 (the 3-domain trigger entry — recorded as a platformUpgradeCandidate by the frozen scorecard machinery; the upgrade decision belongs to TL3)",
    },
  ],
};

/** The Level 16 Reckon-Complete profile: what this archetype REQUIRES. */
export const level16EnterpriseWorkflowProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l16-enterprise-workflow",
  name: "Enterprise workflow orchestration",
  description: "SIM-005 ladder level 16 — approvals, long-lived plans, concurrency, audit, compensation.",
  ladderLevel: 16,
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
    { capability: "evidence-retrieval" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 16 host (fresh world state — replay-safe by construction). */
export interface Level16Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level16WorldView;
}

export function createLevel16EnterpriseWorkflowHost(): Level16Host {
  const state: Level16WorldState = {
    presentations: 0,
    laneRotation: [],
    actionClaims: [],
    sharedActionClaims: [],
    doubleActBlocks: [],
    compensationSteps: [],
    compensationUnlocks: [],
    compensatedActions: [],
    approvalChainStates: [],
    vendorStates: [],
    auditLedger: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    workflowWeights: new Map([
      ["approvals", 1],
      ["compensation", 1],
      ["finance", 1],
      ["payments", 1],
      ["procurement", 1],
      ["vendor", 1],
    ]),
  };
  /** The experience the previous PRESENTED decision selected (the live step). */
  let liveExperience: ExperienceInput | undefined;
  /** The failed dispatch event id (the compensation corrects it). */
  let dispatchEventId = "";

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l16-enterprise-workflow-1",
    hostSystem: {
      hostId: "host-l16-enterprise-workflow",
      name: "Meridian Ops Orchestration",
      version: "0.1.0",
    },
    glue: { functions: 10, loc: 588, customAdapterLoc: 129 },
    manifestContent: LEVEL16_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL16_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL16_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const planned = WORKFLOW_PLAN_BY_STEP[step - 1]!;
      state.laneRotation.push(planned.lane);
      if (step === COMPENSATION_STEP) {
        // The re-plan proposal set: evaluate every proposal through the
        // double-act guard BEFORE selecting the compensation action.
        for (const proposed of REPLAN_PROPOSALS_AT_COMPENSATION) {
          if (proposed === "l16-step-compensation-rollback") continue;
          if (!doubleActAllowed(proposed, state.actionClaims, state.compensatedActions)) {
            // Concurrency: the uncompensated re-execution is blocked.
            state.doubleActBlocks.push({ step, itemId: proposed });
          }
        }
      }
      return {
        contextId: `ctx-l16-${step}-lane-${planned.lane}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l16-orchestrated-fulfillment",
          version: "1",
          kind: "complete-task",
          params: { process: "purchase-order", orchestration: "concurrent-plans", poValueUsd: PO_VALUE_USD },
        },
        attentionPolicy: {
          policyId: "ap-l16-ops-balanced",
          version: "1",
          style: "balanced",
          params: { maxStepsPerHour: 20 },
        },
        candidates: {
          setId: `cs-l16-${step}`,
          candidates: workflowCandidates(step).map((candidate) => ({ ...candidate })),
        },
        constraints: orchestrationConstraints(),
        policySelector: { policyId: "meridian-ops-orchestration-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
        planId: PLAN_IDS[planned.lane],
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const action = stepActionByItemId(result.selectedExperience?.itemId);
      const planned = WORKFLOW_PLAN_BY_STEP[step - 1]!;
      state.presentations += 1;
      if (action === undefined) {
        return { presented: false };
      }
      // Action-claim registry: exactly one claiming plan per execution.
      const isSharedAction = action.itemId === "l16-step-budget-check";
      const claim: ActionClaim = {
        itemId: action.itemId,
        lane: planned.lane,
        step,
        // A shared action claimed once, with the other lane's need merged.
        mergedLane: isSharedAction ? "vendor" : null,
      };
      if (isSharedAction) {
        state.sharedActionClaims.push(claim);
      }
      state.actionClaims.push(claim);
      // Approval-chain state machine (procurement lane).
      switch (action.itemId) {
        case "l16-step-po-submit":
          state.approvalChainStates.push({ step, state: "submitted" });
          break;
        case "l16-step-manager-approval":
          state.approvalChainStates.push({ step, state: "manager-approved" });
          break;
        case "l16-step-director-approval":
          state.approvalChainStates.push({ step, state: "director-approved" });
          break;
        case "l16-step-budget-check":
          state.approvalChainStates.push({ step, state: "budget-verified" });
          break;
        case "l16-step-payment-dispatch":
          state.approvalChainStates.push({
            step,
            state: step === RETRY_DISPATCH_STEP ? "dispatched" : "dispatch-failed",
          });
          break;
        case "l16-step-compensation-rollback":
          state.approvalChainStates.push({ step, state: "compensated" });
          break;
        default:
          break;
      }
      // Vendor-lane lifecycle.
      switch (action.itemId) {
        case "l16-step-vendor-onboard":
          state.vendorStates.push({
            step,
            state: state.vendorStates.length === 0 ? "opened" : "completed",
          });
          break;
        case "l16-step-compliance-review":
          state.vendorStates.push({ step, state: "compliance-reviewed" });
          break;
        default:
          break;
      }
      if (action.itemId === "l16-step-compensation-rollback") {
        // Compensation: the failed dispatch is compensated — its
        // re-execution is unlocked (exactly one compensated retry).
        state.compensationSteps.push(step);
        state.compensatedActions.push("l16-step-payment-dispatch");
        state.compensationUnlocks.push({ step, itemId: "l16-step-payment-dispatch" });
      }
      // Audit ledger: every step, decision-linked, append-only.
      state.auditLedger.push({
        step,
        planId: PLAN_IDS[planned.lane],
        lane: planned.lane,
        decisionId: result.decisionId,
        itemId: action.itemId,
        outcomeEventId: null,
      });
      liveExperience = result.selectedExperience;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const action = stepActionByItemId(result.selectedExperience?.itemId) ?? WORKFLOW_STEPS[0]!;
      const compensation = step === COMPENSATION_STEP;
      const dispatched = step === RETRY_DISPATCH_STEP;
      const failed = step === BANK_FAILURE_STEP;
      const vendorCompleted = action.itemId === "l16-step-vendor-onboard" && state.vendorStates.some(
        (entry) => entry.step === step && entry.state === "completed",
      );
      let eventType: "start" | "completion" | "conversion" | "correction" | "custom" = "custom";
      let customEventType: string | undefined = "approval-granted";
      const metrics: Record<string, number> = {
        approverRank: action.approverRank,
        poValueUsd: PO_VALUE_USD,
      };
      if (compensation) {
        eventType = "correction";
        customEventType = "compensation-rollback";
        metrics.compensatedActions = 1;
        metrics.rollbackDepth = 1;
      } else if (dispatched) {
        eventType = "conversion";
        customEventType = undefined;
        metrics.recoveredAfterCompensation = 1;
        metrics.auditEntries = state.auditLedger.length;
      } else if (failed) {
        customEventType = "dispatch-failed";
        metrics.failureCode = 1;
        metrics.retryable = 1;
      } else if (vendorCompleted) {
        eventType = "completion";
        customEventType = undefined;
        metrics.vendorPacketSections = 4;
        metrics.onboardingDays = 2;
      } else {
        if (action.itemId === "l16-step-po-submit") {
          customEventType = undefined;
        } else if (action.itemId === "l16-step-vendor-onboard") {
          customEventType = "plan-opened";
        } else if (action.itemId === "l16-step-compliance-review") {
          customEventType = "compliance-reviewed";
        } else if (action.itemId === "l16-step-budget-check") {
          customEventType = "budget-verified";
          metrics.budgetHeadroomUsd = 86_000;
          metrics.sharedActionMergedLanes = 2;
        }
        if (state.outcomeSteps.length === 1) {
          eventType = "start";
          customEventType = undefined;
        }
      }
      state.outcomeTypes.push(eventType);
      const outcome = {
        eventId: `ev-l16-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics,
        ...(eventType === "correction" && dispatchEventId !== "" ? { correctsEventId: dispatchEventId } : {}),
        idempotencyKey: `idem-out-l16-${step}`,
      };
      if (failed) {
        dispatchEventId = outcome.eventId;
      }
      // Audit linkage: the ledger entry gains its outcome event id.
      const ledgerIndex = state.auditLedger.findIndex((entry) => entry.step === step);
      if (ledgerIndex >= 0) {
        state.auditLedger[ledgerIndex] = { ...state.auditLedger[ledgerIndex]!, outcomeEventId: outcome.eventId };
      }
      return outcome;
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const action = stepActionByItemId(result.selectedExperience?.itemId) ?? WORKFLOW_STEPS[0]!;
      const dimension = `workflow.${action.domain}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.workflowWeights.get(action.domain) ?? 1) + 0.1;
      state.workflowWeights.set(action.domain, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l16-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.4 + 0.05 * step),
        model: { modelId: "meridian-workflow-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get concurrentPlanIds() { return [PLAN_IDS.procurement, PLAN_IDS.vendor]; },
      get laneRotation() { return [...state.laneRotation]; },
      get actionClaims() { return state.actionClaims.map((entry) => ({ ...entry })); },
      get sharedActionClaims() { return state.sharedActionClaims.map((entry) => ({ ...entry })); },
      get doubleActBlocks() { return state.doubleActBlocks.map((entry) => ({ ...entry })); },
      get compensationSteps() { return [...state.compensationSteps]; },
      get compensationUnlocks() { return state.compensationUnlocks.map((entry) => ({ ...entry })); },
      get approvalChainStates() { return state.approvalChainStates.map((entry) => ({ ...entry })); },
      get vendorStates() { return state.vendorStates.map((entry) => ({ ...entry })); },
      get auditLedger() { return state.auditLedger.map((entry) => ({ ...entry })); },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get workflowWeights() { return Object.fromEntries([...state.workflowWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level16EnterpriseWorkflowMeta = {
  level: 16,
  name: "Enterprise workflow orchestration",
  hostAdapterId: "adapter-l16-enterprise-workflow-1",
  requiredCapabilities: 14,
  expectedSatisfied: 12,
  expectedPartial: 2,
  expectedMissing: 0,
  expectedGaps: [
    "plan-management|COMPOSITION_GAP",
    "evidence-retrieval|COMPOSITION_GAP",
  ] as readonly string[],
} as const;
