/**
 * FeatureAssembler PORT (W1-004).
 *
 * Feature assembly turns normalized Reckon state (context snapshot,
 * catalog items, realizations, experiences, preference snapshot,
 * recent outcome events) into DETERMINISTIC numeric feature families
 * for downstream ranking/research runtimes.
 *
 * Laws implemented by every conforming assembler:
 * - NO-FUTURE-LEAKAGE: temporal features read ONLY events with
 *   `occurredAt <= at`; a future-timestamped event can never influence
 *   any family.
 * - DETERMINISM: identical inputs ⇒ identical `families`, `names` and
 *   `digest` (contentDigest over the canonical form).
 * - PROVIDER-NEUTRALITY: host vocabulary (labels, realization kinds,
 *   locales, preference dimensions) enters ONLY through stable hashed
 *   buckets — never as raw strings in names or values.
 * - PRICACY (ADR-003): location contributes ONLY a permitted-flag —
 *   never the location value itself.
 */
import type { TenantScope, TimestampMs } from "@reckon/contracts";
import type {
  CatalogItem,
  ContextSnapshot,
  Experience,
  OutcomeEvent,
  Realization,
  SubjectReference,
} from "@reckon/contracts";

/**
 * Structural preference-snapshot contract.
 *
 * Deliberately STRUCTURAL (field-compatible with the snapshot returned
 * by `@reckon/preferences`): @reckon/features does NOT declare a
 * workspace dependency on @reckon/preferences so the W1 wave adds no
 * lockfile entries; a later composition root (TL3-owned) wires the
 * stores together. Every object returned by
 * `InMemoryPreferenceStoreAdapter.snapshot(...)` satisfies this type.
 */
export interface PreferenceDimensionInput {
  readonly dimension: string;
  readonly value: number | string | boolean | null;
  readonly confidence: number;
}

export interface SituationalPreferenceDimensionInput extends PreferenceDimensionInput {
  readonly contextScope?: {
    readonly contextKind?: string;
    readonly contextId?: string;
  };
}

export interface PreferenceSnapshotInput {
  readonly stable: readonly PreferenceDimensionInput[];
  readonly situational: readonly SituationalPreferenceDimensionInput[];
  readonly at?: TimestampMs | null;
}

/** Assembler input (all record shapes validated at assembly time). */
export interface FeatureInput {
  readonly subject: SubjectReference;
  readonly tenant: TenantScope;
  /** Assembly time — the no-future-leakage cutoff. */
  readonly at: TimestampMs;
  readonly contextSnapshot: ContextSnapshot;
  readonly items: readonly CatalogItem[];
  readonly realizations?: readonly Realization[];
  readonly experiences?: readonly Experience[];
  /** Structural preference snapshot (see PreferenceSnapshotInput). */
  readonly preferences?: PreferenceSnapshotInput;
  /** Events STRICTLY filtered to occurredAt <= at. */
  readonly recentEvents?: readonly OutcomeEvent[];
}

/** The fixed family order of every FeatureVector. */
export const FEATURE_FAMILIES = [
  "item",
  "realization",
  "experience",
  "preference",
  "context",
  "temporal",
  "uncertainty",
] as const;

export type FeatureFamilyName = (typeof FEATURE_FAMILIES)[number];

/**
 * Assembled feature vector. For every family `f`:
 * `families[f][k]` is the value of feature `names[f][k]`
 * (`families[f].length === names[f].length`).
 * `digest` = contentDigest over { subject, tenant, at, families, names }.
 */
export interface FeatureVector {
  readonly subject: SubjectReference;
  readonly tenant: TenantScope;
  readonly at: TimestampMs;
  readonly families: Readonly<Record<FeatureFamilyName, readonly number[]>>;
  readonly names: Readonly<Record<FeatureFamilyName, readonly string[]>>;
  readonly digest: string;
}

/** FeatureAssembler PORT — pure, stateless, deterministic. */
export interface FeatureAssembler {
  /**
   * Assemble the feature vector. Throws typed errors
   * (FeatureValidationError / FeaturePreferenceSnapshotError) for
   * invalid input records — never raw strings.
   */
  assemble(input: FeatureInput): FeatureVector;
}
