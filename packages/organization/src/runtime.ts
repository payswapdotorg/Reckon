/**
 * W2-008 — the Agent Organization runtime.
 *
 * A directed graph of Agent Bodies (the frozen `AgentOrganization`
 * contract) with communication/delegation edges, message passing over
 * the W2-007 body runtime (the ENVELOPE machinery enforces every
 * operation a body performs while processing a message), and
 * delegation records with traceable lineage.
 *
 * BASELINE COMPARISON LAW (architecture-lock #15): every topology
 * evaluation MUST be accompanied by a single-agent baseline run of the
 * SAME task. `compareTopologies(task, topologies)` returns per-topology
 * metrics PLUS the baseline row — the baseline is ALWAYS present (the
 * return type has no baseline-free shape). Organization complexity is
 * never presented as better without the baseline row to compare
 * against.
 *
 * Deterministic orchestration: an injected `Clock` is REQUIRED (never
 * a system clock — no wall-clock in decisions); delegation targets are
 * chosen with SEEDED tie-breaks (`digest(seed + ":" + bodyId)` then
 * bodyId — stable for a given seed, different seeds may order
 * differently); the message queue is FIFO; record ids are
 * digest-derived. Same inputs ⇒ digest-identical run results.
 *
 * Failure isolation (bounded timeouts): every body run is bounded by
 * the W2-007 runtime step limit (`maxStepsPerBody` — a dead/looping
 * body is cut off with a typed `STEP_LIMIT_EXCEEDED` abort and its
 * record marked failed; the organization CONTINUES with the rest of
 * the queue), and the whole run is bounded by the org's `deadline`
 * termination rule and org budgets when declared.
 *
 * Documented message protocol: a message from body S to body T runs as
 * a W2-007 `BodyTask` `{ taskId: messageId, input: { from, kind,
 * payload } }` on T's instance. A route S→T requires a declared edge
 * with the message's exact `kind` (communicate | delegate | report |
 * escalate | custom); undeclared routes are recorded as
 * `edge-not-declared` failures and skipped (the org continues).
 *
 * Documented output protocol: a completed run's output is interpreted
 * as a delegation directive IFF it is an object carrying a `delegate`
 * array or a `result` property (`BodyOutputDirective`); every entry
 * needs exactly one of `toBodyId` / `toRoleId` plus a declared-edge-
 * compatible `kind`. Role-targeted delegation selects among eligible
 * bodies (role match + compatible edge) using the seeded tie-break.
 * Non-directive outputs are leaf results. Malformed entries are
 * recorded (`malformed-directive`) and skipped.
 *
 * Termination rules (frozen contract) enforced by this kernel:
 * `max-depth` (delegations beyond the bound are recorded
 * `depth-exceeded`), `deadline` (clock-based; remaining messages are
 * recorded `deadline-exceeded`), org `budgets` (accumulated usage;
 * remaining messages are recorded `budget-exhausted`), and
 * `task-complete` (the queue drains — the natural completion).
 * `consensus` and `custom` rules are host-evaluated declarations —
 * documented as NOT enforced by this kernel (evaluator bodies arrive
 * with organization search, W2-009).
 */
import {
  AgentOrganizationSchema,
  contentDigest,
  type AgentBody,
  type AgentOrganization,
  type DelegationEdge,
  type Id,
  type ModelAssignment,
} from "@reckon/contracts";
import {
  createAgentBodyRuntime,
  createStepClock,
  type AgentBodyRuntime,
  type AgentInstanceHandle,
  type BodyExecutor,
  type BodyRunResult,
  type BodyTask,
  type Clock,
} from "../../agents/src/index.js";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";

// ---------------------------------------------------------------------------
// Limits, deps, ports
// ---------------------------------------------------------------------------

/** Runtime limits (failure isolation bounds). */
export interface OrganizationRuntimeLimits {
  /** Per-body step bound: a dead/looping body is cut off by the W2-007
   *  runtime step limit (bounded timeout — the org is never wedged). */
  maxStepsPerBody: number;
  /** Outer delegation-depth safety valve (also bounded by the org's
   *  `max-depth` termination rule when declared). */
  maxDepth: number;
}

export const DEFAULT_MAX_STEPS_PER_BODY = 500;
export const DEFAULT_MAX_DEPTH = 8;

export interface OrganizationRuntimeDeps {
  /** The shared body executor (W2-007 seam — one executor, N bodies). */
  executor: BodyExecutor;
  /** REQUIRED injected clock — the organization runtime never uses a
   *  system clock (no wall-clock in decisions). */
  clock: Clock;
  limits?: Partial<OrganizationRuntimeLimits>;
}

/** A task to run through an organization (same shape as a body task). */
export type OrgTask = BodyTask;

export interface RunOrganizationOptions {
  /** Entry body (default: the org's first declared body). */
  entryBodyId?: Id;
  /** Tie-break seed for role-targeted delegation (default ""). */
  seed?: string;
}

// ---------------------------------------------------------------------------
// Delegation records (traceable lineage)
// ---------------------------------------------------------------------------

export type DelegationStatus =
  | "completed" // the body run completed
  | "blocked" // envelope violation (W2-007 blocked)
  | "aborted" // budget/step-limit abort (W2-007 aborted — incl. dead bodies)
  | "yielded" // hard latency deadline (W2-007 yielded)
  | "failed" // the task itself was invalid (typed INVALID_INPUT run)
  | "edge-not-declared" // no declared edge for the route
  | "unknown-target-body" // directive named an undeclared body
  | "unknown-target-role" // no body carries the directive's role
  | "malformed-directive" // the output was not a valid directive entry
  | "depth-exceeded" // beyond the max-depth bound
  | "deadline-exceeded" // run deadline hit before dispatch
  | "budget-exhausted"; // org budget hit before dispatch

export type DelegationKind = "root" | DelegationEdge["kind"];

/** One node in the delegation lineage tree. `parentRecordId` links to
 *  the record whose output delegated; `rootRecordId` is the root task
 *  record; the chain from any record reaches the root. */
export interface DelegationRecord {
  recordId: string;
  parentRecordId: string | null;
  rootRecordId: string;
  fromBodyId: string | null;
  toBodyId: string;
  edgeId: string | null;
  kind: DelegationKind;
  depth: number;
  status: DelegationStatus;
  runId?: string;
  output?: unknown;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Run + comparison results
// ---------------------------------------------------------------------------

export interface OrganizationRunResult {
  organizationId: string;
  taskId: string;
  status: "completed" | "terminated-early";
  /** Why the run ended: task-complete (queue drained) | deadline |
   *  budget-exhausted. */
  termination: "task-complete" | "deadline" | "budget-exhausted";
  /** The full delegation lineage, in record-creation order. */
  records: DelegationRecord[];
  usage: { cost: number; tokens: number; calls: number; wallClockMs: number };
  /** Number of messages whose body actually ran. */
  messagesProcessed: number;
  /** The root record's result value (present when the root completed
   *  with a directive `result` or a leaf output — documented). */
  output?: unknown;
  startedAt: number;
  endedAt: number;
}

export interface TopologyRunMetrics {
  organizationId: string;
  status: "completed" | "terminated-early";
  termination: string;
  /** Distinct bodies that actually ran. */
  bodiesUsed: number;
  /** Messages processed (body runs). */
  messages: number;
  /** Executed delegation messages (depth > 0 and the body ran). */
  delegations: number;
  /** Records whose status is not "completed". */
  failedRecords: number;
  usage: { cost: number; tokens: number; calls: number; wallClockMs: number };
  /** Digest of the root output when present (comparable across rows). */
  outputDigest?: string;
}

export interface TopologyComparison {
  /** BASELINE COMPARISON LAW (lock #15): the single-agent baseline row
   *  of the SAME task — ALWAYS present, never omitted. */
  baseline: TopologyRunMetrics & { organizationId: "baseline-single-agent" };
  /** Per-topology metrics, in input order. */
  topologies: TopologyRunMetrics[];
}

export interface CompareTopologiesOptions {
  /** The single generalist baseline body + its model assignment.
   *  Default: the FIRST topology's entry (first) body + its assignment
   *  (documented default generalist proxy). */
  baseline?: { body: AgentBody; assignment: ModelAssignment };
  /** Seeded tie-break seed (same for the baseline and every topology). */
  seed?: string;
  /** Fresh identical step clocks are created per row with these
   *  parameters (comparable, deterministic metrics). */
  startAt?: number;
  stepMs?: number;
}

export interface OrganizationRuntime {
  runOrganization(
    org: AgentOrganization,
    task: OrgTask,
    options?: RunOrganizationOptions,
  ): Result<OrganizationRunResult>;
  /**
   * Compare topologies against the single-agent baseline of the SAME
   * task (BASELINE COMPARISON LAW, lock #15). The baseline row is
   * ALWAYS present. Each row runs through this runtime's executor
   * with a fresh identical step clock (comparable, deterministic).
   */
  compareTopologies(
    task: OrgTask,
    topologies: AgentOrganization[],
    options?: CompareTopologiesOptions,
  ): Result<TopologyComparison>;
}

// ---------------------------------------------------------------------------
// Directive protocol (documented)
// ---------------------------------------------------------------------------

/** A body's final output MAY be this shape (documented protocol: an
 *  object with a `delegate` array or a `result` property is a
 *  directive; anything else is a leaf result). */
export interface BodyOutputDirective {
  /** The body's own result value. */
  result?: unknown;
  /** Follow-up delegations along declared edges. */
  delegate?: DelegationDirective[];
}

export interface DelegationDirective {
  /** Direct target body (exactly one of toBodyId/toRoleId). */
  toBodyId?: string;
  /** Role target: seeded tie-break among eligible bodies. */
  toRoleId?: string;
  kind: DelegationEdge["kind"];
  payload?: unknown;
}

const EDGE_KINDS: ReadonlySet<string> = new Set([
  "communicate",
  "delegate",
  "report",
  "escalate",
  "custom",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordIdFor(parts: {
  taskId: string;
  parentRecordId: string | null;
  toBodyId: string;
  kind: string;
  depth: number;
  sequence: number;
}): string {
  return `rec-${contentDigest(parts).slice(0, 16)}`;
}

/** Seeded tie-break key: digest of seed + bodyId (then bodyId as the
 *  final stable comparison — total order, deterministic per seed). */
function seededOrderKey(seed: string, bodyId: string): string {
  return contentDigest(`${seed}:${bodyId}`);
}

/** Is `output` a delegation directive? (documented protocol: an object
 *  with a `delegate` array or a `result` property) */
function isDirectiveOutput(output: unknown): boolean {
  if (!isObject(output)) return false;
  return Array.isArray(output["delegate"]) || "result" in output;
}

// ---------------------------------------------------------------------------
// Runtime construction
// ---------------------------------------------------------------------------

/** Factory. The clock is REQUIRED (injected — never a system clock). */
export function createOrganizationRuntime(deps: OrganizationRuntimeDeps): Result<OrganizationRuntime> {
  if (deps === null || typeof deps !== "object") {
    return invalidInput("createOrganizationRuntime: deps must be an object");
  }
  if (typeof deps.executor?.executorId !== "string" || typeof deps.executor.step !== "function") {
    return invalidInput("createOrganizationRuntime: deps.executor must be a BodyExecutor");
  }
  if (deps.clock === null || typeof deps.clock?.now !== "function") {
    return invalidInput("createOrganizationRuntime: deps.clock must be an injected Clock (no system clock — no wall-clock in decisions)");
  }
  const maxStepsPerBody =
    deps.limits?.maxStepsPerBody ?? DEFAULT_MAX_STEPS_PER_BODY;
  const outerMaxDepth = deps.limits?.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (maxStepsPerBody < 1 || !Number.isInteger(maxStepsPerBody)) {
    return invalidInput("createOrganizationRuntime: limits.maxStepsPerBody must be a positive integer");
  }
  if (outerMaxDepth < 0 || !Number.isInteger(outerMaxDepth)) {
    return invalidInput("createOrganizationRuntime: limits.maxDepth must be a non-negative integer");
  }
  const clock = deps.clock;

  return {
    ok: true,
    value: {
      runOrganization(org, task, options) {
        return runOrganization(org, task, options ?? {}, {
          executor: deps.executor,
          clock,
          maxStepsPerBody,
          outerMaxDepth,
        });
      },
      compareTopologies(task, topologies, options) {
        return compareTopologies(
          { executor: deps.executor, maxStepsPerBody, outerMaxDepth },
          task,
          topologies,
          options ?? {},
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The orchestration kernel
// ---------------------------------------------------------------------------

interface PendingMessage {
  sequence: number;
  messageId: string;
  parentRecordId: string | null;
  fromBodyId: string | null;
  toBodyId: string;
  edgeId: string | null;
  kind: DelegationKind;
  depth: number;
  payload?: unknown;
}

function runOrganization(
  orgInput: AgentOrganization,
  task: OrgTask,
  options: RunOrganizationOptions,
  ctx: {
    executor: BodyExecutor;
    clock: Clock;
    maxStepsPerBody: number;
    outerMaxDepth: number;
  },
): Result<OrganizationRunResult> {
  // --- Validation (typed issues, never raw throws). ---
  if (!isObject(orgInput)) {
    return invalidInput("runOrganization: org must be an object");
  }
  const parsedOrg = AgentOrganizationSchema.safeParse(orgInput);
  if (!parsedOrg.success) {
    return invalidInput(
      "runOrganization: invalid agent organization",
      parsedOrg.error.issues.map((i) => ({ path: `org.${i.path.join(".")}`, message: i.message })),
    );
  }
  if (task === null || typeof task !== "object" || typeof task.taskId !== "string" || task.taskId.length < 1) {
    return invalidInput("runOrganization: task must be { taskId: string, input? }");
  }
  const org = parsedOrg.data;

  const bodyIds = new Set<string>();
  for (const body of org.bodies) {
    if (bodyIds.has(body.bodyId)) {
      return invalidInput(`runOrganization: duplicate body ${body.bodyId}`);
    }
    bodyIds.add(body.bodyId);
  }
  for (const edge of org.edges) {
    if (!bodyIds.has(edge.fromBodyId) || !bodyIds.has(edge.toBodyId)) {
      return invalidInput(
        `runOrganization: edge ${edge.edgeId} references undeclared bodies (${edge.fromBodyId} → ${edge.toBodyId})`,
      );
    }
  }
  const assignmentByBody = new Map<string, ModelAssignment>();
  for (const assignment of org.modelAssignments) {
    if (!bodyIds.has(assignment.bodyId)) {
      return invalidInput(
        `runOrganization: model assignment targets undeclared body ${assignment.bodyId}`,
      );
    }
    if (assignmentByBody.has(assignment.bodyId)) {
      return invalidInput(`runOrganization: duplicate model assignment for body ${assignment.bodyId}`);
    }
    assignmentByBody.set(assignment.bodyId, assignment);
  }
  const missingAssignments = org.bodies
    .filter((body) => !assignmentByBody.has(body.bodyId))
    .map((body) => body.bodyId);
  if (missingAssignments.length > 0) {
    return invalidInput(
      `runOrganization: bodies without model assignments (model assignment is data — every body needs one): ${missingAssignments.join(", ")}`,
    );
  }

  const seed = options.seed ?? "";
  const entryBodyId = options.entryBodyId ?? org.bodies[0].bodyId;
  if (!bodyIds.has(entryBodyId)) {
    return invalidInput(`runOrganization: entry body ${entryBodyId} is not declared`);
  }

  // --- Termination configuration (documented). ---
  const maxDepthRule = org.terminationRules.find((rule) => rule.kind === "max-depth");
  const effectiveMaxDepth = Math.min(
    maxDepthRule && maxDepthRule.kind === "max-depth" ? maxDepthRule.maxDepth : Number.POSITIVE_INFINITY,
    ctx.outerMaxDepth,
  );
  const deadlineRule = org.terminationRules.find((rule) => rule.kind === "deadline");
  const deadlineMs = deadlineRule && deadlineRule.kind === "deadline" ? deadlineRule.deadlineMs : undefined;

  // --- Instantiate every body via the W2-007 runtime (envelope
  //     machinery: permissions, budgets, latency limits per body). ---
  const bodyRuntime: AgentBodyRuntime = createAgentBodyRuntime({
    executor: ctx.executor,
    clock: ctx.clock,
    maxSteps: ctx.maxStepsPerBody,
  });
  const handles = new Map<string, AgentInstanceHandle>();
  for (const body of org.bodies) {
    const instantiation = bodyRuntime.instantiate(body, assignmentByBody.get(body.bodyId) as ModelAssignment);
    if (!instantiation.ok) {
      // Map the W2-007 typed error into this kernel's typed error
      // (message passthrough; the original code is preserved).
      return invalidInput(
        `runOrganization: body ${body.bodyId} failed to instantiate: ${instantiation.error.message}`,
        [{ path: `bodies.${body.bodyId}`, message: instantiation.error.code }],
      );
    }
    handles.set(body.bodyId, instantiation.value);
  }
  const rolesByBody = new Map<string, string>();
  for (const body of org.bodies) {
    rolesByBody.set(body.bodyId, body.role.roleId);
  }
  const edgesByPair = new Map<string, DelegationEdge[]>();
  for (const edge of org.edges) {
    const key = `${edge.fromBodyId}→${edge.toBodyId}`;
    const list = edgesByPair.get(key) ?? [];
    list.push(edge);
    edgesByPair.set(key, list);
  }

  /** The FIRST declared edge matching (from, to, kind) — deterministic. */
  function findEdge(from: string, to: string, kind: string): DelegationEdge | undefined {
    const list = edgesByPair.get(`${from}→${to}`) ?? [];
    return list.find((edge) => edge.kind === kind);
  }

  // --- Orchestration state. ---
  const records: DelegationRecord[] = [];
  const usage = { cost: 0, tokens: 0, calls: 0, custom: {} as Record<string, number> };
  let messagesProcessed = 0;
  let sequence = 0;
  const startedAt = ctx.clock.now();

  const queue: PendingMessage[] = [
    {
      sequence: sequence++,
      messageId: "msg-0",
      parentRecordId: null,
      fromBodyId: null,
      toBodyId: entryBodyId,
      edgeId: null,
      kind: "root",
      depth: 0,
      payload: task.input,
    },
  ];
  const rootRecordId = recordIdFor({
    taskId: task.taskId,
    parentRecordId: null,
    toBodyId: entryBodyId,
    kind: "root",
    depth: 0,
    sequence: 0,
  });
  let rootOutput: unknown;
  let rootRecordCreated = false;

  function makeRecord(
    message: PendingMessage,
    status: DelegationStatus,
    extra?: { runId?: string; output?: unknown; error?: { code: string; message: string } },
  ): DelegationRecord {
    const record: DelegationRecord = {
      recordId: recordIdFor({
        taskId: task.taskId,
        parentRecordId: message.parentRecordId,
        toBodyId: message.toBodyId,
        kind: message.kind,
        depth: message.depth,
        sequence: message.sequence,
      }),
      parentRecordId: message.parentRecordId,
      rootRecordId,
      fromBodyId: message.fromBodyId,
      toBodyId: message.toBodyId,
      edgeId: message.edgeId,
      kind: message.kind,
      depth: message.depth,
      status,
      ...(extra?.runId !== undefined ? { runId: extra.runId } : {}),
      ...(extra?.output !== undefined || (extra?.runId !== undefined && extra?.output === undefined)
        ? { output: extra?.output }
        : {}),
      ...(extra?.error !== undefined ? { error: extra.error } : {}),
    };
    records.push(record);
    return record;
  }

  function absorbUsage(run: BodyRunResult) {
    usage.cost += run.usage.cost;
    usage.tokens += run.usage.tokens;
    usage.calls += run.usage.calls;
    for (const [kind, value] of Object.entries(run.usage.custom)) {
      usage.custom[kind] = (usage.custom[kind] ?? 0) + value;
    }
  }

  /** Enqueue (or fail-record) one delegation directive from a record. */
  function processDirective(
    directive: unknown,
    parent: DelegationRecord,
    index: number,
  ): void {
    if (!isObject(directive)) {
      makeRecord(
        {
          sequence: sequence++,
          messageId: `msg-${sequence}`,
          parentRecordId: parent.recordId,
          fromBodyId: parent.toBodyId,
          toBodyId: "unknown",
          edgeId: null,
          kind: "custom",
          depth: parent.depth + 1,
        },
        "malformed-directive",
        { error: { code: "MALFORMED_DIRECTIVE", message: `delegate[${index}] is not an object` } },
      );
      return;
    }
    const d = directive as Record<string, unknown>;
    const kind = d["kind"];
    if (typeof kind !== "string" || !EDGE_KINDS.has(kind)) {
      makeRecord(
        {
          sequence: sequence++,
          messageId: `msg-${sequence}`,
          parentRecordId: parent.recordId,
          fromBodyId: parent.toBodyId,
          toBodyId: "unknown",
          edgeId: null,
          kind: "custom",
          depth: parent.depth + 1,
        },
        "malformed-directive",
        { error: { code: "MALFORMED_DIRECTIVE", message: `delegate[${index}].kind must be one of ${Array.from(EDGE_KINDS).join(", ")}` } },
      );
      return;
    }
    const hasBody = typeof d["toBodyId"] === "string" && (d["toBodyId"] as string).length > 0;
    const hasRole = typeof d["toRoleId"] === "string" && (d["toRoleId"] as string).length > 0;
    if (hasBody === hasRole) {
      makeRecord(
        {
          sequence: sequence++,
          messageId: `msg-${sequence}`,
          parentRecordId: parent.recordId,
          fromBodyId: parent.toBodyId,
          toBodyId: "unknown",
          edgeId: null,
          kind: kind as DelegationKind,
          depth: parent.depth + 1,
        },
        "malformed-directive",
        {
          error: {
            code: "MALFORMED_DIRECTIVE",
            message: `delegate[${index}] must set exactly one of toBodyId / toRoleId`,
          },
        },
      );
      return;
    }

    const from = parent.toBodyId as string;

    if (hasBody) {
      const target = d["toBodyId"] as string;
      if (!bodyIds.has(target)) {
        makeRecord(
          {
            sequence: sequence++,
            messageId: `msg-${sequence}`,
            parentRecordId: parent.recordId,
            fromBodyId: from,
            toBodyId: target,
            edgeId: null,
            kind: kind as DelegationKind,
            depth: parent.depth + 1,
          },
          "unknown-target-body",
          { error: { code: "UNKNOWN_TARGET_BODY", message: `delegate[${index}] targets undeclared body ${target}` } },
        );
        return;
      }
      const edge = findEdge(from, target, kind);
      if (edge === undefined) {
        makeRecord(
          {
            sequence: sequence++,
            messageId: `msg-${sequence}`,
            parentRecordId: parent.recordId,
            fromBodyId: from,
            toBodyId: target,
            edgeId: null,
            kind: kind as DelegationKind,
            depth: parent.depth + 1,
          },
          "edge-not-declared",
          { error: { code: "EDGE_NOT_DECLARED", message: `no ${kind} edge ${from} → ${target}` } },
        );
        return;
      }
      enqueueDelegation(from, target, edge, kind as DelegationKind, parent, d["payload"]);
      return;
    }

    // Role-targeted: eligible bodies (role match + compatible edge),
    // SEEDED tie-break (documented), first candidate wins.
    const roleId = d["toRoleId"] as string;
    const eligible = org.bodies
      .filter((body) => body.role.roleId === roleId && findEdge(from, body.bodyId, kind) !== undefined)
      .sort((a, b) => {
        const keyA = seededOrderKey(seed, a.bodyId);
        const keyB = seededOrderKey(seed, b.bodyId);
        if (keyA !== keyB) return keyA < keyB ? -1 : 1;
        return a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : 0;
      });
    if (eligible.length === 0) {
      const anyRole = org.bodies.some((body) => body.role.roleId === roleId);
      makeRecord(
        {
          sequence: sequence++,
          messageId: `msg-${sequence}`,
          parentRecordId: parent.recordId,
          fromBodyId: from,
          toBodyId: `role:${roleId}`,
          edgeId: null,
          kind: kind as DelegationKind,
          depth: parent.depth + 1,
        },
        anyRole ? "edge-not-declared" : "unknown-target-role",
        {
          error: {
            code: anyRole ? "EDGE_NOT_DECLARED" : "UNKNOWN_TARGET_ROLE",
            message: anyRole
              ? `no ${kind} edge from ${from} to any body with role ${roleId}`
              : `no body carries role ${roleId}`,
          },
        },
      );
      return;
    }
    const target = eligible[0];
    const edge = findEdge(from, target.bodyId, kind) as DelegationEdge;
    enqueueDelegation(from, target.bodyId, edge, kind as DelegationKind, parent, d["payload"]);
  }

  function enqueueDelegation(
    from: string,
    to: string,
    edge: DelegationEdge,
    kind: DelegationKind,
    parent: DelegationRecord,
    payload: unknown,
  ): void {
    const depth = parent.depth + 1;
    if (depth > effectiveMaxDepth) {
      makeRecord(
        {
          sequence: sequence++,
          messageId: `msg-${sequence}`,
          parentRecordId: parent.recordId,
          fromBodyId: from,
          toBodyId: to,
          edgeId: edge.edgeId,
          kind,
          depth,
        },
        "depth-exceeded",
        { error: { code: "DEPTH_EXCEEDED", message: `delegation depth ${depth} exceeds the bound ${effectiveMaxDepth}` } },
      );
      return;
    }
    queue.push({
      sequence: sequence++,
      messageId: `msg-${sequence}`,
      parentRecordId: parent.recordId,
      fromBodyId: from,
      toBodyId: to,
      edgeId: edge.edgeId,
      kind,
      depth,
      payload,
    });
  }

  // --- The orchestration loop (FIFO, documented termination checks). ---
  let termination: OrganizationRunResult["termination"] = "task-complete";
  let status: OrganizationRunResult["status"] = "completed";

  while (queue.length > 0) {
    const message = queue.shift() as PendingMessage;
    const now = ctx.clock.now();
    const elapsed = now - startedAt;

    // Deadline rule (clock-based; injected clock only).
    if (deadlineMs !== undefined && elapsed > deadlineMs) {
      makeRecord(message, "deadline-exceeded", {
        error: { code: "DEADLINE_EXCEEDED", message: `org deadline ${deadlineMs}ms exceeded at ${elapsed}ms` },
      });
      termination = "deadline";
      status = "terminated-early";
      continue; // drain the queue with deadline records (fail-closed)
    }

    // Org budgets (accumulated usage across body runs).
    const budgetFailure = orgBudgetFailure(org, usage, elapsed);
    if (budgetFailure !== null) {
      makeRecord(message, "budget-exhausted", { error: budgetFailure });
      termination = "budget-exhausted";
      status = "terminated-early";
      continue; // drain the queue with budget records (fail-closed)
    }

    // Dispatch: the message runs as a W2-007 task (ENVELOPE machinery).
    const handle = handles.get(message.toBodyId) as AgentInstanceHandle;
    const bodyTask: BodyTask = {
      taskId: message.messageId,
      input: {
        from: message.fromBodyId,
        kind: message.kind,
        payload: message.payload,
      },
    };
    const run = handle.run(bodyTask);

    if (!run.ok) {
      // The task itself was invalid (e.g. non-serializable payload).
      makeRecord(message, "failed", { error: { code: run.error.code, message: run.error.message } });
      continue;
    }
    const result = run.value;
    absorbUsage(result);
    messagesProcessed += 1;

    const statusMap: Record<BodyRunResult["status"], DelegationStatus> = {
      completed: "completed",
      blocked: "blocked",
      aborted: "aborted",
      yielded: "yielded",
    };
    const recordStatus = statusMap[result.status];
    const completed = result.status === "completed";
    const rawOutput = completed ? result.output : undefined;
    const directive = isDirectiveOutput(rawOutput) ? (rawOutput as BodyOutputDirective) : undefined;
    const recordOutput = directive !== undefined ? directive.result : rawOutput;
    const record = makeRecord(message, recordStatus, {
      runId: result.runId,
      ...(recordOutput !== undefined ? { output: recordOutput } : {}),
      ...(result.status !== "completed"
        ? {
            error: {
              code: result.error.code,
              message: result.error.message,
            },
          }
        : {}),
    });
    if (message.kind === "root" && !rootRecordCreated) {
      rootRecordCreated = true;
      if (recordOutput !== undefined) {
        rootOutput = recordOutput;
      } else if (result.status === "completed") {
        rootOutput = result.output;
      }
    }

    // Directive processing (completed runs only — a blocked/aborted/
    // yielded body does not delegate onward; documented).
    if (directive !== undefined && Array.isArray(directive.delegate)) {
      directive.delegate.forEach((entry, index) => processDirective(entry, record, index));
    }
  }

  const endedAt = ctx.clock.now();
  return {
    ok: true,
    value: {
      organizationId: org.organizationId,
      taskId: task.taskId,
      status,
      termination,
      records,
      usage: {
        cost: usage.cost,
        tokens: usage.tokens,
        calls: usage.calls,
        wallClockMs: endedAt - startedAt,
      },
      messagesProcessed,
      ...(rootOutput !== undefined ? { output: rootOutput } : {}),
      startedAt,
      endedAt,
    },
  };
}

/** Org budget enforcement: exceeds ⇒ terminate (documented: landing
 *  exactly on a limit is allowed; exceeding stops dispatching). */
function orgBudgetFailure(
  org: AgentOrganization,
  usage: { cost: number; tokens: number; calls: number; custom: Record<string, number> },
  elapsed: number,
): { code: string; message: string } | null {
  for (const budget of org.budgets) {
    switch (budget.kind) {
      case "cost":
        if (usage.cost > budget.limit) {
          return { code: "BUDGET_EXHAUSTED", message: `org cost budget ${budget.limit} exceeded (accumulated ${usage.cost})` };
        }
        break;
      case "tokens":
        if (usage.tokens > budget.limit) {
          return { code: "BUDGET_EXHAUSTED", message: `org tokens budget ${budget.limit} exceeded (accumulated ${usage.tokens})` };
        }
        break;
      case "calls":
        if (usage.calls > budget.limit) {
          return { code: "BUDGET_EXHAUSTED", message: `org calls budget ${budget.limit} exceeded (accumulated ${usage.calls})` };
        }
        break;
      case "wall-clock-ms":
        if (elapsed > budget.limit) {
          return { code: "BUDGET_EXHAUSTED", message: `org wall-clock budget ${budget.limit}ms exceeded (elapsed ${elapsed}ms)` };
        }
        break;
      case "custom":
        if (budget.customKind !== undefined) {
          const accumulated = usage.custom[budget.customKind] ?? 0;
          if (accumulated > budget.limit) {
            return { code: "BUDGET_EXHAUSTED", message: `org custom budget ${budget.customKind} ${budget.limit} exceeded (accumulated ${accumulated})` };
          }
        }
        break;
    }
  }
  return null;
}


// ---------------------------------------------------------------------------
// Metrics + baseline comparison (BASELINE COMPARISON LAW, lock #15)
// ---------------------------------------------------------------------------

/** Metrics derived from one organization run (documented fields:
 *  bodiesUsed/messages count EXECUTED work; delegations counts
 *  EXECUTED non-root messages (routing failures are counted in
 *  failedRecords, not as delegations); failedRecords counts every
 *  non-completed record). */
export function metricsOf(run: OrganizationRunResult): TopologyRunMetrics {
  const executed = run.records.filter((record) => record.runId !== undefined);
  const bodiesUsed = new Set(executed.map((record) => record.toBodyId)).size;
  const delegations = executed.filter((record) => record.depth > 0).length;
  const failed = run.records.filter((record) => record.status !== "completed").length;
  return {
    organizationId: run.organizationId,
    status: run.status,
    termination: run.termination,
    bodiesUsed,
    messages: run.messagesProcessed,
    delegations,
    failedRecords: failed,
    usage: { ...run.usage },
    ...(run.output !== undefined ? { outputDigest: contentDigest(run.output) } : {}),
  };
}

/** Build the single-agent baseline organization (one body, no edges,
 *  task-complete termination). */
function baselineOrganization(body: AgentBody, assignment: ModelAssignment): AgentOrganization {
  return AgentOrganizationSchema.parse({
    organizationId: "baseline-single-agent",
    version: "1",
    bodies: [body],
    edges: [],
    modelAssignments: [assignment],
    terminationRules: [{ kind: "task-complete" }],
  });
}

/**
 * The compareTopologies kernel: every topology row PLUS the mandatory
 * single-agent baseline row of the SAME task (lock #15). The baseline
 * row is ALWAYS present — organization complexity is never presented
 * without it.
 *
 * Each row (baseline included) runs the same task through the SAME
 * executor with a FRESH identical step clock (`startAt`/`stepMs`) and
 * the same seed, so metrics are comparable and deterministic.
 */
function compareTopologies(
  ctx: { executor: BodyExecutor; maxStepsPerBody: number; outerMaxDepth: number },
  task: OrgTask,
  topologies: AgentOrganization[],
  options: CompareTopologiesOptions,
): Result<TopologyComparison> {
  if (!Array.isArray(topologies)) {
    return invalidInput("compareTopologies: topologies must be an array");
  }

  const startAt = options.startAt ?? 0;
  const stepMs = options.stepMs ?? 10;
  const seed = options.seed ?? "";

  // Baseline body: the explicit generalist, or the first topology's
  // first body + its assignment (documented default generalist proxy).
  let baselineBody: AgentBody | undefined = options.baseline?.body;
  let baselineAssignment: ModelAssignment | undefined = options.baseline?.assignment;
  if (baselineBody === undefined || baselineAssignment === undefined) {
    if (topologies.length === 0) {
      return invalidInput(
        "compareTopologies: no baseline body available — pass options.baseline or at least one topology (the baseline row is mandatory)",
      );
    }
    const firstOrg = AgentOrganizationSchema.safeParse(topologies[0]);
    if (!firstOrg.success) {
      return invalidInput(
        "compareTopologies: invalid first topology",
        firstOrg.error.issues.map((i) => ({
          path: `topologies[0].${i.path.join(".")}`,
          message: i.message,
        })),
      );
    }
    const entry = firstOrg.data.bodies[0];
    const entryAssignment = firstOrg.data.modelAssignments.find(
      (assignment) => assignment.bodyId === entry.bodyId,
    );
    if (entryAssignment === undefined) {
      return invalidInput(
        "compareTopologies: the first topology's entry body has no model assignment — pass options.baseline",
      );
    }
    baselineBody = entry;
    baselineAssignment = entryAssignment;
  }

  // Baseline run: fresh identical step clock, same executor, same seed.
  const baselineRun = runOrganization(
    baselineOrganization(baselineBody, baselineAssignment),
    task,
    { seed },
    { executor: ctx.executor, clock: createStepClock(startAt, stepMs), maxStepsPerBody: ctx.maxStepsPerBody, outerMaxDepth: ctx.outerMaxDepth },
  );
  if (!baselineRun.ok) return baselineRun;
  const baseline = {
    ...metricsOf(baselineRun.value),
    organizationId: "baseline-single-agent" as const,
  };

  // Topology rows in input order (each with a fresh identical clock).
  const rows: TopologyRunMetrics[] = [];
  for (let index = 0; index < topologies.length; index++) {
    const run = runOrganization(
      topologies[index],
      task,
      { seed },
      { executor: ctx.executor, clock: createStepClock(startAt, stepMs), maxStepsPerBody: ctx.maxStepsPerBody, outerMaxDepth: ctx.outerMaxDepth },
    );
    if (!run.ok) {
      return invalidInput(
        `compareTopologies: topology at index ${index} failed to run: ${run.error.message}`,
        run.error.issues?.map((i) => ({ path: `topologies[${index}].${i.path}`, message: i.message })),
      );
    }
    rows.push(metricsOf(run.value));
  }

  return { ok: true, value: { baseline, topologies: rows } };
}
