/**
 * SIM-005 — Ladder Level 15: the B2B SAAS WORKSPACE synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "B2B SaaS workspace — roles, teams, workflow context, multi-actor
 *    objectives."
 *
 * The host owns a team workspace product (host-owned action catalog,
 * role/permission matrix, workflow state, team roster — architecture
 * law: Reckon NEVER owns role or permission authority) and asks Reckon
 * for the next workspace-action decision through the PUBLIC surface
 * only: manifest → connect sources → per step: candidates → decision
 * request (objective, attention policy, constraints, multi-actor
 * reward) → host presents → outcome → preference delta. The subject is
 * ACCOUNT-scoped (the workspace team), the tenant carries an explicit
 * workspaceId, and every request declares the team's competing
 * multi-actor reward (team throughput vs interruption cost vs admin
 * compliance) — the SIM-003 reward surface.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - roles: a 3-actor team (member, admin, owner) rotates the
 *   requesting actor per step; admin-scoped actions (the sprint
 *   report, the approval queue) requested by a member are
 *   requested-but-not-presented (no outcome, no delta) — role
 *   permission enforcement is HOST authority exercised at
 *   presentation (the step-3 sprint-report deferral completes at
 *   step 8 when an admin requests it: the deferred-then-completed arc);
 * - workflow context: the workspace's active workflow rotates
 *   standup → sprint → approvals → retro → sprint; only
 *   workflow-appropriate actions are eligible candidates (a mechanical
 *   eligibility matrix, re-checked per step; the canonical run records
 *   zero violations) and the workflow rides the request's opaque
 *   contextId (ctx-l15-{step}-wf-{workflow}) — the context AUTHORITY
 *   stays host-side;
 * - multi-actor objectives: every request carries the declared,
 *   versioned team reward (task-success 0.5 / interruption-regret 0.3 /
 *   custom admin-compliance 0.2) — competing actor objectives ride the
 *   standard decision request, constraints stay separate from reward;
 * - the production-outage alert at step 7 (source "host-time-critical",
 *   the responder's well-known interrupt source) INTERRUPTs the retro
 *   board with a retained checkpoint — on-call preempts ceremony;
 * - outcomes: start (first card), card-refresh (CONTINUE), impression
 *   (card shown), conversion (the admin clears the approval queue),
 *   interruption-accept (outage ack), completion (the sprint report
 *   finally generated).
 *
 * Verdict: Reckon-Complete (12/12 satisfied, fixture evidence) — this
 * wave's complete level: roles, workflow context and multi-actor
 * objectives are exercised as HOST authority + standard-loop
 * declarations, needing nothing beyond the six public operations.
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
 *   (the role / workflow / eligibility / reward code);
 * - `functions` — the named host functions: actionByItemId, roleRank,
 *   roleAllows, workflowAllowsAction, workspaceCandidates,
 *   workspaceConstraints, teamReward, provideDecisionInputs,
 *   consumeDecision, provideOutcome, providePreferenceDelta,
 *   createLevel15B2bSaasHost (12 total).
 */
import type {
  DecisionResult,
  HostDecisionReaction,
  HostDecisionInputs,
  CatalogItemInput,
  RealizationInput,
  RewardSpecInput,
  SimulationHostAdapter,
  SimulationManifestContentInput,
  SubjectReference,
  TenantScope,
} from "../harness/host-adapter.js";
import type { HardConstraint } from "@reckon/contracts";
import type { ExperienceInput } from "../harness/port.js";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l15-b2b-saas", workspaceId: "ws-l15-northbay" };
const SUBJECT: SubjectReference = { kind: "account", ref: "acct-l15-northbay-design" };

// --- glue:adapter:begin ----------------------------------------------------
// The workspace world: 6 next-best-action cards, a 3-actor team with a
// role/permission matrix, a rotating workflow context, and the team's
// declared multi-actor reward. Roles, permissions and workflow state
// are HOST-owned (architecture law — Reckon never owns them).

type WorkspaceRole = "member" | "admin" | "owner";
type WorkflowStage = "standup" | "sprint" | "approvals" | "retro";

interface WorkspaceAction {
  readonly itemId: string;
  readonly title: string;
  readonly domain: string;
  readonly minRole: WorkspaceRole;
  readonly realizationId: string;
  readonly effortMinutes: number;
}

const WORKSPACE_ACTIONS: readonly WorkspaceAction[] = [
  { itemId: "l15-action-standup-summary", title: "Automated standup digest", domain: "standup", minRole: "member", realizationId: "l15-card-standup-slack", effortMinutes: 2 },
  { itemId: "l15-action-sprint-report", title: "Sprint report generation", domain: "sprint", minRole: "admin", realizationId: "l15-card-sprint-inapp", effortMinutes: 15 },
  { itemId: "l15-action-approval-queue", title: "Pending approvals digest", domain: "approvals", minRole: "admin", realizationId: "l15-card-approvals-inapp", effortMinutes: 12 },
  { itemId: "l15-action-onboarding-task", title: "Member onboarding checklist", domain: "onboarding", minRole: "member", realizationId: "l15-card-onboarding-slack", effortMinutes: 6 },
  { itemId: "l15-action-integration-alert", title: "Integration health alert", domain: "integrations", minRole: "member", realizationId: "l15-card-integration-slack", effortMinutes: 3 },
  { itemId: "l15-action-retro-board", title: "Retrospective board setup", domain: "retro", minRole: "member", realizationId: "l15-card-retro-inapp", effortMinutes: 8 },
];

/** The team roster (3 actors; the requesting actor rotates per step). */
const TEAM_ROSTER_SIZE = 3;
/** Role authority order (member < admin < owner — HOST authority). */
const ROLE_RANK: Readonly<Record<WorkspaceRole, number>> = Object.freeze({ member: 1, admin: 2, owner: 3 });
/** The workflow-eligibility matrix (which actions each workflow admits). */
const WORKFLOW_ACTIONS: Readonly<Record<WorkflowStage, readonly string[]>> = Object.freeze({
  standup: ["l15-action-standup-summary", "l15-action-onboarding-task"],
  sprint: ["l15-action-sprint-report", "l15-action-integration-alert"],
  approvals: ["l15-action-approval-queue", "l15-action-onboarding-task"],
  retro: ["l15-action-retro-board"],
});
/** The step at which the production outage alert interrupts the retro. */
const OUTAGE_STEP = 7;
/** The step of the role-gated sprint-report deferral (a member requests it). */
const SPRINT_REPORT_DEFERRAL_STEP = 3;

/** The requesting actor's role per step (deterministic team rotation). */
const ROLE_BY_STEP: readonly WorkspaceRole[] = [
  "member", // 1
  "admin", // 2
  "member", // 3
  "member", // 4
  "admin", // 5
  "owner", // 6
  "member", // 7
  "admin", // 8
];

/** The active workflow per step (deterministic context rotation). */
const WORKFLOW_BY_STEP: readonly WorkflowStage[] = [
  "standup", // 1
  "standup", // 2
  "sprint", // 3
  "sprint", // 4
  "approvals", // 5
  "retro", // 6
  "retro", // 7
  "sprint", // 8
];

/** The scripted requested action per step (deterministic). */
const REQUESTED_ACTION_BY_STEP: readonly string[] = [
  "l15-action-standup-summary", // 1
  "l15-action-standup-summary", // 2
  "l15-action-sprint-report", // 3 (role-gated: member < admin)
  "l15-action-integration-alert", // 4
  "l15-action-approval-queue", // 5
  "l15-action-retro-board", // 6
  "l15-action-integration-alert", // 7 (outage: time-critical)
  "l15-action-sprint-report", // 8 (admin: the deferral completes)
];

interface RoleGateEntry {
  readonly step: number;
  readonly role: WorkspaceRole;
  readonly minRole: WorkspaceRole;
  readonly allowed: boolean;
}

interface Level15WorldState {
  presentations: number;
  roleGateLedger: RoleGateEntry[];
  roleDeferrals: number[];
  workflowRotation: WorkflowStage[];
  roleRotation: WorkspaceRole[];
  workflowEligibilityViolations: Array<{ readonly step: number; readonly itemId: string }>;
  rewardDeclaredSteps: number[];
  interruptionSteps: number[];
  conversionSteps: number[];
  completionSteps: number[];
  refreshSteps: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  domainWeights: Map<string, number>;
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level15WorldView {
  readonly presentations: number;
  readonly teamRosterSize: number;
  readonly roleGateLedger: readonly RoleGateEntry[];
  readonly roleDeferrals: readonly number[];
  readonly workflowRotation: readonly WorkflowStage[];
  readonly roleRotation: readonly WorkspaceRole[];
  readonly workflowEligibilityViolations: readonly { readonly step: number; readonly itemId: string }[];
  readonly rewardDeclaredSteps: readonly number[];
  readonly interruptionSteps: readonly number[];
  readonly conversionSteps: readonly number[];
  readonly completionSteps: readonly number[];
  readonly refreshSteps: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly domainWeights: Readonly<Record<string, number>>;
}

/** Host catalog knowledge: the action behind an item id. */
function actionByItemId(itemId: string | undefined): WorkspaceAction | undefined {
  return WORKSPACE_ACTIONS.find((action) => action.itemId === itemId);
}

/** The authority rank of a role (member < admin < owner). */
function roleRank(role: WorkspaceRole): number {
  return ROLE_RANK[role];
}

/** The role gate: may this actor see this admin-scoped action? */
function roleAllows(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return roleRank(role) >= roleRank(action.minRole);
}

/** The workflow gate: does the active workflow admit this action? */
function workflowAllowsAction(workflow: WorkflowStage, action: WorkspaceAction): boolean {
  return (WORKFLOW_ACTIONS[workflow] ?? []).includes(action.itemId);
}

/** Retrieval: the requested workspace action for this step. */
function workspaceCandidates(step: number): {
  readonly itemId: string;
  readonly realizationIds: string[];
  readonly source: string;
  readonly rankHint: number;
}[] {
  const itemId = REQUESTED_ACTION_BY_STEP[step - 1]!;
  const action = actionByItemId(itemId)!;
  let source = "host-workflow-next";
  if (step === 2) {
    source = "host-workflow-track";
  } else if (step === OUTAGE_STEP) {
    source = "host-time-critical";
  }
  return [{ itemId: action.itemId, realizationIds: [action.realizationId], source, rankHint: 1 }];
}

/** Role/workflow constraints on every request (HOST authority carried). */
function workspaceConstraints(workflow: WorkflowStage): HardConstraint[] {
  return [
    { kind: "policy-rights", gateId: "l15-workspace-roles" },
    { kind: "catalog-rule", ruleId: `l15-workflow-${workflow}` },
    { kind: "max-latency", latencyMs: 200 },
  ];
}

/** The team's declared multi-actor reward (competing actor objectives). */
function teamReward(): RewardSpecInput {
  return {
    rewardId: "l15-team-objective",
    version: "1",
    terms: [
      { termId: "l15-term-team-throughput", version: "1", kind: "task-success", weight: 0.5, params: { lane: "workspace-actions" } },
      { termId: "l15-term-interruption-cost", version: "1", kind: "interruption-regret", weight: 0.3, params: { channel: "in-app" } },
      { termId: "l15-term-admin-compliance", version: "1", kind: "custom", customKind: "admin-compliance", weight: 0.2, params: { policy: "role-gates" } },
    ],
  };
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL15_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: WORKSPACE_ACTIONS.map((action) => ({
    itemId: action.itemId,
    kind: "notification" as const,
    labels: ["workspace-action", action.domain, `min-role-${action.minRole}`],
    attributes: {
      title: action.title,
      domain: action.domain,
      minRole: action.minRole,
      effortMinutes: action.effortMinutes,
    },
  })),
  realizations: WORKSPACE_ACTIONS.map((action) => ({
    realizationId: action.realizationId,
    itemId: action.itemId,
    kind: "workspace-card",
    constraints: {
      channel: action.realizationId.endsWith("-slack") ? "slack" : "in-app",
      minRole: action.minRole,
      effortMinutes: action.effortMinutes,
    },
  })),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL15_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l15-b2b-saas",
    name: "Northbay Teamflow",
    hostAdapterId: "adapter-l15-b2b-saas-1",
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
      notes: "the workspace action catalog with role-scoped delivery characteristics",
    },
    {
      capability: "realization-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertRealization"],
      notes: "card realizations carry the host-owned channel (slack/in-app), min-role and effort minutes",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "the workflow-rotation candidates (role-gated steps are requested-but-not-presented)",
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "the multi-actor workspace objective is declared on every decision request, alongside the declared team reward (competing actor objectives ride the standard request — SIM-003 reward surface)",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "policy-rights workspace-role gate + workflow catalog rule + max-latency budget on every request — the constraints CARRY the host gates, Reckon never grants role authority",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "balanced attention; the production-outage alert (host-time-critical) is the admitted interrupt",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "requests carry currentExperience for the live card (CONTINUE refresh, SWITCH new cards, INTERRUPT on the outage alert) and the account-scoped team subject",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (QUEUE first card, CONTINUE card refresh, SWITCH new cards, INTERRUPT outage alert with retained checkpoint)",
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "conversion (approvals cleared), completion (the role-deferred sprint report finally generated), interruption-accept (outage ack)",
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
  ],
};

/** The Level 15 Reckon-Complete profile: what this archetype REQUIRES. */
export const level15B2bSaasProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l15-b2b-saas",
  name: "B2B SaaS workspace",
  description: "SIM-005 ladder level 15 — roles, teams, workflow context, multi-actor objectives.",
  ladderLevel: 15,
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
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 15 host (fresh world state — replay-safe by construction). */
export interface Level15Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level15WorldView;
}

export function createLevel15B2bSaasHost(): Level15Host {
  const state: Level15WorldState = {
    presentations: 0,
    roleGateLedger: [],
    roleDeferrals: [],
    workflowRotation: [],
    roleRotation: [],
    workflowEligibilityViolations: [],
    rewardDeclaredSteps: [],
    interruptionSteps: [],
    conversionSteps: [],
    completionSteps: [],
    refreshSteps: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    domainWeights: new Map([
      ["approvals", 1],
      ["integrations", 1],
      ["onboarding", 1],
      ["retro", 1],
      ["sprint", 1],
      ["standup", 1],
    ]),
  };
  /** The experience the previous PRESENTED decision selected (the live card). */
  let liveExperience: ExperienceInput | undefined;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l15-b2b-saas-1",
    hostSystem: {
      hostId: "host-l15-b2b-saas",
      name: "Northbay Teamflow",
      version: "0.1.0",
    },
    glue: { functions: 12, loc: 509, customAdapterLoc: 145 },
    manifestContent: LEVEL15_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL15_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL15_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const workflow = WORKFLOW_BY_STEP[step - 1]!;
      const role = ROLE_BY_STEP[step - 1]!;
      state.workflowRotation.push(workflow);
      state.roleRotation.push(role);
      state.rewardDeclaredSteps.push(step);
      const action = actionByItemId(REQUESTED_ACTION_BY_STEP[step - 1])!;
      // Workflow-context eligibility: the requested action must belong
      // to the active workflow (mechanical guard, HOST authority) —
      // EXCEPT emergency interrupts (the time-critical source), which
      // are cross-workflow by nature (a production outage preempts
      // whatever workflow is active).
      const plannedSource = workspaceCandidates(step)[0]!.source;
      if (plannedSource !== "host-time-critical" && !workflowAllowsAction(workflow, action)) {
        state.workflowEligibilityViolations.push({ step, itemId: action.itemId });
      }
      return {
        contextId: `ctx-l15-${step}-wf-${workflow}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l15-team-effectiveness",
          version: "1",
          kind: "complete-task",
          params: { surface: "workspace", actors: "multi-role", teamRosterSize: TEAM_ROSTER_SIZE },
        },
        attentionPolicy: {
          policyId: "ap-l15-team-balanced",
          version: "1",
          style: "balanced",
          params: { maxCardsPerDigest: 3 },
        },
        candidates: {
          setId: `cs-l15-${step}`,
          candidates: workspaceCandidates(step).map((candidate) => ({ ...candidate })),
        },
        constraints: workspaceConstraints(workflow),
        policySelector: { policyId: "northbay-teamflow-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
        reward: teamReward(),
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const action = actionByItemId(result.selectedExperience?.itemId);
      const role = ROLE_BY_STEP[step - 1]!;
      state.presentations += 1;
      // Role permission gate: decisions must respect role permissions —
      // enforced at presentation (HOST authority).
      const roleOk = action !== undefined && roleAllows(role, action);
      state.roleGateLedger.push({
        step,
        role,
        minRole: action?.minRole ?? "member",
        allowed: roleOk,
      });
      if (!roleOk) {
        // Admin-scoped action requested by a lesser role:
        // requested-but-not-presented (no outcome, no delta).
        state.roleDeferrals.push(step);
        return { presented: false };
      }
      if (result.action === "INTERRUPT") {
        // The production outage alert interrupts the retro board.
        state.interruptionSteps.push(step);
      } else if (result.action === "CONTINUE") {
        state.refreshSteps.push(step);
      }
      liveExperience = result.selectedExperience;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const action = actionByItemId(result.selectedExperience?.itemId) ?? WORKSPACE_ACTIONS[0]!;
      const interrupted = state.interruptionSteps.includes(step);
      const refreshed = state.refreshSteps.includes(step);
      const clearedApprovals = action.itemId === "l15-action-approval-queue";
      const reportCompleted = action.itemId === "l15-action-sprint-report";
      let eventType: "start" | "completion" | "conversion" | "interruption-accept" | "custom" | "impression" =
        "impression";
      let customEventType: string | undefined;
      const metrics: Record<string, number> = {
        effortMinutes: action.effortMinutes,
        teamActors: TEAM_ROSTER_SIZE,
      };
      if (interrupted) {
        eventType = "interruption-accept";
        metrics.alertSeverity = 5;
        metrics.ackMinutes = 2;
      } else if (clearedApprovals) {
        eventType = "conversion";
        state.conversionSteps.push(step);
        metrics.approvalsCleared = 3;
        metrics.approvalValueUsd = 4500;
      } else if (reportCompleted) {
        eventType = "completion";
        state.completionSteps.push(step);
        metrics.reportSections = 6;
        metrics.deferredSinceStep = SPRINT_REPORT_DEFERRAL_STEP;
      } else if (refreshed) {
        eventType = "custom";
        customEventType = "card-refresh";
        metrics.progressPct = 100;
      } else if (state.outcomeSteps.length === 1) {
        eventType = "start";
      } else {
        eventType = "impression";
      }
      state.outcomeTypes.push(eventType);
      return {
        eventId: `ev-l15-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics,
        idempotencyKey: `idem-out-l15-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const action = actionByItemId(result.selectedExperience?.itemId) ?? WORKSPACE_ACTIONS[0]!;
      const dimension = `domain.${action.domain}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.domainWeights.get(action.domain) ?? 1) + 0.15;
      state.domainWeights.set(action.domain, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l15-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "northbay-domain-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get teamRosterSize() { return TEAM_ROSTER_SIZE; },
      get roleGateLedger() { return state.roleGateLedger.map((entry) => ({ ...entry })); },
      get roleDeferrals() { return [...state.roleDeferrals]; },
      get workflowRotation() { return [...state.workflowRotation]; },
      get roleRotation() { return [...state.roleRotation]; },
      get workflowEligibilityViolations() { return state.workflowEligibilityViolations.map((entry) => ({ ...entry })); },
      get rewardDeclaredSteps() { return [...state.rewardDeclaredSteps]; },
      get interruptionSteps() { return [...state.interruptionSteps]; },
      get conversionSteps() { return [...state.conversionSteps]; },
      get completionSteps() { return [...state.completionSteps]; },
      get refreshSteps() { return [...state.refreshSteps]; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get domainWeights() { return Object.fromEntries([...state.domainWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level15B2bSaasMeta = {
  level: 15,
  name: "B2B SaaS workspace",
  hostAdapterId: "adapter-l15-b2b-saas-1",
  requiredCapabilities: 12,
  expectedSatisfied: 12,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;
