/**
 * Pure preference-state mathematics (W1-003).
 *
 * Everything in this module is a DETERMINISTIC, side-effect-free
 * function of its inputs (fixed timestamps replay identically). The
 * in-memory adapter is a thin shell over these functions.
 */
import { contentDigest, type PreferenceDelta, type TimestampMs } from "@reckon/contracts";
import type {
  PreferenceScopeRoute,
} from "./port.js";
import { PreferenceOpError } from "./errors.js";

/** Scalar value domain of the frozen PreferenceDelta contract. */
export type PreferenceValue = number | string | boolean | null;

/** Internal accumulated dimension state (per subject/tenant/scope-slot). */
export interface DimensionState {
  dimension: string;
  value: PreferenceValue;
  /** Tombstone: op "remove" — omitted from snapshots until re-set. */
  removed: boolean;
  confidence: number;
  /** Situational slot identity (undefined for stable dimensions). */
  contextKind?: string;
  contextId?: string;
  /** Temporal validity window from the delta scope (either store). */
  validFrom?: number;
  validUntil?: number;
  /** Decay parameters, last-writer-wins when a delta carries them. */
  halfLifeSeconds?: number;
  expiresAt?: number;
  /** Model lineage: last writer per dimension. */
  model: { modelId: string; version: string };
  lastWriteAt: number;
  deltaCount: number;
}

/**
 * Routing rule (structural, from the W1-003 packet):
 * scope.contextKind and/or scope.contextId present ⇒ situational;
 * absent (including a scope with only a temporal window) ⇒ stable.
 */
export function routeDelta(delta: PreferenceDelta): PreferenceScopeRoute {
  const scope = delta.scope;
  if (scope === undefined) return "stable";
  if (scope.contextKind !== undefined || scope.contextId !== undefined) return "situational";
  return "stable";
}

/** Slot key: situational dimensions are keyed by their context scope. */
export function situationalSlotKey(delta: PreferenceDelta): string {
  const scope = delta.scope ?? {};
  return `ck:${scope.contextKind ?? ""}|ci:${scope.contextId ?? ""}`;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Confidence accumulation (deterministic):
 * - `resultingConfidence`, when provided, WINS over accumulation.
 * - otherwise current + confidenceDelta, clamped to [0, 1].
 * Each distinct delta contributes exactly once (the adapter enforces
 * per-deltaId idempotency), so the accumulator is a deterministic
 * function of the applied delta-log prefix.
 */
export function accumulateConfidence(current: number, delta: PreferenceDelta): number {
  if (delta.resultingConfidence !== undefined) {
    return clamp01(delta.resultingConfidence);
  }
  return clamp01(current + (delta.confidenceDelta ?? 0));
}

/** Resolve the operand payload for arithmetic ops. */
function operandOf(delta: PreferenceDelta): number | string | boolean | null | undefined {
  if (delta.newValue !== undefined) return delta.newValue;
  if (delta.value !== undefined) return delta.value;
  return undefined;
}

/**
 * Apply the update op to a value. Deterministic semantics:
 *
 * - `set`     → replace with `newValue ?? value ?? null`.
 * - `add`     → numeric addition; missing prior is 0 (additive identity).
 * - `multiply`→ numeric multiplication; missing prior is 1 (identity).
 * - `decay`   → numeric multiplication by the operand — the EXPLICIT,
 *               immediate form of decay (the `decay` block on the delta
 *               is the deferred, snapshot-time form).
 * - `remove`  → tombstone.
 * - `merge`   → numbers add; strings concatenate; booleans OR;
 *               null/missing absorbs the other side; type mismatches
 *               are typed errors.
 *
 * All non-number×number combinations outside those rules are rejected
 * with `PreferenceOpError` — never a silent coercion.
 */
export function applyValueOp(
  delta: PreferenceDelta,
  current: PreferenceValue | undefined
): { value: PreferenceValue; removed: boolean } {
  switch (delta.op) {
    case "set": {
      const target: PreferenceValue =
        delta.newValue !== undefined ? delta.newValue : delta.value !== undefined ? delta.value : null;
      return { value: target, removed: false };
    }
    case "remove": {
      return { value: null, removed: true };
    }
    case "add":
    case "multiply":
    case "decay": {
      const operand = operandOf(delta);
      if (typeof operand !== "number") {
        throw new PreferenceOpError(
          `op "${delta.op}" requires a numeric payload (newValue or value)`,
          { op: delta.op, dimension: delta.dimension, payloadType: typeof operand }
        );
      }
      const identity = delta.op === "add" ? 0 : 1;
      const base =
        current === undefined || current === null
          ? identity
          : current;
      if (typeof base !== "number") {
        throw new PreferenceOpError(
          `op "${delta.op}" requires the current value to be numeric`,
          { op: delta.op, dimension: delta.dimension, currentType: typeof current }
        );
      }
      const value = delta.op === "add" ? base + operand : base * operand;
      if (!Number.isFinite(value)) {
        throw new PreferenceOpError(`op "${delta.op}" produced a non-finite value`, {
          op: delta.op,
          dimension: delta.dimension,
        });
      }
      return { value, removed: false };
    }
    case "merge": {
      const operand = operandOf(delta);
      if (operand === undefined || operand === null) {
        // Merging with nothing keeps the current value.
        return { value: current ?? null, removed: false };
      }
      if (current === undefined || current === null) {
        return { value: operand, removed: false };
      }
      if (typeof current === "number" && typeof operand === "number") {
        const value = current + operand;
        if (!Number.isFinite(value)) {
          throw new PreferenceOpError("op merge produced a non-finite value", {
            op: "merge",
            dimension: delta.dimension,
          });
        }
        return { value, removed: false };
      }
      if (typeof current === "string" && typeof operand === "string") {
        return { value: current + operand, removed: false };
      }
      if (typeof current === "boolean" && typeof operand === "boolean") {
        return { value: current || operand, removed: false };
      }
      throw new PreferenceOpError(
        "op merge cannot combine mismatched value types",
        { op: "merge", dimension: delta.dimension, currentType: typeof current, operandType: typeof operand }
      );
    }
    default: {
      // Exhaustiveness guard: the frozen op enum covers all cases above.
      throw new PreferenceOpError(`unsupported preference op`, {
        op: String((delta as { op?: unknown }).op),
        dimension: delta.dimension,
      });
    }
  }
}

/**
 * Pure snapshot-time decay factor: 2^(−elapsedSeconds / halfLifeSeconds),
 * where elapsed is clamped at 0 (querying before the write time never
 * AMPLIFIES a value).
 */
export function decayFactor(at: TimestampMs, lastWriteAt: TimestampMs, halfLifeSeconds: number): number {
  const elapsedMs = Math.max(0, at - lastWriteAt);
  return Math.pow(2, -(elapsedMs / 1000) / halfLifeSeconds);
}

/**
 * Temporal validity of a dimension at an evaluation time:
 * valid within [validFrom, validUntil / expiresAt] INCLUSIVE bounds;
 * strictly after expiresAt/validUntil the value is gone.
 */
export function isDimensionLiveAt(
  state: Pick<DimensionState, "validFrom" | "validUntil" | "expiresAt" | "lastWriteAt">,
  at: TimestampMs
): boolean {
  if (state.validFrom !== undefined && at < state.validFrom) return false;
  if (state.validUntil !== undefined && at > state.validUntil) return false;
  if (state.expiresAt !== undefined && at > state.expiresAt) return false;
  return true;
}

/** Compute the (possibly decayed) snapshot value of a dimension at `at`. */
export function snapshotValueAt(
  state: Pick<DimensionState, "value" | "halfLifeSeconds" | "lastWriteAt">,
  at: TimestampMs
): PreferenceValue {
  if (typeof state.value === "number" && state.halfLifeSeconds !== undefined) {
    return state.value * decayFactor(at, state.lastWriteAt, state.halfLifeSeconds);
  }
  // Non-numeric values are not decayed (only their expiry applies).
  return state.value;
}

/**
 * Fold a sequence of deltas into accumulated dimension state.
 *
 * THE NO-FUTURE-LEAKAGE LAW (deterministic replay): an as-of time `at`
 * is enforced by filtering the delta log to `timestamp <= at` BEFORE
 * folding — a write timestamped after the query time can never appear
 * in that snapshot. The fold itself is order-deterministic (log order)
 * and last-writer-wins per dimension/slot.
 */
export interface FoldedState {
  stable: Map<string, DimensionState>;
  situational: Map<string, DimensionState>;
}

/** Slot key of a delta within its routed store. */
export function slotKeyOf(delta: PreferenceDelta): string {
  const route = routeDelta(delta);
  return route === "stable"
    ? delta.dimension
    : `${situationalSlotKey(delta)}|${delta.dimension}`;
}

/** Advance one store-map by one delta (mutates the map). */
export function advanceState(
  store: Map<string, DimensionState>,
  delta: PreferenceDelta
): DimensionState {
  const route = routeDelta(delta);
  const slotKey = slotKeyOf(delta);
  const prior = store.get(slotKey);
  const { value, removed } = applyValueOp(delta, prior?.value);
  const confidence = accumulateConfidence(prior?.confidence ?? 0, delta);

  const next: DimensionState = {
    dimension: delta.dimension,
    value,
    removed,
    confidence,
    ...(route === "situational"
      ? {
          contextKind: delta.scope?.contextKind,
          contextId: delta.scope?.contextId,
        }
      : {}),
    ...(delta.scope?.validFrom !== undefined
      ? { validFrom: delta.scope.validFrom }
      : prior?.validFrom !== undefined
        ? { validFrom: prior.validFrom }
        : {}),
    ...(delta.scope?.validUntil !== undefined
      ? { validUntil: delta.scope.validUntil }
      : prior?.validUntil !== undefined
        ? { validUntil: prior.validUntil }
        : {}),
    ...(delta.decay?.halfLifeSeconds !== undefined
      ? { halfLifeSeconds: delta.decay.halfLifeSeconds }
      : prior?.halfLifeSeconds !== undefined
        ? { halfLifeSeconds: prior.halfLifeSeconds }
        : {}),
    ...(delta.decay?.expiresAt !== undefined
      ? { expiresAt: delta.decay.expiresAt }
      : prior?.expiresAt !== undefined
        ? { expiresAt: prior.expiresAt }
        : {}),
    model: { modelId: delta.model.modelId, version: delta.model.version },
    lastWriteAt: delta.timestamp,
    deltaCount: (prior?.deltaCount ?? 0) + 1,
  };
  store.set(slotKey, next);
  return next;
}

/** Fold deltas (in the given order) into fresh stable/situational maps. */
export function foldPreferenceState(deltas: readonly PreferenceDelta[]): FoldedState {
  const stable = new Map<string, DimensionState>();
  const situational = new Map<string, DimensionState>();
  for (const delta of deltas) {
    const store = routeDelta(delta) === "stable" ? stable : situational;
    advanceState(store, delta);
  }
  return { stable, situational };
}

/** Deterministic content digest of a parsed delta. */
export function deltaDigest(delta: PreferenceDelta): string {
  return contentDigest(delta);
}
