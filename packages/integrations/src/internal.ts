/**
 * W3-005/W3-006 — domain-neutral internal helpers shared by the
 * reference adapters. Nothing in this module contains host vocabulary;
 * it exists so both adapters share ONE deterministic implementation of
 * validation primitives, id derivation, day-part derivation and the
 * host-authoritative plan-state transitions.
 */
import {
  IdSchema,
  LocaleSchema,
  contentDigest,
} from "@reckon/contracts";
import type { PlanState } from "../../scheduler/src/index.js";
import type { AdapterResult, IssueList } from "./errors.js";
import { invalidAdapterInput } from "./errors.js";

// ---------------------------------------------------------------------------
// Validation primitives (issue-collector style, fail-closed)
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

/** Validate a string field into `issues` (fail-closed). */
export function checkString(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: IssueList,
): void {
  if (typeof value !== "string") {
    issues.push({ path, message: "must be a string" });
    return;
  }
  if (value.length < min || value.length > max) {
    issues.push({ path, message: `length must be between ${min} and ${max}` });
  }
}

/** Validate an opaque contract Id field into `issues`. */
export function checkId(
  value: unknown,
  path: string,
  issues: IssueList,
): void {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) {
    issues.push({ path, message: "must be a valid contract id (url-safe, 1-128 chars)" });
  }
}

/** Validate an optional field with a checker (present ⇒ checked). */
export function checkOptional<T>(
  value: unknown,
  path: string,
  check: (v: unknown, path: string, issues: IssueList) => void,
  issues: IssueList,
): void {
  if (value === undefined) return;
  check(value, path, issues);
}

/** Validate a caller-supplied timestamp (epoch ms, non-negative integer). */
export function checkTimestamp(value: unknown, path: string, issues: IssueList): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    issues.push({ path, message: "must be a non-negative integer epoch-millisecond timestamp" });
  }
}

/** Validate a finite non-negative number. */
export function checkNonNegativeNumber(value: unknown, path: string, issues: IssueList): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issues.push({ path, message: "must be a finite non-negative number" });
  }
}

/** Validate an array of strings with per-entry length bounds. */
export function checkStringArray(
  value: unknown,
  path: string,
  min: number,
  max: number,
  entryMin: number,
  entryMax: number,
  issues: IssueList,
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array of strings" });
    return;
  }
  if (value.length < min || value.length > max) {
    issues.push({ path, message: `must contain between ${min} and ${max} entries` });
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length < entryMin || entry.length > entryMax) {
      issues.push({ path: `${path}[${index}]`, message: `must be a string of ${entryMin}-${entryMax} chars` });
    }
  });
}

/** Validate a closed string vocabulary; returns the narrowed value or undefined. */
export function checkEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  issues: IssueList,
): T | undefined {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    issues.push({ path, message: `must be one of: ${allowed.join(", ")}` });
    return undefined;
  }
  return value as T;
}

/** Validate an optional array whose entries come from a closed vocabulary. */
export function checkEnumArray<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  issues: IssueList,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, message: `must be an array of: ${allowed.join(", ")}` });
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !(allowed as readonly string[]).includes(entry)) {
      issues.push({ path: `${path}[${index}]`, message: `must be one of: ${allowed.join(", ")}` });
    }
  });
}

/** Validate an optional boolean. */
export function checkOptionalBoolean(value: unknown, path: string, issues: IssueList): void {
  if (value !== undefined && typeof value !== "boolean") {
    issues.push({ path, message: "must be a boolean" });
  }
}

/** Validate an optional locale against the frozen contract schema. */
export function checkOptionalLocale(value: unknown, path: string, issues: IssueList): void {
  if (value === undefined) return;
  const parsed = LocaleSchema.safeParse(value);
  if (!parsed.success) {
    issues.push({ path, message: "must be a BCP-47 language tag (e.g. en, pt-BR)" });
  }
}

// ---------------------------------------------------------------------------
// Deterministic derivations
// ---------------------------------------------------------------------------

/**
 * Deterministic id derivation from content (same convention as the W2
 * kernels: prefix + leading slice of the canonical content digest).
 */
export function deriveId(prefix: string, domain: string, payload: unknown): string {
  return `${prefix}${contentDigest({ domain, payload }).slice(0, 24)}`;
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Derive the contract day-part from a "HH:MM" 24h local time string
 * (documented deterministic rule): hour < 5 → night, < 12 → morning,
 * < 18 → afternoon, < 23 → evening, else night.
 */
export function dayPartOf(localTime: string): "morning" | "afternoon" | "evening" | "night" {
  const hour = Number.parseInt(localTime.slice(0, 2), 10);
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 23) return "evening";
  return "night";
}

/** Validate a "HH:MM" 24h local time string. */
export function checkLocalTime(value: unknown, path: string, issues: IssueList): void {
  if (typeof value !== "string" || !LOCAL_TIME_PATTERN.test(value)) {
    issues.push({ path, message: 'must be a 24h "HH:MM" local time string' });
  }
}

export function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && LOCAL_TIME_PATTERN.test(value);
}

/** Sorted, de-duplicated label list (deterministic regardless of input order). */
export function sortedUniqueLabels(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Host-authoritative plan-state transitions (shared by both adapters)
// ---------------------------------------------------------------------------

const IDLE_PLAN_STATE: PlanState = {
  status: "idle",
  queue: [],
  resumeCheckpoints: [],
};

/** A fresh idle plan state (start of a host session). */
export function idlePlanState(): PlanState {
  return { status: IDLE_PLAN_STATE.status, queue: [], resumeCheckpoints: [] };
}

/**
 * Host "start playing experience X" transition. The host player is the
 * delivery authority: starting playback is recorded as plan-state
 * truth (the scheduler never auto-starts). The experience is removed
 * from the queue when present; resume checkpoints are preserved.
 */
export function hostStartTransition(
  current: PlanState,
  experienceId: string,
): AdapterResult<PlanState> {
  if (current.status === "ended") {
    return invalidAdapterInput("host play: plan is ended (terminal state); no host action is legal");
  }
  return {
    ok: true,
    value: {
      status: "playing",
      currentExperienceId: experienceId,
      queue: current.queue.filter((id) => id !== experienceId),
      resumeCheckpoints: [...current.resumeCheckpoints],
    },
  };
}

/**
 * Host "enqueue experiences" transition. Ids already queued are not
 * duplicated; an idle plan becomes queued; playing/interrupted states
 * are preserved (queueing never interrupts).
 */
export function hostEnqueueTransition(
  current: PlanState,
  experienceIds: readonly string[],
): AdapterResult<PlanState> {
  if (current.status === "ended") {
    return invalidAdapterInput("host queue: plan is ended (terminal state); no host action is legal");
  }
  const queue = [...current.queue];
  for (const id of experienceIds) {
    if (!queue.includes(id)) queue.push(id);
  }
  return {
    ok: true,
    value: {
      status: current.status === "idle" ? "queued" : current.status,
      ...(current.currentExperienceId !== undefined
        ? { currentExperienceId: current.currentExperienceId }
        : {}),
      ...(current.interruptedExperienceId !== undefined
        ? { interruptedExperienceId: current.interruptedExperienceId }
        : {}),
      queue,
      resumeCheckpoints: [...current.resumeCheckpoints],
    },
  };
}

/** Validate that a value is a plan-state-shaped object (structural guard). */
export function checkPlanState(value: unknown, path: string, issues: IssueList): void {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "must be a plan state object" });
    return;
  }
  if (value["status"] !== "idle" && value["status"] !== "playing" && value["status"] !== "queued" && value["status"] !== "interrupted" && value["status"] !== "ended") {
    issues.push({ path: `${path}.status`, message: "must be a known plan status" });
  }
  if (!Array.isArray(value["queue"])) {
    issues.push({ path: `${path}.queue`, message: "must be an array of experience ids" });
  }
  if (!Array.isArray(value["resumeCheckpoints"])) {
    issues.push({ path: `${path}.resumeCheckpoints`, message: "must be an array of resume checkpoints" });
  }
}
