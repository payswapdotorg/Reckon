/**
 * Typed errors for @reckon/simulation.
 *
 * Rule (repo-wide): simulation failures NEVER throw raw strings — every
 * failure is a discriminated, typed error carrying a machine-readable
 * `code` plus structured details (AGENTS.md completion standard).
 */

/** Machine-readable error codes for the simulation package. */
export const SIMULATION_ERROR_CODES = [
  "SIM_VALIDATION_FAILED",
  "SIM_SEED_INVALID",
  "SIM_CONFIGURATION_INVALID",
  "SIM_TENANT_MISMATCH",
  "SIM_SUBJECT_MISMATCH",
  "SIM_CUTOFF_VIOLATION",
  "SIM_EVIDENCE_CLASS_VIOLATION",
  "SIM_CLOCK_VIOLATION",
  "SIM_ACTION_UNKNOWN",
  "SIM_REWARD_BINDING_MISSING",
  "SIM_EPISODE_CLOSED",
] as const;

export type SimulationErrorCode = (typeof SIMULATION_ERROR_CODES)[number];

/** One zod issue summary (field path + message), serializable. */
export interface SimulationValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface SimulationErrorDetails {
  readonly [key: string]: unknown;
}

/** Base typed error for @reckon/simulation, discriminated by `code`. */
export class SimulationError extends Error {
  readonly code: SimulationErrorCode;
  readonly details: SimulationErrorDetails;

  constructor(code: SimulationErrorCode, message: string, details: SimulationErrorDetails = {}) {
    super(message);
    this.name = "SimulationError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A record (or structural shape) failed its frozen schema validation. */
export class SimulationValidationError extends SimulationError {
  readonly issues: readonly SimulationValidationIssue[];
  constructor(message: string, issues: readonly SimulationValidationIssue[], input: unknown) {
    super("SIM_VALIDATION_FAILED", message, { issueCount: issues.length, inputType: typeof input });
    this.name = "SimulationValidationError";
    this.issues = issues;
  }
}

/** Seed is not a uint64 decimal string / safe non-negative integer. */
export class SimulationSeedInvalidError extends SimulationError {
  constructor(seed: string, reason: string) {
    super("SIM_SEED_INVALID", `invalid seed "${seed}": ${reason}`, { seed, reason });
    this.name = "SimulationSeedInvalidError";
  }
}

/** Simulation configuration field out of range / wrong shape. */
export class SimulationConfigurationError extends SimulationError {
  constructor(message: string, details: SimulationErrorDetails = {}) {
    super("SIM_CONFIGURATION_INVALID", message, details);
    this.name = "SimulationConfigurationError";
  }
}

/**
 * Tenant isolation (contracts.md #5): an input record belongs to a
 * different tenant than the world being built. Structural rejection —
 * cross-tenant evidence can never silently enter a world model.
 */
export class SimulationTenantMismatchError extends SimulationError {
  constructor(expectedTenant: string, recordTenant: string, recordId: string) {
    super(
      "SIM_TENANT_MISMATCH",
      `record ${recordId} belongs to tenant ${recordTenant}, but the world model is scoped to tenant ${expectedTenant}`,
      { expectedTenant, recordTenant, recordId }
    );
    this.name = "SimulationTenantMismatchError";
  }
}

/**
 * Subject scoping: the world model is a single-subject simulation; an
 * input event from a different subject is rejected explicitly (an
 * audience-level model is a separate composition, not silent mixing).
 */
export class SimulationSubjectMismatchError extends SimulationError {
  constructor(expectedSubject: string, recordSubject: string, recordId: string) {
    super(
      "SIM_SUBJECT_MISMATCH",
      `event ${recordId} belongs to subject ${recordSubject}, but the world model is scoped to subject ${expectedSubject}`,
      { expectedSubject, recordSubject, recordId }
    );
    this.name = "SimulationSubjectMismatchError";
  }
}

/**
 * NO-FUTURE-LEAKAGE (architecture-lock): an anchor input (context
 * snapshot) is timestamped AFTER the information cutoff. Unlike
 * recent events (which are dropped + counted), an anchor from the
 * future taints the whole state and is rejected.
 */
export class SimulationCutoffViolationError extends SimulationError {
  constructor(informationCutoff: number, observedAt: number, what: string) {
    super(
      "SIM_CUTOFF_VIOLATION",
      `${what} is timestamped at ${observedAt}, after the information cutoff ${informationCutoff} — future information cannot anchor a world model`,
      { informationCutoff, observedAt, what }
    );
    this.name = "SimulationCutoffViolationError";
  }
}

/**
 * Evidence-class law (contracts.md #9, architecture-lock #20): only
 * `evidenceClass: "simulated"` research-class records may be appended
 * to a world model's simulated-event partition. An observed-class
 * record can never masquerade as simulator output.
 */
export class SimulationEvidenceClassViolationError extends SimulationError {
  constructor(eventId: string, evidenceClass: string) {
    super(
      "SIM_EVIDENCE_CLASS_VIOLATION",
      `simulated event ${eventId} carries evidenceClass "${evidenceClass}" — simulator output MUST be evidenceClass "simulated" (research class), never an observed class`,
      { eventId, evidenceClass }
    );
    this.name = "SimulationEvidenceClassViolationError";
  }
}

/**
 * Virtual-clock monotonicity: an event was stamped before the current
 * simulation clock (the clock only ever moves forward).
 */
export class SimulationClockViolationError extends SimulationError {
  constructor(eventId: string, occurredAt: number, simulationClock: number) {
    super(
      "SIM_CLOCK_VIOLATION",
      `simulated event ${eventId} is stamped at ${occurredAt}, before the simulation clock ${simulationClock} — the virtual clock is monotonic`,
      { eventId, occurredAt, simulationClock }
    );
    this.name = "SimulationClockViolationError";
  }
}

/** The referenced experience/action is not part of the world state. */
export class SimulationActionUnknownError extends SimulationError {
  constructor(actionId: string, worldDigest: string) {
    super(
      "SIM_ACTION_UNKNOWN",
      `action/experience "${actionId}" is not part of this world (state digest ${worldDigest})`,
      { actionId, worldDigest }
    );
    this.name = "SimulationActionUnknownError";
  }
}

/**
 * A declared RewardSpec has a term with no metric binding — reward is
 * traceable or it is rejected (never silently zero, never a hidden
 * engagement default).
 */
export class SimulationRewardBindingMissingError extends SimulationError {
  constructor(termId: string, kind: string) {
    super(
      "SIM_REWARD_BINDING_MISSING",
      `reward term ${termId} (kind "${kind}") has no metric binding`,
      { termId, kind }
    );
    this.name = "SimulationRewardBindingMissingError";
  }
}

/** Stepping a simulator/environment that has already terminated. */
export class SimulationEpisodeClosedError extends SimulationError {
  constructor(reason: string) {
    super("SIM_EPISODE_CLOSED", `episode already closed: ${reason}`, { reason });
    this.name = "SimulationEpisodeClosedError";
  }
}

/** Narrow unknown to a shaped zod failure payload. */
export function toSimulationIssues(error: unknown): SimulationValidationIssue[] {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    const raw = (error as { issues: unknown[] }).issues;
    return raw.map((issue) => {
      const rec = (issue ?? {}) as Record<string, unknown>;
      const path = Array.isArray(rec.path)
        ? rec.path.map((p) => String(p)).join(".")
        : String(rec.path ?? "");
      return {
        path,
        message: String(rec.message ?? "invalid value"),
        code: String(rec.code ?? "custom"),
      };
    });
  }
  return [{ path: "", message: "record failed schema validation", code: "custom" }];
}
