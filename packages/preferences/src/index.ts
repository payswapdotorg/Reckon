/**
 * @reckon/preferences — preference state and deltas (W1-003).
 *
 * - Stable vs situational stores: `scope.contextKind`/`contextId`
 *   present ⇒ situational; absent ⇒ stable. A situational delta NEVER
 *   writes into the stable store (one topic/view must not permanently
 *   redefine long-term taste).
 * - Decay/expiry: `snapshot(at)` computes decayed values as a pure,
 *   deterministic function of the caller-supplied time.
 * - Confidence: `confidenceDelta` accumulates (clamped [0, 1]);
 *   `resultingConfidence` wins when provided.
 * - Model lineage: last-writer-wins per dimension; the FULL delta log
 *   is retained and readable via `log()`.
 * - Every delta is validated against the frozen
 *   `PreferenceDeltaSchema` — invalid shapes are typed errors.
 */
export * from "./errors.js";
export * from "./port.js";
export {
  routeDelta,
  situationalSlotKey,
  slotKeyOf,
  advanceState,
  foldPreferenceState,
  accumulateConfidence,
  applyValueOp,
  decayFactor,
  isDimensionLiveAt,
  snapshotValueAt,
  deltaDigest,
  type DimensionState,
  type FoldedState,
  type PreferenceValue,
} from "./state.js";
export { InMemoryPreferenceStoreAdapter } from "./adapter.js";
