/**
 * Typed errors for @reckon/learning.
 *
 * Rule (repo-wide): environment/learning failures NEVER throw raw
 * strings — every failure is a discriminated, typed error carrying a
 * machine-readable `code` plus structured details.
 */

/** Machine-readable error codes for the learning package. */
export const LEARNING_ERROR_CODES = [
  "LEARNING_VALIDATION_FAILED",
  "LEARNING_INVALID_ARGUMENT",
  "LEARNING_ENVIRONMENT_CONFIG_INVALID",
  "LEARNING_EPISODE_NOT_RESET",
  "LEARNING_EPISODE_CLOSED",
  "LEARNING_ACTION_UNKNOWN",
  "LEARNING_REWARD_BINDING_MISSING",
  "LEARNING_REWARD_BINDING_INVALID",
] as const;

export type LearningErrorCode = (typeof LEARNING_ERROR_CODES)[number];

/** One zod issue summary (field path + message), serializable. */
export interface LearningValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface LearningErrorDetails {
  readonly [key: string]: unknown;
}

/** Base typed error for @reckon/learning, discriminated by `code`. */
export class LearningError extends Error {
  readonly code: LearningErrorCode;
  readonly details: LearningErrorDetails;

  constructor(code: LearningErrorCode, message: string, details: LearningErrorDetails = {}) {
    super(message);
    this.name = "LearningError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A record failed a frozen schema validation. */
export class LearningValidationError extends LearningError {
  readonly issues: readonly LearningValidationIssue[];
  constructor(message: string, issues: readonly LearningValidationIssue[], input: unknown) {
    super("LEARNING_VALIDATION_FAILED", message, { issueCount: issues.length, inputType: typeof input });
    this.name = "LearningValidationError";
    this.issues = issues;
  }
}

/** Invalid runtime argument (bad action id, bad seed, …). */
export class LearningArgumentError extends LearningError {
  constructor(message: string, details: LearningErrorDetails = {}) {
    super("LEARNING_INVALID_ARGUMENT", message, details);
    this.name = "LearningArgumentError";
  }
}

/** Environment configuration failed validation (construction time). */
export class EnvironmentConfigInvalidError extends LearningError {
  constructor(message: string, details: LearningErrorDetails = {}) {
    super("LEARNING_ENVIRONMENT_CONFIG_INVALID", message, details);
    this.name = "EnvironmentConfigInvalidError";
  }
}

/** step() before reset(seed). */
export class EpisodeNotResetError extends LearningError {
  constructor() {
    super("LEARNING_EPISODE_NOT_RESET", "reset(seed) must be called before step(action)");
    this.name = "EpisodeNotResetError";
  }
}

/** step() after the episode terminated or truncated. */
export class EpisodeClosedError extends LearningError {
  constructor(reason: string) {
    super("LEARNING_EPISODE_CLOSED", `episode already closed: ${reason}`, { reason });
    this.name = "EpisodeClosedError";
  }
}

/** Unknown action id. */
export class ActionUnknownError extends LearningError {
  constructor(actionId: string, environmentId: string) {
    super(
      "LEARNING_ACTION_UNKNOWN",
      `action "${actionId}" is not part of environment ${environmentId}`,
      { actionId, environmentId }
    );
    this.name = "ActionUnknownError";
  }
}

/** A RewardSpec term has no binding (construction time, fail fast). */
export class RewardBindingMissingError extends LearningError {
  constructor(termId: string, kind: string) {
    super(
      "LEARNING_REWARD_BINDING_MISSING",
      `reward term ${termId} (kind "${kind}") has no binding — every declared term must be traceable`,
      { termId, kind }
    );
    this.name = "RewardBindingMissingError";
  }
}

/** A binding returned a non-finite value (runtime). */
export class RewardBindingInvalidError extends LearningError {
  constructor(termId: string, value: unknown) {
    super(
      "LEARNING_REWARD_BINDING_INVALID",
      `reward binding for term ${termId} returned a non-finite value: ${String(value)}`,
      { termId, value: String(value) }
    );
    this.name = "RewardBindingInvalidError";
  }
}

/** Narrow unknown to a shaped zod failure payload. */
export function toLearningIssues(error: unknown): LearningValidationIssue[] {
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
