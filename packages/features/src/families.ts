/**
 * Pure feature families (W1-004).
 *
 * Every family is a named, deterministic, side-effect-free function.
 * Enum codes map to the FROZEN contract enums (TL3-frozen; index maps
 * are complete over the frozen value sets). Absent optional values use
 * the documented marker −1 (or 0 with an explicit presence flag).
 *
 * NO-FUTURE-LEAKAGE: `temporalFeatures` filters `occurredAt <= at`
 * BEFORE computing anything — future events can never leak in.
 */
import type {
  CatalogItem,
  ContextSnapshot,
  Experience,
  OutcomeEvent,
  Realization,
} from "@reckon/contracts";
import {
  OUTCOME_EVENT_TYPES,
  OBSERVED_EVIDENCE_CLASSES,
  RESEARCH_EVIDENCE_CLASSES,
  FORMAT_KINDS,
} from "@reckon/contracts";
import { bucketCounts, stableBucket, LABEL_BUCKETS } from "./hashing.js";
import type { PreferenceSnapshotInput } from "./port.js";

/** One family's contribution: parallel values/names arrays. */
export interface FamilyResult {
  readonly family: string;
  readonly values: number[];
  readonly names: string[];
}

/** Enum-code helper: index of the value in a frozen order, −1 if absent. */
function codeOf<T extends string>(order: readonly T[], value: T | undefined): number {
  if (value === undefined) return -1;
  const index = order.indexOf(value);
  return index; // frozen enums: always found for schema-valid inputs
}

// ---- Frozen enum orders (mirroring the contract literals) ----
const ITEM_KINDS = ["media", "commerce", "advertising", "notification", "article", "other"] as const;
const DAY_PARTS = ["morning", "afternoon", "evening", "night", "unknown"] as const;
const DEVICE_CLASSES = ["phone", "tablet", "desktop", "tv", "vehicle", "audio", "other", "unknown"] as const;
const AUDIO_ROUTES = ["none", "speaker", "headphones", "vehicle", "other", "unknown"] as const;
const NETWORK_CLASSES = ["offline", "metered", "wifi", "cellular", "unknown"] as const;
const BANDWIDTH_HINTS = ["low", "medium", "high", "unknown"] as const;
const ATTENTION_QUALITIES = ["full", "partial", "background", "interrupted", "unknown"] as const;
const MIN_BANDWIDTHS = ["low", "medium", "high"] as const;
// FORMAT_KINDS and OUTCOME_EVENT_TYPES are exported by @reckon/contracts.

/**
 * ITEM features — per input item (fixed 20-value block):
 * kind code, label count, label bucket-count vector (16), availability
 * window flag, attribute count. Label lists hash COMMUTATIVELY (order
 * of labels does not matter); item ORDER in the input does (index in
 * feature names).
 */
export function itemFeatures(items: readonly CatalogItem[]): FamilyResult {
  const values: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const labelCounts = bucketCounts(item.labels);
    values.push(
      codeOf(ITEM_KINDS, item.kind),
      item.labels.length,
      ...labelCounts,
      item.availableFrom !== undefined || item.availableUntil !== undefined ? 1 : 0,
      Object.keys(item.attributes).length
    );
    names.push(
      `item[${i}].kindCode`,
      `item[${i}].labelCount`,
      ...Array.from({ length: LABEL_BUCKETS }, (_, b) => `item[${i}].labelBucket[${b}]`),
      `item[${i}].hasAvailabilityWindow`,
      `item[${i}].attributeCount`
    );
  }
  return { family: "item", values, names };
}

/**
 * REALIZATION features — per realization (fixed 4-value block):
 * hashed kind bucket, locale presence, hashed locale bucket (−1 when
 * absent), constraint count. Host vocabulary is hashed only.
 */
export function realizationFeatures(realizations: readonly Realization[]): FamilyResult {
  const values: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < realizations.length; i++) {
    const realization = realizations[i]!;
    values.push(
      stableBucket(realization.kind),
      realization.locale !== undefined ? 1 : 0,
      realization.locale !== undefined ? stableBucket(realization.locale) : -1,
      Object.keys(realization.constraints).length
    );
    names.push(
      `realization[${i}].kindBucket`,
      `realization[${i}].hasLocale`,
      `realization[${i}].localeBucket`,
      `realization[${i}].constraintCount`
    );
  }
  return { family: "realization", values, names };
}

/**
 * EXPERIENCE features — per experience (fixed 12-value block):
 * format kind code, duration presence/seconds (−1 for ISO-string
 * durations — opaque to the core), locale presence/bucket, screen/audio
 * requirements (−1 unknown), min bandwidth code, timing window
 * presence, transformation and constraint counts, objective fit score
 * (−1 absent), device-class count.
 */
export function experienceFeatures(experiences: readonly Experience[]): FamilyResult {
  const values: number[] = [];
  const names: string[] = [];
  for (let i = 0; i < experiences.length; i++) {
    const experience = experiences[i]!;
    const numericDuration =
      typeof experience.duration === "number" ? experience.duration : -1;
    const timing = experience.timing;
    const hasTimingWindow =
      timing !== undefined &&
      (timing.earliestMs !== undefined ||
        timing.latestMs !== undefined ||
        timing.availabilityWindow !== undefined)
        ? 1
        : 0;
    values.push(
      codeOf(FORMAT_KINDS, experience.format.kind),
      experience.duration !== undefined ? 1 : 0,
      numericDuration,
      experience.locale !== undefined ? 1 : 0,
      experience.locale !== undefined ? stableBucket(experience.locale) : -1,
      experience.requirements?.requiresScreen === undefined
        ? -1
        : experience.requirements.requiresScreen
          ? 1
          : 0,
      experience.requirements?.requiresAudio === undefined
        ? -1
        : experience.requirements.requiresAudio
          ? 1
          : 0,
      codeOf(MIN_BANDWIDTHS, experience.requirements?.minBandwidth),
      hasTimingWindow,
      experience.transformations.length,
      experience.constraints.length,
      experience.objectiveFit?.fitScore ?? -1,
      experience.requirements?.deviceClass.length ?? 0
    );
    names.push(
      `experience[${i}].formatKindCode`,
      `experience[${i}].hasDuration`,
      `experience[${i}].durationSeconds`,
      `experience[${i}].hasLocale`,
      `experience[${i}].localeBucket`,
      `experience[${i}].requiresScreen`,
      `experience[${i}].requiresAudio`,
      `experience[${i}].minBandwidthCode`,
      `experience[${i}].hasTimingWindow`,
      `experience[${i}].transformationCount`,
      `experience[${i}].constraintCount`,
      `experience[${i}].objectiveFitScore`,
      `experience[${i}].deviceClassCount`
    );
  }
  return { family: "experience", values, names };
}

/**
 * PREFERENCE (user) features — aggregate over the structural
 * preference snapshot (8 values). Zeros when no snapshot is supplied.
 */
export function preferenceFeatures(preferences: PreferenceSnapshotInput | undefined): FamilyResult {
  const stable = preferences?.stable ?? [];
  const situational = preferences?.situational ?? [];
  const meanConf = (dims: readonly { confidence: number }[]): number =>
    dims.length === 0 ? 0 : dims.reduce((acc, d) => acc + d.confidence, 0) / dims.length;
  const magnitudeSum = (dims: readonly { value: number | string | boolean | null }[]): number =>
    dims.reduce((acc, d) => (typeof d.value === "number" ? acc + Math.abs(d.value) : acc), 0);
  const numericCount = (dims: readonly { value: number | string | boolean | null }[]): number =>
    dims.reduce((acc, d) => (typeof d.value === "number" ? acc + 1 : acc), 0);

  return {
    family: "preference",
    values: [
      stable.length,
      situational.length,
      meanConf(stable),
      meanConf(situational),
      magnitudeSum(stable),
      magnitudeSum(situational),
      numericCount(stable),
      numericCount(situational),
    ],
    names: [
      "preference.stableDimensionCount",
      "preference.situationalDimensionCount",
      "preference.stableMeanConfidence",
      "preference.situationalMeanConfidence",
      "preference.stableNumericMagnitudeSum",
      "preference.situationalNumericMagnitudeSum",
      "preference.stableNumericValueCount",
      "preference.situationalNumericValueCount",
    ],
  };
}

/**
 * CONTEXT features — typed enums and raw numeric signals from the
 * context snapshot (14 values). dayPart/device/audio/network/bandwidth/
 * attention-quality are ENUM CODES (typed enums only). Location
 * contributes ONLY the explicit permitted flag (ADR-003) — never the
 * location value.
 */
export function contextFeatures(snapshot: ContextSnapshot): FamilyResult {
  const attention = snapshot.attention;
  const fatigue = snapshot.fatigue;
  return {
    family: "context",
    values: [
      codeOf(DAY_PARTS, snapshot.time?.dayPart),
      codeOf(DEVICE_CLASSES, snapshot.device?.class),
      codeOf(AUDIO_ROUTES, snapshot.device?.audioRoute),
      codeOf(NETWORK_CLASSES, snapshot.network?.class),
      codeOf(BANDWIDTH_HINTS, snapshot.network?.bandwidthHint),
      snapshot.device?.screenAvailable === undefined ? -1 : snapshot.device.screenAvailable ? 1 : 0,
      codeOf(ATTENTION_QUALITIES, attention?.quality),
      attention !== undefined ? 1 : 0,
      attention?.availableMs ?? 0,
      fatigue?.repetitionLevel ?? -1,
      fatigue?.recentInterruptions ?? -1,
      snapshot.activity.length,
      snapshot.session?.positionInSession ?? -1,
      snapshot.location?.permitted === true ? 1 : 0,
    ],
    names: [
      "context.dayPartCode",
      "context.deviceClassCode",
      "context.audioRouteCode",
      "context.networkClassCode",
      "context.bandwidthCode",
      "context.screenAvailable",
      "context.attentionQualityCode",
      "context.hasAttentionEstimate",
      "context.attentionAvailableMs",
      "context.repetitionLevel",
      "context.recentInterruptions",
      "context.activityCount",
      "context.sessionPosition",
      "context.locationPermitted",
    ],
  };
}

/**
 * TEMPORAL features — recency/frequency over recent events, STRICTLY
 * filtered to `occurredAt <= at` (the no-future-leakage law). The
 * number of dropped future events is reported explicitly so leakage is
 * observable, never silent. 6 + 18 (per-event-type counts) values.
 */
export function temporalFeatures(
  recentEvents: readonly OutcomeEvent[] | undefined,
  at: number
): FamilyResult {
  const events = recentEvents ?? [];
  const past = events.filter((event) => event.occurredAt <= at);
  const droppedFutureCount = events.length - past.length;

  const ages = past.map((event) => at - event.occurredAt);
  // Age of the MOST RECENT event (smallest age); −1 when empty.
  const mostRecentAgeMs = ages.length === 0 ? -1 : Math.min(...ages);
  const meanAgeMs = ages.length === 0 ? -1 : ages.reduce((a, b) => a + b, 0) / ages.length;

  const observedSet = OBSERVED_EVIDENCE_CLASSES as readonly string[];
  const researchSet = RESEARCH_EVIDENCE_CLASSES as readonly string[];
  const observedClassCount = past.filter((event) => observedSet.includes(event.evidenceClass)).length;
  const researchClassCount = past.filter((event) => researchSet.includes(event.evidenceClass)).length;

  const typeCounts = OUTCOME_EVENT_TYPES.map(
    (type) => past.filter((event) => event.eventType === type).length
  );

  return {
    family: "temporal",
    values: [
      past.length,
      droppedFutureCount,
      mostRecentAgeMs,
      meanAgeMs,
      observedClassCount,
      researchClassCount,
      ...typeCounts,
    ],
    names: [
      "temporal.eventCount",
      "temporal.droppedFutureCount",
      "temporal.mostRecentAgeMs",
      "temporal.meanAgeMs",
      "temporal.observedClassCount",
      "temporal.researchClassCount",
      ...OUTCOME_EVENT_TYPES.map((type) => `temporal.eventTypeCount.${type}`),
    ],
  };
}

/**
 * UNCERTAINTY features — propagated from the preference snapshot's
 * confidence fields (6 values): dimension count, mean/min/max
 * confidence (−1 markers when empty), spread, low-confidence fraction
 * (confidence < 0.3).
 */
export function uncertaintyFeatures(preferences: PreferenceSnapshotInput | undefined): FamilyResult {
  const dims = [
    ...(preferences?.stable ?? []),
    ...(preferences?.situational ?? []),
  ];
  const confidences = dims.map((d) => d.confidence);
  const count = confidences.length;
  const mean = count === 0 ? 0 : confidences.reduce((a, b) => a + b, 0) / count;
  const min = count === 0 ? -1 : Math.min(...confidences);
  const max = count === 0 ? -1 : Math.max(...confidences);
  const spread = count === 0 ? 0 : max - min;
  const lowFraction = count === 0 ? 0 : confidences.filter((c) => c < 0.3).length / count;

  return {
    family: "uncertainty",
    values: [count, mean, min, max, spread, lowFraction],
    names: [
      "uncertainty.dimensionCount",
      "uncertainty.meanConfidence",
      "uncertainty.minConfidence",
      "uncertainty.maxConfidence",
      "uncertainty.confidenceSpread",
      "uncertainty.lowConfidenceFraction",
    ],
  };
}
