/**
 * SIM-006 — Ladder Level 17: the MULTI-AGENT OPERATIONS synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Multi-agent operations — Agent Organizations, delegation, budgets,
 *    termination, single-agent baseline."
 *
 * The host owns a knowledge-ops task board (HiveOps Dispatch) whose work
 * is executed by a host-owned AGENT ORGANIZATION: Agent Bodies as
 * capability envelopes, a searchable delegation graph, org budgets,
 * termination rules — all declared against the FROZEN
 * @reckon/contracts agent contracts (validated host-side, public surface
 * only) and all executed host-side (architecture law: the host owns its
 * agent runtime; Reckon never becomes a second scheduler/router).
 *
 * Per step the host asks Reckon for the next work-product decision
 * through the PUBLIC standard loop only: manifest → connect sources →
 * candidates → decision request (objective, attention policy,
 * constraints, currentExperience, planId) → host presents → outcome →
 * preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - delegation: tasks route to specialist bodies via graph search over
 *   the delegation edges (coordinator→research, coordinator→writer,
 *   writer→reviewer report); candidates carry the routing provenance
 *   (source "agent-delegate:<bodyId>");
 * - escalation: the reviewer's escalate edge (reviewer→coordinator)
 *   re-dispatches research as a time-critical candidate (the responder's
 *   well-known "host-time-critical" source) → INTERRUPT with checkpoint;
 * - re-draft: the checkpointed draft resumes with updated sources (the
 *   well-known "host-resume" source) → RESUME;
 * - budgets: the org carries a calls budget (5 delegations) and a cost
 *   budget (USD 4.00); when the delegation budget cannot cover the step
 *   6 review, the budget-exhausted termination rule fires and the
 *   coordinator finishes the remaining work SOLO
 *   (source "agent-solo-fallback");
 * - termination: recorded world facts — budget-exhausted at step 6,
 *   task-complete at step 8;
 * - single-agent baseline (MANDATORY for every multi-agent case): the
 *   same task stream executed by ONE body
 *   (createLevel17SingleAgentBaselineHost) — same public surface, no
 *   delegation, flat per-task cost, scripted lower quality score;
 *   carried on the multi-agent case's evidence (case-doc comparison).
 *
 * LAWS obeyed (SIM-006 work order):
 * - zero internal Reckon imports — only @reckon/contracts (types +
 *   schemas for host-side validation of the agent declarations) and the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate);
 * - the Agent Organization is host-owned state: it cannot cross the
 *   composed harness path (the SDK/API expose agents.createBody /
 *   agents.createOrganization, but the SIM-001 port composes only the
 *   six standard-loop operations) — probed honestly as an
 *   agent-delegation COMPOSITION_GAP record, never an internal import.
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-d.test.ts):
 * - org host `loc` — comment-stripped non-blank lines of THIS module
 *   (which lawfully contains BOTH the org host and its mandatory
 *   single-agent baseline);
 * - org host `customAdapterLoc` — lines between the `glue:adapter`
 *   markers below (the org world / routing / budget / termination code);
 * - baseline host `loc`/`customAdapterLoc` — lines between the
 *   `glue:baseline` markers (the single-agent baseline world code);
 * - org host `functions` — the named host functions: bodyForTask,
 *   delegationPath, orgExecutionCostUsd, orgTaskCandidates,
 *   realizationIdFor, createLevel17WorldState,
 *   createLevel17MultiAgentHost + its four adapter callbacks (10);
 * - baseline host `functions` — soloTaskCandidates,
 *   createLevel17SingleAgentBaselineHost + its four adapter callbacks (6).
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
import { AgentBodySchema, AgentOrganizationSchema } from "@reckon/contracts";
import type { AgentBody, AgentOrganization } from "@reckon/contracts";
import type { ExperienceInput } from "../harness/port.js";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l17-hiveops" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l17-knowledge-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The agent-operations world: a host-owned Agent Organization (frozen
// contracts, validated host-side) executing a knowledge-ops task board.
// The org graph, budgets, and termination rules are HOST authority.

/** The org's work-product bodies (capability envelopes — frozen contract). */
const ORG_BODY_SPECS = [
  {
    bodyId: "l17-body-coordinator",
    roleId: "task-dispatch",
    description: "Routes tasks across the organization and finishes work solo when budgets exhaust.",
    tools: [{ toolId: "l17-tool-task-router", name: "task-router" }],
    observations: [{ observationId: "l17-obs-task-board", kind: "system" }],
    permissions: [{ permissionId: "l17-perm-dispatch", capability: "tool" }],
    memoryInterfaces: [{ memoryId: "l17-mem-task-board", kind: "shared", access: "read-write" }],
    actions: [
      { actionId: "l17-act-select", kind: "select" },
      { actionId: "l17-act-end", kind: "end" },
    ],
    budgets: [],
    latencyLimits: { hardMs: 500 },
  },
  {
    bodyId: "l17-body-research",
    roleId: "source-research",
    description: "Retrieves and verifies source material for the task board.",
    tools: [{ toolId: "l17-tool-source-sweep", name: "source-sweep" }],
    observations: [{ observationId: "l17-obs-catalog", kind: "catalog" }],
    permissions: [{ permissionId: "l17-perm-read", capability: "read" }],
    memoryInterfaces: [{ memoryId: "l17-mem-task-board", kind: "shared", access: "read" }],
    actions: [{ actionId: "l17-act-select", kind: "select" }],
    budgets: [{ kind: "cost", limit: 1.5, currency: "USD" }],
    latencyLimits: { softMs: 200, hardMs: 400 },
  },
  {
    bodyId: "l17-body-writer",
    roleId: "drafting",
    description: "Drafts deliverables from verified source packs.",
    tools: [{ toolId: "l17-tool-draft-editor", name: "draft-editor" }],
    observations: [{ observationId: "l17-obs-outcome", kind: "outcome" }],
    permissions: [{ permissionId: "l17-perm-write", capability: "write" }],
    memoryInterfaces: [{ memoryId: "l17-mem-task-board", kind: "shared", access: "read-write" }],
    actions: [
      { actionId: "l17-act-select", kind: "select" },
      { actionId: "l17-act-queue", kind: "queue" },
    ],
    budgets: [{ kind: "cost", limit: 1.2, currency: "USD" }],
    latencyLimits: { softMs: 250, hardMs: 600 },
  },
  {
    bodyId: "l17-body-reviewer",
    roleId: "quality-review",
    description: "Reviews drafts and escalates gaps back to the coordinator.",
    tools: [{ toolId: "l17-tool-qa-check", name: "qa-check" }],
    observations: [{ observationId: "l17-obs-preference", kind: "preference" }],
    permissions: [{ permissionId: "l17-perm-read", capability: "read" }],
    memoryInterfaces: [{ memoryId: "l17-mem-task-board", kind: "shared", access: "read" }],
    actions: [
      { actionId: "l17-act-ask", kind: "ask" },
      { actionId: "l17-act-custom-escalate", kind: "custom", customKind: "escalate" },
    ],
    budgets: [{ kind: "cost", limit: 0.9, currency: "USD" }],
    latencyLimits: { softMs: 150, hardMs: 300 },
    evaluator: { evaluatorId: "l17-eval-review-rubric", version: "1" },
  },
] as const;

/** The validated bodies (contract parity proof — frozen zod schemas). */
const ORG_BODIES: readonly AgentBody[] = ORG_BODY_SPECS.map((spec) =>
  AgentBodySchema.parse({
    bodyId: spec.bodyId,
    version: "1",
    role: { roleId: spec.roleId, description: spec.description },
    observations: spec.observations,
    tools: spec.tools,
    permissions: spec.permissions,
    memoryInterfaces: spec.memoryInterfaces,
    actions: spec.actions,
    budgets: spec.budgets,
    latencyLimits: spec.latencyLimits,
    ...( "evaluator" in spec ? { evaluator: spec.evaluator } : {}),
  }),
);

/** The delegation graph (searchable — the host walks it per task). */
const ORG_EDGES = [
  { edgeId: "l17-edge-dispatch-research", fromBodyId: "l17-body-coordinator", toBodyId: "l17-body-research", kind: "delegate" },
  { edgeId: "l17-edge-dispatch-writer", fromBodyId: "l17-body-coordinator", toBodyId: "l17-body-writer", kind: "delegate" },
  { edgeId: "l17-edge-writer-review", fromBodyId: "l17-body-writer", toBodyId: "l17-body-reviewer", kind: "report" },
  { edgeId: "l17-edge-review-escalate", fromBodyId: "l17-body-reviewer", toBodyId: "l17-body-coordinator", kind: "escalate" },
] as const;

/** Org-level budgets: 5 delegations, USD 4.00 of execution cost. */
const DELEGATION_BUDGET = 5;
const COST_BUDGET_USD = 4.0;

/** The scripted per-body execution costs (fixture world constants). */
const BODY_COST_USD: Readonly<Record<string, number>> = Object.freeze({
  "l17-body-research": 0.5,
  "l17-body-writer": 0.4,
  "l17-body-reviewer": 0.3,
  "l17-body-coordinator": 0.25,
});

/** The validated Agent Organization (frozen contract, host-owned). */
const AGENT_ORGANIZATION: AgentOrganization = AgentOrganizationSchema.parse({
  organizationId: "l17-org-hiveops-dispatch",
  version: "1",
  bodies: ORG_BODIES.map((body) => ({ ...body })),
  edges: ORG_EDGES.map((edge) => ({ ...edge })),
  memoryTopology: {
    sharedMemories: [{ memoryId: "l17-mem-task-board", bodyIds: ORG_BODIES.map((body) => body.bodyId) }],
    privateMemories: [],
  },
  modelAssignments: ORG_BODIES.map((body) => ({
    bodyId: body.bodyId,
    modelAdapterId: "l17-adapter-host-local",
    modelId: "l17-model-small-fast",
    version: "1",
  })),
  budgets: [
    { kind: "calls", limit: DELEGATION_BUDGET },
    { kind: "cost", limit: COST_BUDGET_USD, currency: "USD" },
  ],
  terminationRules: [
    { kind: "max-depth", maxDepth: 3 },
    { kind: "budget-exhausted", budgetId: "l17-budget-delegations" },
    { kind: "task-complete" },
  ],
  capabilityDependencies: ["candidate-retrieval", "decision-request"],
});

/** The task-board work kinds (routed by the org graph). */
type TaskKind = "research" | "drafting" | "review" | "delivery";

interface OrgTask {
  readonly step: number;
  readonly kind: TaskKind;
  readonly itemId: string;
  /** The retrieval provenance the routed candidate carries. */
  readonly source: string;
  /** The escalation re-dispatch (time-critical interrupt). */
  readonly escalated: boolean;
  /** The post-escalation re-draft (resume of the checkpointed draft). */
  readonly resume: boolean;
}

const ORG_TASKS: readonly OrgTask[] = [
  { step: 1, kind: "research", itemId: "l17-item-sources", source: "agent-delegate:l17-body-research", escalated: false, resume: false },
  { step: 2, kind: "drafting", itemId: "l17-item-draft", source: "agent-delegate:l17-body-writer", escalated: false, resume: false },
  { step: 3, kind: "review", itemId: "l17-item-review", source: "agent-delegate:l17-body-reviewer", escalated: false, resume: false },
  { step: 4, kind: "research", itemId: "l17-item-sources-v2", source: "host-time-critical", escalated: true, resume: false },
  { step: 5, kind: "drafting", itemId: "l17-item-draft", source: "host-resume", escalated: false, resume: true },
  { step: 6, kind: "review", itemId: "l17-item-review-v2", source: "agent-solo-fallback", escalated: false, resume: false },
  { step: 7, kind: "delivery", itemId: "l17-item-final", source: "agent-solo-fallback", escalated: false, resume: false },
  { step: 8, kind: "delivery", itemId: "l17-item-final", source: "agent-solo-fallback", escalated: false, resume: false },
];

/** Which body owns a task kind (the graph's role → capability mapping). */
function bodyForTask(kind: TaskKind): string {
  if (kind === "research") return "l17-body-research";
  if (kind === "drafting") return "l17-body-writer";
  if (kind === "review") return "l17-body-reviewer";
  return "l17-body-coordinator";
}

/** Numeric metric codes (the frozen MetricPayload is numeric-only). */
const TASK_KIND_CODE: Readonly<Record<TaskKind, number>> = Object.freeze({
  research: 1,
  drafting: 2,
  review: 3,
  delivery: 4,
});
const BODY_CODE: Readonly<Record<string, number>> = Object.freeze({
  "l17-body-coordinator": 1,
  "l17-body-research": 2,
  "l17-body-writer": 3,
  "l17-body-reviewer": 4,
  "l17-body-solo": 5,
});

/** BFS over the delegation graph from one body to another (searchable org). */
function delegationPath(fromBodyId: string, toBodyId: string): string[] {
  if (fromBodyId === toBodyId) return [fromBodyId];
  const queue: string[][] = [[fromBodyId]];
  const seen = new Set<string>([fromBodyId]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const edge of ORG_EDGES) {
      if (edge.fromBodyId !== last || seen.has(edge.toBodyId)) continue;
      const next = [...path, edge.toBodyId];
      if (edge.toBodyId === toBodyId) return next;
      seen.add(edge.toBodyId);
      queue.push(next);
    }
  }
  return [fromBodyId];
}

/** The scripted execution cost of a body running one task (fixture). */
function orgExecutionCostUsd(bodyId: string): number {
  return BODY_COST_USD[bodyId] ?? 0.25;
}

/** The realization id serving a work product (one per item). */
function realizationIdFor(itemId: string): string {
  return `l17-real-${itemId.replace("l17-item-", "")}-standard`;
}

interface Level17WorldState {
  presentations: number;
  actionLog: string[];
  delegatedSteps: number[];
  delegationPaths: string[];
  escalationSteps: number[];
  resumeSteps: number[];
  soloFallbackSteps: number[];
  terminationStep: number;
  terminationRule: string;
  costLedgerUsd: number[];
  delegationsRemaining: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  taskWeights: Map<string, number>;
  qualityScore: number;
}

function createLevel17WorldState(): Level17WorldState {
  return {
    presentations: 0,
    actionLog: [],
    delegatedSteps: [],
    delegationPaths: [],
    escalationSteps: [],
    resumeSteps: [],
    soloFallbackSteps: [],
    terminationStep: 0,
    terminationRule: "",
    costLedgerUsd: [],
    delegationsRemaining: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    taskWeights: new Map([
      ["research", 1],
      ["drafting", 1],
      ["review", 1],
      ["delivery", 1],
    ]),
    qualityScore: 0,
  };
}

/**
 * Route one task-board step through the org graph. Delegation is a
 * ROUTING fact (the executing body is a specialist); the candidate
 * SOURCE is the schedule provenance (delegate / escalation interrupt /
 * resume). When the delegation budget cannot cover a specialist task,
 * the budget-exhausted termination rule fires and the coordinator runs
 * the task solo.
 */
function orgRouteTask(state: Level17WorldState, step: number): { task: OrgTask; delegated: boolean; toBody: string } {
  const task = ORG_TASKS[step - 1]!;
  const toBody = bodyForTask(task.kind);
  const stepsTaken = state.delegationsRemaining.length;
  const delegated = toBody !== "l17-body-coordinator" && stepsTaken < DELEGATION_BUDGET;
  if (delegated) {
    const from = task.escalated ? "l17-body-reviewer" : "l17-body-coordinator";
    state.delegationPaths.push(delegationPath(from, toBody).join(">"));
  } else if (toBody !== "l17-body-coordinator" && state.terminationStep === 0) {
    // The org wanted a specialist but the calls budget is exhausted.
    state.terminationStep = step;
    state.terminationRule = "budget-exhausted";
  }
  return { task, delegated, toBody };
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL17_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: [
    { itemId: "l17-item-sources", kind: "article", labels: ["work-product", "research"], attributes: { title: "Verified source pack", taskKind: "research" } },
    { itemId: "l17-item-sources-v2", kind: "article", labels: ["work-product", "research"], attributes: { title: "Updated source pack (post-escalation)", taskKind: "research" } },
    { itemId: "l17-item-draft", kind: "article", labels: ["work-product", "drafting"], attributes: { title: "Deliverable draft", taskKind: "drafting" } },
    { itemId: "l17-item-review", kind: "article", labels: ["work-product", "review"], attributes: { title: "Review notes", taskKind: "review" } },
    { itemId: "l17-item-review-v2", kind: "article", labels: ["work-product", "review"], attributes: { title: "Final review notes", taskKind: "review" } },
    { itemId: "l17-item-final", kind: "article", labels: ["work-product", "delivery"], attributes: { title: "Final report", taskKind: "delivery" } },
  ],
  realizations: [
    { realizationId: "l17-real-sources-standard", itemId: "l17-item-sources", kind: "org-body-execution", constraints: { bodyId: "l17-body-research", costUsd: 0.5 } },
    { realizationId: "l17-real-sources-v2-standard", itemId: "l17-item-sources-v2", kind: "org-body-execution", constraints: { bodyId: "l17-body-research", costUsd: 0.5, escalated: true } },
    { realizationId: "l17-real-draft-standard", itemId: "l17-item-draft", kind: "org-body-execution", constraints: { bodyId: "l17-body-writer", costUsd: 0.4 } },
    { realizationId: "l17-real-review-standard", itemId: "l17-item-review", kind: "org-body-execution", constraints: { bodyId: "l17-body-reviewer", costUsd: 0.3 } },
    { realizationId: "l17-real-review-v2-standard", itemId: "l17-item-review-v2", kind: "org-body-execution", constraints: { bodyId: "l17-body-coordinator", costUsd: 0.25, soloFallback: true } },
    { realizationId: "l17-real-final-standard", itemId: "l17-item-final", kind: "org-body-execution", constraints: { bodyId: "l17-body-coordinator", costUsd: 0.25, soloFallback: true } },
  ],
};

/** The shared standard-loop manifest entries (the composed public surface). */
function standardLoopSupportedCapabilities(): SimulationManifestContentInput["supportedCapabilities"] {
  return [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    { capability: "catalog-registration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/items"], sdkMethods: ["catalog.upsertItem"] },
    { capability: "realization-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/realizations"], sdkMethods: ["catalog.upsertRealization"], notes: "realization constraints carry the executing body id and scripted execution cost (Agent Bodies as capability envelopes, host-owned)" },
    { capability: "candidate-retrieval", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/candidates"], sdkMethods: ["candidates.submit"], notes: "candidate sources carry the routing provenance (agent-delegate:<bodyId>, escalation, resume, solo fallback)" },
    { capability: "objective-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "objective declared on every decision request (in-request field)" },
    { capability: "constraint-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "time-window + max-latency + catalog-rule org capability gate on every request" },
    { capability: "attention-policy", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "attention policy declared on every decision request (in-request field)" },
    { capability: "decision-request", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "requests carry currentExperience (SWITCH on delegation, INTERRUPT on escalation, RESUME on re-draft) and the task-board planId" },
    { capability: "schedule-execution", status: "supported", evidenceClass: "fixture", notes: "host-side execution of schedule deltas (delegation SWITCH, escalation INTERRUPT with retained checkpoint, re-draft RESUME, solo-fallback SWITCH/CONTINUE)" },
    { capability: "outcome-return", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/outcomes"], sdkMethods: ["outcomes.append"], notes: "outcome metrics carry the executing body, org budget state, and termination facts" },
    { capability: "preference-feedback", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/preferences/events"], sdkMethods: ["preferences.appendDelta"], notes: "task-kind affinity deltas (host-side preference model)" },
    { capability: "conformance-verification", status: "supported", evidenceClass: "fixture", notes: "harness conformance verdict; no API route — machine-checked offline" },
  ];
}

/** The host's honest capability manifest (org host, composed surface). */
const LEVEL17_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l17-hiveops",
    name: "HiveOps Dispatch",
    hostAdapterId: "adapter-l17-hiveops-org-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: standardLoopSupportedCapabilities(),
};

/** The probe manifest: the composed path cannot express agent registration. */
const LEVEL17_PROBE_MANIFEST_CONTENT: SimulationManifestContentInput = {
  ...LEVEL17_MANIFEST_CONTENT,
  supportedCapabilities: [
    ...LEVEL17_MANIFEST_CONTENT.supportedCapabilities,
    {
      capability: "agent-delegation",
      status: "partial",
      evidenceClass: "fixture",
      friction: "COMPOSITION_GAP",
      apiOperations: ["POST /v1/agents/bodies", "POST /v1/agents/organizations"],
      sdkMethods: ["agents.createBody", "agents.createOrganization"],
      notes:
        "the frozen AgentBody/AgentOrganization contracts validate the host's org declaration (bodies as capability envelopes, delegation edges, budgets, termination rules) and the SDK/API expose agents.createBody/createOrganization, but the SIM-001 harness port composes only the six standard-loop operations — the organization graph cannot cross the composed public path, so org state stays host-owned and couples through candidates/objectives/outcomes only",
    },
  ],
};

/** The Level 17 Reckon-Complete profile: what this archetype REQUIRES. */
export const level17MultiAgentProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l17-multi-agent",
  name: "Multi-agent operations",
  description: "SIM-006 ladder level 17 — Agent Organizations, delegation, budgets, termination, single-agent baseline.",
  ladderLevel: 17,
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

/** The capability-probe profile: the level also WANTS agent delegation. */
export const level17AgentDelegationProbeProfile: ReckonCompleteProfileDeclarationInput = {
  ...level17MultiAgentProfile,
  profileId: "profile-l17-multi-agent-probe",
  name: "Multi-agent operations (agent-delegation probe)",
  description:
    "SIM-006 ladder level 17 capability probe — additionally requires agent-delegation; the composed harness path cannot express it (honest COMPOSITION_GAP).",
  requiredCapabilities: [
    ...level17MultiAgentProfile.requiredCapabilities,
    { capability: "agent-delegation" },
  ],
};

/** The mandatory single-agent baseline profile (same required envelope). */
export const level17SingleAgentBaselineProfile: ReckonCompleteProfileDeclarationInput = {
  ...level17MultiAgentProfile,
  profileId: "profile-l17-single-agent-baseline",
  name: "Multi-agent operations (single-agent baseline)",
  description:
    "SIM-006 ladder level 17 mandatory single-agent baseline — the same task stream executed by ONE agent body (architecture law: every multi-agent case carries its baseline).",
};

/** Read-only view over the final org world state (deterministic assertions). */
export interface Level17WorldView {
  readonly presentations: number;
  readonly actionLog: readonly string[];
  readonly delegatedSteps: readonly number[];
  readonly delegationPaths: readonly string[];
  readonly escalationSteps: readonly number[];
  readonly resumeSteps: readonly number[];
  readonly soloFallbackSteps: readonly number[];
  readonly terminationStep: number;
  readonly terminationRule: string;
  readonly costLedgerUsd: readonly number[];
  readonly delegationsRemaining: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly taskWeights: Readonly<Record<string, number>>;
  readonly qualityScore: number;
  readonly orgBodies: number;
  readonly orgEdges: number;
}

/** A fresh Level 17 org host (fresh world state — replay-safe by construction). */
export interface Level17Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level17WorldView;
}

export function createLevel17MultiAgentHost(): Level17Host {
  const state = createLevel17WorldState();
  /** The experience the previous step's decision selected (the live work). */
  let liveExperience: ExperienceInput | undefined;
  /** Org budget ledger (host-owned): delegations spent + execution cost. */
  let delegationsSpent = 0;
  let costSpentUsd = 0;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l17-hiveops-org-1",
    hostSystem: {
      hostId: "host-l17-hiveops",
      name: "HiveOps Dispatch",
      version: "0.1.0",
    },
    // Glue honesty (wave-C battery recounts mechanically): loc = the
    // module's comment-stripped non-blank lines MINUS the solo-baseline
    // region (the baseline run carries its own count below); the custom
    // adapter LOC = the recount inside the glue:adapter markers.
    glue: { functions: 10, loc: 591, customAdapterLoc: 233 },
    manifestContent: LEVEL17_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL17_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL17_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const routed = orgRouteTask(state, step);
      const task = routed.task;
      if (routed.delegated) {
        state.delegatedSteps.push(step);
        delegationsSpent += 1;
      } else if (routed.toBody !== "l17-body-coordinator" || state.terminationStep > 0) {
        if (!state.soloFallbackSteps.includes(step)) state.soloFallbackSteps.push(step);
      }
      if (task.escalated) state.escalationSteps.push(step);
      if (task.resume) state.resumeSteps.push(step);
      // The executing body spends its scripted execution cost.
      const executingBody = routed.delegated ? routed.toBody : "l17-body-coordinator";
      costSpentUsd = Math.round((costSpentUsd + orgExecutionCostUsd(executingBody)) * 100) / 100;
      state.costLedgerUsd.push(costSpentUsd);
      state.delegationsRemaining.push(DELEGATION_BUDGET - delegationsSpent);
      if (step === ORG_TASKS.length) {
        // task-complete termination fires with the final delivery.
        if (state.terminationStep === 0) state.terminationStep = step;
        state.terminationRule = state.terminationRule === "" ? "task-complete" : state.terminationRule;
        state.qualityScore = 0.92;
      }
      return {
        contextId: `ctx-l17-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l17-deliver-report",
          version: "1",
          kind: "complete-task",
          params: { domain: "knowledge-ops", taskKind: task.kind },
        },
        attentionPolicy: {
          policyId: "ap-l17-org-balanced",
          version: "1",
          style: "balanced",
          params: { maxDelegationsPerTask: 2 },
        },
        candidates: {
          setId: `cs-l17-${step}`,
          candidates: [
            {
              itemId: task.itemId,
              realizationIds: [realizationIdFor(task.itemId)],
              source: task.source,
              rankHint: 1,
            },
          ],
        },
        constraints: orgConstraints(step),
        policySelector: { policyId: "hiveops-dispatch-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
        planId: "plan-l17-task-board",
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      state.presentations += 1;
      state.actionLog.push(result.action);
      liveExperience = result.selectedExperience;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const task = ORG_TASKS[step - 1]!;
      const terminated = state.terminationStep === step;
      let eventType: "start" | "conversion" | "interruption-accept" | "resume" | "custom" = "custom";
      let customEventType: string | undefined = "delegation-accept";
      if (step === ORG_TASKS.length) {
        eventType = "conversion";
        customEventType = undefined;
      } else if (state.escalationSteps.includes(step)) {
        eventType = "interruption-accept";
        customEventType = undefined;
      } else if (state.resumeSteps.includes(step)) {
        eventType = "resume";
        customEventType = undefined;
      } else if (step === 1) {
        eventType = "start";
        customEventType = undefined;
      } else if (terminated) {
        customEventType = "budget-termination";
      } else if (state.soloFallbackSteps.includes(step)) {
        customEventType = "solo-fallback";
      }
      state.outcomeTypes.push(eventType);
      return {
        eventId: `ev-l17-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          taskKindCode: TASK_KIND_CODE[task.kind],
          executingBodyCode: state.delegatedSteps.includes(step)
            ? BODY_CODE[bodyForTask(task.kind)]
            : BODY_CODE["l17-body-coordinator"],
          delegated: state.delegatedSteps.includes(step) ? 1 : 0,
          delegationsRemaining: DELEGATION_BUDGET - state.delegatedSteps.length,
          costUsdTotal: state.costLedgerUsd[step - 1] ?? 0,
          ...(terminated ? { budgetTerminated: 1 } : {}),
          ...(step === ORG_TASKS.length ? { qualityScore: state.qualityScore } : {}),
        },
        idempotencyKey: `idem-out-l17-${step}`,
      };
    },

    providePreferenceDelta(step: number, _result: DecisionResult, nowMs: number) {
      const task = ORG_TASKS[step - 1]!;
      const dimension = `task.${task.kind}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.taskWeights.get(task.kind) ?? 1) + 0.1;
      state.taskWeights.set(task.kind, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l17-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "hiveops-task-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: worldViewFor(state, AGENT_ORGANIZATION.bodies.length, AGENT_ORGANIZATION.edges.length),
  };
}

/** Hard constraints carried on every org decision request. */
function orgConstraints(step: number): HardConstraint[] {
  return [
    { kind: "time-window", untilMs: 1_000 * 60 * (step + 30) },
    { kind: "max-latency", latencyMs: 200 },
    { kind: "catalog-rule", ruleId: "l17-org-capability-gate" },
  ];
}

/** The shared read-only world view (org host + baseline host). */
function worldViewFor(state: Level17WorldState, orgBodies: number, orgEdges: number): Level17WorldView {
  return {
    get presentations() { return state.presentations; },
    get actionLog() { return [...state.actionLog]; },
    get delegatedSteps() { return [...state.delegatedSteps]; },
    get delegationPaths() { return [...state.delegationPaths]; },
    get escalationSteps() { return [...state.escalationSteps]; },
    get resumeSteps() { return [...state.resumeSteps]; },
    get soloFallbackSteps() { return [...state.soloFallbackSteps]; },
    get terminationStep() { return state.terminationStep; },
    get terminationRule() { return state.terminationRule; },
    get costLedgerUsd() { return [...state.costLedgerUsd]; },
    get delegationsRemaining() { return [...state.delegationsRemaining]; },
    get outcomeSteps() { return [...state.outcomeSteps]; },
    get outcomeTypes() { return [...state.outcomeTypes]; },
    get deltaDimensions() { return [...state.deltaDimensions]; },
    get taskWeights() { return Object.fromEntries([...state.taskWeights.entries()].sort()); },
    get qualityScore() { return state.qualityScore; },
    get orgBodies() { return orgBodies; },
    get orgEdges() { return orgEdges; },
  };
}

// --- glue:baseline:begin ---------------------------------------------------
// The MANDATORY single-agent baseline: the same task stream executed by
// ONE body (no delegation graph, flat per-task cost, scripted lower
// quality). Architecture law: every multi-agent case carries its
// single-agent baseline run.

/** The single baseline body — every capability in one envelope. */
const SOLO_BODY: AgentBody = AgentBodySchema.parse({
  bodyId: "l17-body-solo",
  version: "1",
  role: { roleId: "solo-operator", description: "Executes the whole task board without delegation." },
  observations: [
    { observationId: "l17-obs-solo-catalog", kind: "catalog" },
    { observationId: "l17-obs-solo-outcome", kind: "outcome" },
    { observationId: "l17-obs-solo-preference", kind: "preference" },
  ],
  tools: [
    { toolId: "l17-tool-solo-router", name: "task-router" },
    { toolId: "l17-tool-solo-editor", name: "draft-editor" },
    { toolId: "l17-tool-solo-qa", name: "qa-check" },
  ],
  permissions: [{ permissionId: "l17-perm-solo-read", capability: "read" }],
  memoryInterfaces: [{ memoryId: "l17-mem-solo-board", kind: "private", access: "read-write" }],
  actions: [
    { actionId: "l17-act-solo-select", kind: "select" },
    { actionId: "l17-act-solo-end", kind: "end" },
  ],
  budgets: [{ kind: "cost", limit: 6, currency: "USD" }],
  latencyLimits: { hardMs: 900 },
});

/** The baseline's flat per-task execution cost (unspecialized, fixture). */
const SOLO_COST_USD_PER_TASK = 0.6;

/** The baseline candidates: every task executed solo, no delegation. */
function soloTaskCandidates(step: number): OrgTask[] {
  const task = ORG_TASKS[step - 1]!;
  return [{ ...task, source: "agent-solo", escalated: false, resume: false }];
}

/** A fresh single-agent baseline host (fresh world — replay-safe). */
export interface Level17BaselineHost {
  readonly host: SimulationHostAdapter;
  readonly world: Level17WorldView;
}

export function createLevel17SingleAgentBaselineHost(): Level17BaselineHost {
  const state = createLevel17WorldState();
  let liveExperience: ExperienceInput | undefined;
  let costSpentUsd = 0;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l17-hiveops-solo-1",
    hostSystem: {
      hostId: "host-l17-hiveops",
      name: "HiveOps Dispatch (single-agent baseline)",
      version: "0.1.0",
    },
    // Glue honesty: the solo baseline counts ONLY the glue:baseline
    // region (its world + adapter); it reuses the module's shared
    // catalog/manifest/identity sources already counted for the org
    // host above — the baseline measures the MARGINAL single-agent
    // integration, never a second copy of the shared sources.
    glue: { functions: 6, loc: 165, customAdapterLoc: 165 },
    manifestContent: {
      ...LEVEL17_MANIFEST_CONTENT,
      hostSystem: {
        hostId: "host-l17-hiveops",
        name: "HiveOps Dispatch (single-agent baseline)",
        hostAdapterId: "adapter-l17-hiveops-solo-1",
        version: "0.1.0",
      },
    },
    catalog: {
      items: LEVEL17_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL17_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const task = soloTaskCandidates(step)[0]!;
      costSpentUsd = Math.round((costSpentUsd + SOLO_COST_USD_PER_TASK) * 100) / 100;
      state.costLedgerUsd.push(costSpentUsd);
      state.delegationsRemaining.push(DELEGATION_BUDGET);
      if (step === ORG_TASKS.length) {
        state.terminationStep = step;
        state.terminationRule = "task-complete";
        state.qualityScore = 0.74;
      }
      return {
        contextId: `ctx-l17-solo-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l17-deliver-report",
          version: "1",
          kind: "complete-task",
          params: { domain: "knowledge-ops", taskKind: task.kind, mode: "single-agent-baseline" },
        },
        attentionPolicy: {
          policyId: "ap-l17-solo-balanced",
          version: "1",
          style: "balanced",
          params: {},
        },
        candidates: {
          setId: `cs-l17-solo-${step}`,
          candidates: [
            {
              itemId: task.itemId,
              realizationIds: [realizationIdFor(task.itemId)],
              source: task.source,
              rankHint: 1,
            },
          ],
        },
        constraints: [
          { kind: "time-window", untilMs: 1_000 * 60 * (step + 30) },
          { kind: "max-latency", latencyMs: 900 },
          { kind: "catalog-rule", ruleId: "l17-org-capability-gate" },
        ],
        policySelector: { policyId: "hiveops-solo-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
        planId: "plan-l17-task-board",
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      state.presentations += 1;
      state.actionLog.push(result.action);
      liveExperience = result.selectedExperience;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const task = ORG_TASKS[step - 1]!;
      let eventType: "start" | "conversion" | "custom" = "custom";
      let customEventType: string | undefined = "solo-execution";
      if (step === ORG_TASKS.length) {
        eventType = "conversion";
        customEventType = undefined;
      } else if (step === 1) {
        eventType = "start";
        customEventType = undefined;
      }
      state.outcomeTypes.push(eventType);
      return {
        eventId: `ev-l17-solo-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          taskKindCode: TASK_KIND_CODE[task.kind],
          executingBodyCode: BODY_CODE[SOLO_BODY.bodyId],
          delegated: 0,
          delegationsRemaining: DELEGATION_BUDGET,
          costUsdTotal: state.costLedgerUsd[step - 1] ?? 0,
          ...(step === ORG_TASKS.length ? { qualityScore: state.qualityScore } : {}),
        },
        idempotencyKey: `idem-out-l17-solo-${step}`,
      };
    },

    providePreferenceDelta(step: number, _result: DecisionResult, nowMs: number) {
      const task = ORG_TASKS[step - 1]!;
      const dimension = `task.${task.kind}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.taskWeights.get(task.kind) ?? 1) + 0.1;
      state.taskWeights.set(task.kind, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l17-solo-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "hiveops-task-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return { host, world: worldViewFor(state, 1, 0) };
}
// --- glue:baseline:end -----------------------------------------------------

/**
 * The agent-delegation PROBE host: the same org host behavior, measured
 * against the stricter profile — its manifest additionally declares the
 * agent-delegation PARTIAL entry (COMPOSITION_GAP) so the probe run's
 * verdict is honestly incomplete and the record carries the finding.
 */
export function createLevel17AgentDelegationProbeHost(): Level17Host {
  const handle = createLevel17MultiAgentHost();
  return {
    host: { ...handle.host, manifestContent: LEVEL17_PROBE_MANIFEST_CONTENT },
    world: handle.world,
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level17MultiAgentMeta = {
  level: 17,
  name: "Multi-agent operations",
  hostAdapterId: "adapter-l17-hiveops-org-1",
  requiredCapabilities: 12,
  expectedSatisfied: 12,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;

export const level17SingleAgentBaselineMeta = {
  level: 17,
  name: "Multi-agent operations (single-agent baseline)",
  hostAdapterId: "adapter-l17-hiveops-solo-1",
  requiredCapabilities: 12,
  expectedSatisfied: 12,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;

export const level17AgentDelegationProbeMeta = {
  level: 17,
  name: "Multi-agent operations (agent-delegation probe)",
  hostAdapterId: "adapter-l17-hiveops-org-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["agent-delegation|COMPOSITION_GAP"] as readonly string[],
} as const;
