/**
 * W2-006 — the Personal Agent runtime.
 *
 * ONE LOGICAL USER AGENT (architecture-lock #7): a
 * `PersonalAgentRuntime` manages N `AgentBody` instances (via the
 * W2-007 body runtime — one runtime, N `instantiate` calls) that share
 * a logical identity (`agentId`). Each instance remains a full
 * capability envelope: budgets, latency limits, permissions and the
 * envelope law are enforced by W2-007 on every run (passthrough —
 * proven by tests).
 *
 * CROSS-DEVICE LEARNING IS OPT-IN (architecture-lock #8, ADR-003):
 * DEFAULT DENY. Device bodies never observe each other's state
 * implicitly. Cross-device visibility of DERIVED learning deltas
 * requires an EXPLICIT `CrossDeviceLearningGrant` (caller-supplied,
 * agent-scoped, capability-explicit, body-scoped, revocable). Raw
 * telemetry is NEVER a sync primitive: the sync surface only carries
 * `PreferenceDelta` records (derived learning state, the frozen
 * contract).
 *
 * GRANT SEMANTICS (documented, fail-closed):
 * - A grant authorizes cross-device sharing only when it is ACTIVE:
 *   `revokedAt === undefined` AND `capabilities.derivedLearningDeltas
 *   === true`. A grant with any `revokedAt` is inactive — revocation
 *   stops all FUTURE use (ADR-003); the runtime has no clock, so
 *   "defined ⇒ inactive" is the deterministic rule.
 * - `bodyScope` is the sharing POOL: a body sees other bodies' deltas
 *   only when BOTH the pulling body and the originating body are in
 *   the pool (`"*"` = every body). A body outside every pool sees only
 *   its own device-local deltas.
 * - Grant timestamps are caller-supplied and never invented.
 *
 * STATE SYNC SURFACE: `PersonalAgentStateSync` is a DECLARED PORT. The
 * in-memory adapter here is TEST INFRASTRUCTURE (labeled as such —
 * fixture evidence class); production sync adapters are a later wave.
 * The adapter is pure storage: consent/visibility filtering is THIS
 * runtime's job (the consent authority never lives in storage).
 *
 * CONSENT/PRIVACY SURFACE (ADR-003): location/attention signals enter
 * the personal agent ONLY as permitted FLAGS (`PermittedContextSignals`)
 * — never raw values. `permittedSignalsFrom` converts a frozen
 * `ContextSnapshot` into flags by construction: the frozen contract
 * carries a location permission flag (`location.permitted`), and NO
 * attention authorization scope at all — raw attention values in a
 * snapshot therefore NEVER translate into attention permission (the
 * host must declare the flag explicitly). There is no API path that
 * hands a body raw location or attention values.
 *
 * Determinism: no wall-clock, no randomness, no async; state changes
 * only through the typed operations below. The same operation sequence
 * yields digest-identical state (tested).
 */
import {
  AgentBodySchema,
  IdSchema,
  ModelAssignmentSchema,
  PreferenceDeltaSchema,
  type AgentBody,
  type Id,
  type ModelAssignment,
  type PreferenceDelta,
  type TimestampMs,
  type ContextSnapshot,
} from "@reckon/contracts";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";
import type {
  AgentBodyRuntime,
  AgentInstanceHandle,
} from "./runtime.js";
import type { BodyRunResult, BodyTask } from "./contracts.js";

// ---------------------------------------------------------------------------
// Consent surface (ADR-003 — flags only, never raw values)
// ---------------------------------------------------------------------------

/**
 * Permitted context signals — permission FLAGS ONLY. By construction
 * there is no field here that could carry a raw location or attention
 * value (ADR-003: raw sensors are not a core requirement; the body
 * learns WHETHER a signal is permitted, never the signal itself).
 */
export interface PermittedContextSignals {
  locationPermitted: boolean;
  attentionObservationPermitted: boolean;
}

/**
 * Convert a frozen `ContextSnapshot` into permitted-signal FLAGS,
 * dropping every raw value by construction.
 *
 * - `locationPermitted`: the frozen contract's location object exists
 *   only with `permitted: true`, so presence ⇒ permitted; absent ⇒
 *   false.
 * - `attentionObservationPermitted`: ALWAYS false when derived from a
 *   snapshot — the frozen `ContextSnapshot` carries NO attention
 *   authorization scope, and the PRESENCE of raw attention values is
 *   never permission (ADR-003). The host must declare the flag
 *   explicitly.
 */
export function permittedSignalsFrom(snapshot: ContextSnapshot): PermittedContextSignals {
  return {
    locationPermitted: snapshot.location?.permitted === true,
    attentionObservationPermitted: false,
  };
}

// ---------------------------------------------------------------------------
// Cross-device learning grants (explicit, default deny)
// ---------------------------------------------------------------------------

/** An EXPLICIT cross-device learning grant (ADR-003, lock #8).
 *  Caller-supplied; timestamps never invented. */
export interface CrossDeviceLearningGrant {
  grantId: Id;
  /** The logical agent this grant belongs to (must match the runtime). */
  agentId: Id;
  /** What may cross devices. Only derived learning deltas are a sync
   *  primitive in this wave. */
  capabilities: { derivedLearningDeltas: boolean };
  /** The sharing POOL: bodies in the pool see each other's derived
   *  deltas. `"*"` = every body of this agent. */
  bodyScope: Id[] | "*";
  /** Caller-supplied grant timestamp. */
  grantedAt: TimestampMs;
  /** Present ⇒ the grant is INACTIVE (revocation stops future use). */
  revokedAt?: TimestampMs;
}

/** Is the grant active (authorized) right now? (documented rule) */
function isGrantActive(grant: CrossDeviceLearningGrant): boolean {
  return grant.revokedAt === undefined && grant.capabilities.derivedLearningDeltas === true;
}

/** Is the body in the grant's sharing pool? */
function inScope(grant: CrossDeviceLearningGrant, bodyId: string): boolean {
  return grant.bodyScope === "*" || grant.bodyScope.includes(bodyId);
}

function grantIssues(grant: unknown, agentId: string): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (grant === null || typeof grant !== "object") {
    return [{ path: "grant", message: "must be an object" }];
  }
  const g = grant as Record<string, unknown>;
  if (!IdSchema.safeParse(g["grantId"]).success) {
    issues.push({ path: "grantId", message: "must be a valid id" });
  }
  if (!IdSchema.safeParse(g["agentId"]).success) {
    issues.push({ path: "agentId", message: "must be a valid id" });
  } else if ((g["agentId"] as string) !== agentId) {
    issues.push({
      path: "agentId",
      message: `grant targets agent ${String(g["agentId"])} but this runtime is agent ${agentId}`,
    });
  }
  const capabilities = g["capabilities"];
  if (
    capabilities === null ||
    typeof capabilities !== "object" ||
    typeof (capabilities as Record<string, unknown>)["derivedLearningDeltas"] !== "boolean"
  ) {
    issues.push({
      path: "capabilities.derivedLearningDeltas",
      message: "must be a boolean (explicit capability declaration)",
    });
  }
  const scope = g["bodyScope"];
  if (scope !== "*") {
    if (!Array.isArray(scope) || scope.length === 0 || !scope.every((id) => IdSchema.safeParse(id).success)) {
      issues.push({ path: "bodyScope", message: 'must be "*" or a non-empty array of valid ids' });
    }
  }
  const grantedAt = g["grantedAt"];
  if (typeof grantedAt !== "number" || !Number.isInteger(grantedAt) || grantedAt < 0) {
    issues.push({ path: "grantedAt", message: "must be a caller-supplied epoch-ms timestamp" });
  }
  const revokedAt = g["revokedAt"];
  if (revokedAt !== undefined && (typeof revokedAt !== "number" || !Number.isInteger(revokedAt) || revokedAt < 0)) {
    issues.push({ path: "revokedAt", message: "must be an epoch-ms timestamp when present" });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// State-sync port (in-memory adapter = TEST INFRASTRUCTURE)
// ---------------------------------------------------------------------------

/** A derived learning delta stored with its originating body.
 *  `PreferenceDelta` (frozen contract) is the payload — derived
 *  learning state, never raw telemetry (lock #8). */
export interface DerivedLearningDelta {
  delta: PreferenceDelta;
  originBodyId: Id;
  /** Insertion sequence (deterministic order within the store). */
  sequence: number;
}

/**
 * The personal-agent state-sync PORT (declared seam). Implementations
 * are pure storage: record + read. Consent/visibility filtering is the
 * PersonalAgentRuntime's job — the consent authority never lives in
 * storage. Production sync adapters are a later wave.
 */
export interface PersonalAgentStateSync {
  /** Store a delta in a body's device-local store. */
  record(bodyId: Id, delta: PreferenceDelta): Result<DerivedLearningDelta>;
  /** The full stored state (per-body insertion order — deterministic). */
  all(): DerivedLearningDelta[];
}

/**
 * In-memory state-sync adapter — TEST INFRASTRUCTURE (fixture evidence
 * class; AGENTS.md). NOT a production sync implementation; production
 * sync is a later wave.
 */
export function createInMemoryStateSync(): PersonalAgentStateSync {
  const store: DerivedLearningDelta[] = [];
  return {
    record(bodyId: Id, delta: PreferenceDelta): Result<DerivedLearningDelta> {
      const entry: DerivedLearningDelta = { delta, originBodyId: bodyId, sequence: store.length };
      store.push(entry);
      return { ok: true, value: entry };
    },
    all(): DerivedLearningDelta[] {
      return [...store];
    },
  };
}

// ---------------------------------------------------------------------------
// The Personal Agent runtime
// ---------------------------------------------------------------------------

/** Dependencies: the W2-007 body runtime (shared executor seam) and an
 *  optional state-sync adapter (defaults to the in-memory TEST
 *  INFRASTRUCTURE adapter). */
export interface PersonalAgentDeps {
  bodyRuntime: AgentBodyRuntime;
  stateSync?: PersonalAgentStateSync;
}

export interface PersonalAgentRuntime {
  /** The logical identity shared by every registered body. */
  readonly agentId: Id;
  /** Register a device body (full W2-007 validation + instantiation). */
  registerBody(body: AgentBody, assignment: ModelAssignment): Result<AgentInstanceHandle>;
  /** Registered body ids in registration order (deterministic). */
  bodyIds(): Id[];
  /**
   * Run a task on a body — a pure passthrough to the W2-007 handle, so
   * budgets, latency limits, permissions and the envelope law apply
   * with full force. Optional ADR-003 consent FLAGS (never raw values)
   * are recorded as the body's consent view.
   */
  runOnBody(
    bodyId: Id,
    task: BodyTask,
    signals?: PermittedContextSignals,
  ): Result<BodyRunResult>;
  /** The body's latest recorded consent view (flags only). */
  consentViewFor(bodyId: Id): Result<PermittedContextSignals | undefined>;
  /** Add an explicit cross-device learning grant (validated). */
  addGrant(grant: CrossDeviceLearningGrant): Result<CrossDeviceLearningGrant>;
  /** Revoke a grant (caller-supplied timestamp; stops future use). */
  revokeGrant(grantId: Id, revokedAt: TimestampMs): Result<CrossDeviceLearningGrant>;
  /** All grants in insertion order (frozen view). */
  grants(): readonly CrossDeviceLearningGrant[];
  /** Record a derived learning delta into a body's device-local store. */
  recordLearningDelta(bodyId: Id, delta: PreferenceDelta): Result<DerivedLearningDelta>;
  /**
   * Deltas visible to a body: its own device-local deltas ALWAYS, plus
   * other pool bodies' deltas ONLY via an active explicit grant
   * (default deny — no implicit cross-device state sharing).
   */
  visibleDeltas(bodyId: Id): Result<DerivedLearningDelta[]>;
  /** Cross-device sharing transparency: is a pool active for the body? */
  crossDeviceSharingStatus(bodyId: Id): { sharing: boolean; grantId?: Id };
}

/** Factory. The agentId is the logical identity every grant must match. */
export function createPersonalAgentRuntime(
  agentId: Id,
  deps: PersonalAgentDeps,
): Result<PersonalAgentRuntime> {
  if (!IdSchema.safeParse(agentId).success) {
    return invalidInput("createPersonalAgentRuntime: agentId must be a valid id");
  }
  if (deps === null || typeof deps !== "object" || typeof deps.bodyRuntime?.instantiate !== "function") {
    return invalidInput("createPersonalAgentRuntime: deps.bodyRuntime must be an AgentBodyRuntime");
  }

  const stateSync = deps.stateSync ?? createInMemoryStateSync();
  const handles = new Map<Id, AgentInstanceHandle>();
  const bodyOrder: Id[] = [];
  const consentViews = new Map<Id, PermittedContextSignals>();
  const grants: CrossDeviceLearningGrant[] = [];

  function requireBody(bodyId: Id): Result<AgentInstanceHandle> {
    const handle = handles.get(bodyId);
    if (handle === undefined) {
      return invalidInput(`body ${bodyId} is not registered with agent ${agentId}`);
    }
    return { ok: true, value: handle };
  }

  const runtime: PersonalAgentRuntime = {
    agentId,

    registerBody(body: AgentBody, assignment: ModelAssignment): Result<AgentInstanceHandle> {
      const parsedBody = AgentBodySchema.safeParse(body);
      if (!parsedBody.success) {
        return invalidInput(
          "registerBody: invalid agent body",
          parsedBody.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      if (handles.has(parsedBody.data.bodyId)) {
        return invalidInput(`registerBody: body ${parsedBody.data.bodyId} is already registered`);
      }
      const instantiation = deps.bodyRuntime.instantiate(body, assignment);
      if (!instantiation.ok) return instantiation;
      handles.set(instantiation.value.bodyId, instantiation.value);
      bodyOrder.push(instantiation.value.bodyId);
      return instantiation;
    },

    bodyIds(): Id[] {
      return [...bodyOrder];
    },

    runOnBody(bodyId: Id, task: BodyTask, signals?: PermittedContextSignals): Result<BodyRunResult> {
      const handle = requireBody(bodyId);
      if (!handle.ok) return handle;
      if (signals !== undefined) {
        const issues: { path: string; message: string }[] = [];
        if (typeof signals.locationPermitted !== "boolean") {
          issues.push({ path: "signals.locationPermitted", message: "must be a boolean flag" });
        }
        if (typeof signals.attentionObservationPermitted !== "boolean") {
          issues.push({ path: "signals.attentionObservationPermitted", message: "must be a boolean flag" });
        }
        if (issues.length > 0) {
          return invalidInput("runOnBody: consent signals must be permission flags (never raw values)", issues);
        }
        consentViews.set(bodyId, { ...signals });
      }
      // Pure passthrough: budgets/latency/permissions/envelope enforced
      // by the W2-007 handle on every run.
      return handle.value.run(task);
    },

    consentViewFor(bodyId: Id): Result<PermittedContextSignals | undefined> {
      const handle = requireBody(bodyId);
      if (!handle.ok) return handle;
      const view = consentViews.get(bodyId);
      return { ok: true, value: view !== undefined ? { ...view } : undefined };
    },

    addGrant(grant: CrossDeviceLearningGrant): Result<CrossDeviceLearningGrant> {
      const issues = grantIssues(grant, agentId);
      if (issues.length > 0) {
        return invalidInput("addGrant: invalid cross-device grant", issues);
      }
      const stored = grant as CrossDeviceLearningGrant;
      if (grants.some((g) => g.grantId === stored.grantId)) {
        return invalidInput(`addGrant: grant ${stored.grantId} already exists`);
      }
      grants.push(stored);
      return { ok: true, value: stored };
    },

    revokeGrant(grantId: Id, revokedAt: TimestampMs): Result<CrossDeviceLearningGrant> {
      if (typeof revokedAt !== "number" || !Number.isInteger(revokedAt) || revokedAt < 0) {
        return invalidInput("revokeGrant: revokedAt must be a caller-supplied epoch-ms timestamp");
      }
      const grant = grants.find((g) => g.grantId === grantId);
      if (grant === undefined) {
        return invalidInput(`revokeGrant: unknown grant ${grantId}`);
      }
      if (grant.revokedAt !== undefined) {
        return invalidInput(`revokeGrant: grant ${grantId} is already revoked`);
      }
      grant.revokedAt = revokedAt; // stops all FUTURE use (ADR-003)
      return { ok: true, value: { ...grant } };
    },

    grants(): readonly CrossDeviceLearningGrant[] {
      return grants.map((g) => ({ ...g }));
    },

    recordLearningDelta(bodyId: Id, delta: PreferenceDelta): Result<DerivedLearningDelta> {
      const handle = requireBody(bodyId);
      if (!handle.ok) return handle;
      const parsed = PreferenceDeltaSchema.safeParse(delta);
      if (!parsed.success) {
        return invalidInput(
          "recordLearningDelta: delta must be a contract-valid PreferenceDelta (derived learning state — never raw telemetry)",
          parsed.error.issues.map((i) => ({ path: `delta.${i.path.join(".")}`, message: i.message })),
        );
      }
      return stateSync.record(bodyId, parsed.data);
    },

    visibleDeltas(bodyId: Id): Result<DerivedLearningDelta[]> {
      const handle = requireBody(bodyId);
      if (!handle.ok) return handle;
      const everything = stateSync.all();
      const local = everything.filter((entry) => entry.originBodyId === bodyId);
      // DEFAULT DENY: cross-device deltas require an ACTIVE grant whose
      // pool contains BOTH the pulling body and the origin body.
      const cross = [];
      for (const grant of grants) {
        if (!isGrantActive(grant)) continue;
        if (!inScope(grant, bodyId)) continue;
        for (const entry of everything) {
          if (entry.originBodyId === bodyId) continue;
          if (!inScope(grant, entry.originBodyId)) continue;
          cross.push(entry);
        }
      }
      // Dedup by delta id (multiple grants may cover the same delta),
      // preserving first-seen order (deterministic).
      const seen = new Set<string>();
      const merged: DerivedLearningDelta[] = [];
      for (const entry of [...local, ...cross]) {
        if (seen.has(entry.delta.deltaId)) continue;
        seen.add(entry.delta.deltaId);
        merged.push(entry);
      }
      return { ok: true, value: merged };
    },

    crossDeviceSharingStatus(bodyId: Id): { sharing: boolean; grantId?: Id } {
      const grant = grants.find((g) => isGrantActive(g) && inScope(g, bodyId));
      return grant === undefined
        ? { sharing: false }
        : { sharing: true, grantId: grant.grantId };
    },
  };

  return { ok: true, value: runtime };
}
