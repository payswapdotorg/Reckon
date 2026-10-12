import { z } from "zod/v4";
import {
  IdSchema,
  TimestampMsSchema,
  EvidenceClassSchema,
  EVIDENCE_CLASSES,
  type EvidenceClass,
  type Id,
  type TimestampMs,
} from "./primitives.js";
import { contentDigest } from "./serialization.js";

/**
 * SIM-001 — the Reckon-Complete conformance profile contracts (additive).
 *
 * Docs/simulations/reckon-complete-ladder.md defines Reckon-Complete as:
 *
 *   "A host is Reckon-Complete for a declared profile when it can exercise
 *    the required Reckon decision loop using only public contracts,
 *    generated schemas, API/SDK surfaces, and a declared capability
 *    manifest, with zero internal-package imports and no domain logic
 *    added to the Reckon kernel."
 *
 * This file freezes the `reckon.complete.*` discriminator family:
 *
 *   reckon.complete.profile-declaration        — host declares required capabilities
 *   reckon.complete.capability-manifest        — versioned, checksummed host declaration
 *   reckon.complete.conformance-verdict        — profile × manifest coverage envelope
 *   reckon.complete.integration-effort-record  — one measured harness run
 *   reckon.complete.integration-effort-scorecard — aggregated ladder-wave view
 *
 * FROZEN VOCABULARIES (literal unions — no free-form strings):
 * - capability names      (RECKON_COMPLETE_CAPABILITIES)
 * - evidence classes      (RECKON_COMPLETE_EVIDENCE_CLASSES — the frozen
 *   primitives.EVIDENCE_CLASSES, single source of truth)
 * - friction categories   (RECKON_COMPLETE_FRICTION_CATEGORIES — the exact
 *   ladder doc list, 11 members)
 *
 * Laws encoded structurally:
 * - Evidence honesty: `simulated`/`counterfactual` NEVER satisfy an
 *   observed-evidence requirement (evidenceClassSatisfies).
 * - Manifest integrity: every manifest carries a sha256 checksum over its
 *   own content; `finalizeReckonCompleteCapabilityManifest` computes it.
 * - Non-supported manifest entries MUST declare a friction category
 *   (discriminated union on `status`).
 */

// ---------------------------------------------------------------------------
// Frozen vocabularies
// ---------------------------------------------------------------------------

/**
 * The frozen capability vocabulary. A capability is a platform-level
 * ability a host profile may REQUIRE and a host manifest may SUPPORT —
 * derived from the ladder's target onboarding flow (register manifest →
 * connect sources → declare objectives/constraints/delivery → call the
 * standard API/SDK → receive decisions/experiences/plans/actions →
 * return outcomes → retrieve evidence → run conformance) and the public
 * API/SDK surface that exists today.
 */
export const RECKON_COMPLETE_CAPABILITIES = [
  "tenant-identity", // host-owned identity/tenant authority wiring (subject refs, API keys)
  "catalog-registration", // upsert host catalog items (POST /v1/catalog/items)
  "realization-declaration", // upsert delivery realizations (POST /v1/catalog/realizations)
  "candidate-retrieval", // submit retrieval candidate sets (POST /v1/candidates)
  "context-snapshots", // provide context snapshots referenced by decisions
  "objective-declaration", // declare objectives on decision requests
  "constraint-declaration", // declare hard constraints
  "attention-policy", // declare attention policies
  "decision-request", // the core decision loop (POST /v1/decisions)
  "decision-retrieval", // decision lookup + expansion (GET /v1/decisions/{id})
  "experience-resolution", // expand items/realizations into experiences (POST /v1/experiences/resolve)
  "plan-management", // experience plans: create/replan/history (POST /v1/plans, …)
  "schedule-execution", // execute scheduler actions host-side (queue/switch/interrupt/resume)
  "outcome-return", // append host-observed outcome events (POST /v1/outcomes)
  "preference-feedback", // append preference deltas (POST /v1/preferences/events)
  "evidence-retrieval", // retrieve decision/outcome linkage evidence
  "webhook-delivery", // register webhook endpoints / consume thin events (S2-002/S2-004)
  "ad-memory", // personal ad memory + ad query (AD-001/ADR-005)
  "agent-delegation", // agent bodies/organizations (ladder level 17)
  "conformance-verification", // run the conformance harness itself
] as const;
export const ReckonCompleteCapabilitySchema = z.enum(RECKON_COMPLETE_CAPABILITIES);
export type ReckonCompleteCapability = z.infer<typeof ReckonCompleteCapabilitySchema>;

/**
 * The frozen friction vocabulary — the EXACT list from the ladder doc's
 * measurement section (11 members, unchanged order):
 * CONTRACT_GAP, API_GAP, SDK_GAP, COMPOSITION_GAP, PERSISTENCE_GAP,
 * CAPABILITY_GAP, ADAPTER_GAP, OBSERVABILITY_GAP, UX_DX_GAP,
 * HOST_RESPONSIBILITY, RIGHTS_POLICY_BOUNDARY.
 */
export const RECKON_COMPLETE_FRICTION_CATEGORIES = [
  "CONTRACT_GAP",
  "API_GAP",
  "SDK_GAP",
  "COMPOSITION_GAP",
  "PERSISTENCE_GAP",
  "CAPABILITY_GAP",
  "ADAPTER_GAP",
  "OBSERVABILITY_GAP",
  "UX_DX_GAP",
  "HOST_RESPONSIBILITY",
  "RIGHTS_POLICY_BOUNDARY",
] as const;
export const ReckonCompleteFrictionSchema = z.enum(RECKON_COMPLETE_FRICTION_CATEGORIES);
export type ReckonCompleteFriction = z.infer<typeof ReckonCompleteFrictionSchema>;

/**
 * Evidence classes for this family are the frozen primitives vocabulary
 * (single source of truth — this alias exists so the family is
 * self-describing without a second enum).
 */
export const RECKON_COMPLETE_EVIDENCE_CLASSES = EVIDENCE_CLASSES;
export const ReckonCompleteEvidenceClassSchema = EvidenceClassSchema;

/** The frozen `reckon.complete.*` discriminator values. */
export const RECKON_COMPLETE_CONTRACT_IDS = [
  "reckon.complete.profile-declaration",
  "reckon.complete.capability-manifest",
  "reckon.complete.conformance-verdict",
  "reckon.complete.integration-effort-record",
  "reckon.complete.integration-effort-scorecard",
] as const;
export const ReckonCompleteContractIdSchema = z.enum(RECKON_COMPLETE_CONTRACT_IDS);
export type ReckonCompleteContractId = z.infer<typeof ReckonCompleteContractIdSchema>;

// ---------------------------------------------------------------------------
// Evidence-class sufficiency (frozen semantics)
// ---------------------------------------------------------------------------

/**
 * Strength ordering over the OBSERVED evidence classes. The research
 * classes (`simulated`, `counterfactual`) are deliberately absent: they
 * are a different axis and never satisfy an observed requirement
 * (architecture law: simulated/counterfactual outcomes never masquerade
 * as observed).
 */
export const OBSERVED_EVIDENCE_CLASS_STRENGTH: Readonly<Record<string, number>> = Object.freeze({
  fixture: 1,
  "controlled-local": 2,
  staging: 3,
  "production-observed": 4,
});

/**
 * Does `offered` evidence satisfy a profile `required` evidence class?
 * - observed requirements: satisfied by an observed class of equal or
 *   greater strength;
 * - research requirements (`simulated`/`counterfactual`): satisfied by
 *   the exact same class only — observed evidence is NOT a substitute
 *   for a counterfactual replay, and vice versa.
 */
export function evidenceClassSatisfies(offered: EvidenceClass, required: EvidenceClass): boolean {
  const offeredStrength = OBSERVED_EVIDENCE_CLASS_STRENGTH[offered];
  const requiredStrength = OBSERVED_EVIDENCE_CLASS_STRENGTH[required];
  if (offeredStrength !== undefined && requiredStrength !== undefined) {
    return offeredStrength >= requiredStrength;
  }
  return offered === required;
}

/** The weakest observed class among `classes` (research classes win — they taint the aggregate). */
export function weakestEvidenceClass(classes: readonly EvidenceClass[]): EvidenceClass | undefined {
  if (classes.length === 0) return undefined;
  let best: EvidenceClass | undefined = undefined;
  let bestStrength = Number.POSITIVE_INFINITY;
  for (const cls of classes) {
    const strength = OBSERVED_EVIDENCE_CLASS_STRENGTH[cls];
    if (strength === undefined) return cls; // research class taints the aggregate immediately
    if (strength < bestStrength) {
      bestStrength = strength;
      best = cls;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/** sha256 hex digest (64 lowercase hex chars). */
const Hex64Schema = z.string().regex(/^[0-9a-f]{64}$/, "must be a sha256 hex digest");

/** uint64 decimal seed string (SplitMix64 domain, as used by @reckon/simulation). */
export const HarnessSeedSchema = z
  .string()
  .regex(/^[0-9]{1,20}$/, "seed must be a uint64 decimal string");
export type HarnessSeed = z.infer<typeof HarnessSeedSchema>;

/** Public API operation id, e.g. "POST /v1/decisions". */
const ApiOperationIdSchema = z.string().min(1).max(128);

/** Public SDK method path, e.g. "decisions.request". */
const SdkMethodIdSchema = z.string().min(1).max(128);

// ---------------------------------------------------------------------------
// Profile declaration
// ---------------------------------------------------------------------------

/** One required capability: name + optional per-capability evidence floor. */
export const ReckonCompleteRequiredCapabilitySchema = z.object({
  capability: ReckonCompleteCapabilitySchema,
  /** Minimum evidence class this capability must be evidenced with. */
  minimumEvidenceClass: EvidenceClassSchema.optional(),
});
export type ReckonCompleteRequiredCapability = z.infer<typeof ReckonCompleteRequiredCapabilitySchema>;

/**
 * Reckon-Complete profile declaration — what a host archetype REQUIRES
 * to become Reckon-Complete. Declared per ladder level (or ad hoc).
 */
export const ReckonCompleteProfileDeclarationSchema = z.object({
  schema: z.literal("reckon.complete.profile-declaration").default("reckon.complete.profile-declaration"),
  schemaVersion: z.string().default("0.1.0"),
  profileId: IdSchema,
  name: z.string().min(1).max(128),
  description: z.string().max(2048).optional(),
  /** The ladder level this profile targets (1–20), when derived from the ladder. */
  ladderLevel: z.number().int().min(1).max(20).optional(),
  /** Required capabilities — at least one; duplicates are rejected by finalize helpers. */
  requiredCapabilities: z.array(ReckonCompleteRequiredCapabilitySchema).min(1),
  /** Profile-wide evidence floor applied when a capability omits its own. */
  requiredEvidenceClass: EvidenceClassSchema.optional(),
  /** Caller-supplied for deterministic replay (contract rule #4). */
  declaredAt: TimestampMsSchema,
});
export type ReckonCompleteProfileDeclaration = z.infer<typeof ReckonCompleteProfileDeclarationSchema>;
export type ReckonCompleteProfileDeclarationInput = z.input<typeof ReckonCompleteProfileDeclarationSchema>;

/** Parse + enforce profile invariants (unique capabilities). Throws on violation. */
export function finalizeReckonCompleteProfile(
  input: ReckonCompleteProfileDeclarationInput,
): ReckonCompleteProfileDeclaration {
  const parsed = ReckonCompleteProfileDeclarationSchema.parse(input);
  const seen = new Set<string>();
  for (const required of parsed.requiredCapabilities) {
    if (seen.has(required.capability)) {
      throw new Error(
        `ReckonCompleteProfileDeclaration: duplicate required capability "${required.capability}"`,
      );
    }
    seen.add(required.capability);
  }
  return parsed;
}

/** The effective required evidence class for a capability (per-capability overrides profile-wide). */
export function requiredEvidenceClassFor(
  profile: ReckonCompleteProfileDeclaration,
  capability: ReckonCompleteCapability,
): EvidenceClass | undefined {
  const entry = profile.requiredCapabilities.find((r) => r.capability === capability);
  return entry?.minimumEvidenceClass ?? profile.requiredEvidenceClass;
}

// ---------------------------------------------------------------------------
// Capability manifest
// ---------------------------------------------------------------------------

/** The frozen support-status vocabulary. */
export const RECKON_COMPLETE_SUPPORT_STATUSES = ["supported", "partial", "gap"] as const;
export const ReckonCompleteSupportStatusSchema = z.enum(RECKON_COMPLETE_SUPPORT_STATUSES);
export type ReckonCompleteSupportStatus = z.infer<typeof ReckonCompleteSupportStatusSchema>;

/** A fully supported capability — evidence class REQUIRED. */
export const ReckonCompleteSupportedCapabilitySchema = z.object({
  capability: ReckonCompleteCapabilitySchema,
  status: z.literal("supported"),
  /** Honest evidence class for the wiring being declared. */
  evidenceClass: EvidenceClassSchema,
  apiOperations: z.array(ApiOperationIdSchema).default([]),
  sdkMethods: z.array(SdkMethodIdSchema).default([]),
  notes: z.string().max(2048).optional(),
});
export type ReckonCompleteSupportedCapability = z.infer<typeof ReckonCompleteSupportedCapabilitySchema>;

/** A partially supported capability — friction category REQUIRED (law: honest partials). */
export const ReckonCompletePartialCapabilitySchema = z.object({
  capability: ReckonCompleteCapabilitySchema,
  status: z.literal("partial"),
  evidenceClass: EvidenceClassSchema,
  friction: ReckonCompleteFrictionSchema,
  apiOperations: z.array(ApiOperationIdSchema).default([]),
  sdkMethods: z.array(SdkMethodIdSchema).default([]),
  notes: z.string().max(2048).optional(),
});
export type ReckonCompletePartialCapability = z.infer<typeof ReckonCompletePartialCapabilitySchema>;

/** A declared gap — friction category REQUIRED; no evidence class (nothing is wired). */
export const ReckonCompleteGapCapabilitySchema = z.object({
  capability: ReckonCompleteCapabilitySchema,
  status: z.literal("gap"),
  friction: ReckonCompleteFrictionSchema,
  notes: z.string().max(2048).optional(),
});
export type ReckonCompleteGapCapability = z.infer<typeof ReckonCompleteGapCapabilitySchema>;

/**
 * One manifest entry — discriminated on `status`. Every non-supported
 * member structurally REQUIRES a friction category (machine-checkable
 * in the generated JSON schema, same pattern as AdRetention basis).
 */
export const ReckonCompleteCapabilitySupportSchema = z.discriminatedUnion("status", [
  ReckonCompleteSupportedCapabilitySchema,
  ReckonCompletePartialCapabilitySchema,
  ReckonCompleteGapCapabilitySchema,
]);
export type ReckonCompleteCapabilitySupport = z.infer<typeof ReckonCompleteCapabilitySupportSchema>;

/** Host system identity block (the hostAdapterId is the REPLAY identity). */
export const ReckonCompleteHostSystemSchema = z.object({
  hostId: IdSchema,
  name: z.string().min(1).max(128),
  hostAdapterId: IdSchema,
  version: z.string().min(1).max(64),
});
export type ReckonCompleteHostSystem = z.infer<typeof ReckonCompleteHostSystemSchema>;

/**
 * Capability manifest — the host's versioned, checksummed declaration of
 * what it supports. The checksum is sha256 over the canonical JSON of
 * the manifest content (everything except `manifestId` and `checksum`).
 */
export const ReckonCompleteCapabilityManifestSchema = z.object({
  schema: z.literal("reckon.complete.capability-manifest").default("reckon.complete.capability-manifest"),
  schemaVersion: z.string().default("0.1.0"),
  manifestId: IdSchema,
  manifestVersion: z.string().min(1).max(64).default("1"),
  hostSystem: ReckonCompleteHostSystemSchema,
  declaredAt: TimestampMsSchema,
  /** At least one declared capability; duplicates rejected by finalize. */
  supportedCapabilities: z.array(ReckonCompleteCapabilitySupportSchema).min(1),
  /** sha256 over the canonical content (excludes manifestId + checksum). */
  checksum: Hex64Schema,
});
export type ReckonCompleteCapabilityManifest = z.infer<typeof ReckonCompleteCapabilityManifestSchema>;

/** Manifest content — everything the checksum covers. */
export const ReckonCompleteCapabilityManifestContentSchema = ReckonCompleteCapabilityManifestSchema.omit({
  manifestId: true,
  checksum: true,
});
export type ReckonCompleteCapabilityManifestContent = z.infer<
  typeof ReckonCompleteCapabilityManifestContentSchema
>;
export type ReckonCompleteCapabilityManifestContentInput = z.input<
  typeof ReckonCompleteCapabilityManifestContentSchema
>;

/** Deterministic manifest checksum: sha256 over the canonical parsed content. */
export function reckonCompleteManifestChecksum(
  content: ReckonCompleteCapabilityManifestContentInput,
): string {
  const parsed = ReckonCompleteCapabilityManifestContentSchema.parse(content);
  return contentDigest(parsed);
}

/** Parse a manifest's content, enforce invariants, and seal it with its checksum. */
export function finalizeReckonCompleteCapabilityManifest(
  content: ReckonCompleteCapabilityManifestContentInput,
  manifestId: Id,
): ReckonCompleteCapabilityManifest {
  const parsedContent = ReckonCompleteCapabilityManifestContentSchema.parse(content);
  const seen = new Set<string>();
  for (const entry of parsedContent.supportedCapabilities) {
    if (seen.has(entry.capability)) {
      throw new Error(`CapabilityManifest: duplicate capability "${entry.capability}"`);
    }
    seen.add(entry.capability);
  }
  const checksum = contentDigest(parsedContent);
  return ReckonCompleteCapabilityManifestSchema.parse({
    ...parsedContent,
    manifestId,
    checksum,
  });
}

// ---------------------------------------------------------------------------
// Conformance verdict
// ---------------------------------------------------------------------------

/** Per-required-capability conformance state (frozen vocabulary). */
export const RECKON_COMPLETE_CONFORMANCE_STATES = [
  "satisfied",
  "partial",
  "missing",
] as const;
export const ReckonCompleteConformanceStateSchema = z.enum(RECKON_COMPLETE_CONFORMANCE_STATES);
export type ReckonCompleteConformanceState = z.infer<typeof ReckonCompleteConformanceStateSchema>;

/** One per-capability conformance row. */
export const ReckonCompleteCapabilityCoverageSchema = z.object({
  capability: ReckonCompleteCapabilitySchema,
  state: ReckonCompleteConformanceStateSchema,
  /** Manifest's declared evidence class (absent for undeclared capabilities). */
  evidenceClass: EvidenceClassSchema.optional(),
  evidenceSufficient: z.boolean(),
  /** Friction category for this gap (absent when satisfied). */
  friction: ReckonCompleteFrictionSchema.optional(),
  detail: z.string().max(2048).optional(),
});
export type ReckonCompleteCapabilityCoverage = z.infer<typeof ReckonCompleteCapabilityCoverageSchema>;

/** One recurring/observed gap entry. */
export const ReckonCompleteGapSchema = z.object({
  capability: ReckonCompleteCapabilitySchema,
  friction: ReckonCompleteFrictionSchema,
  detail: z.string().max(2048).optional(),
});
export type ReckonCompleteGap = z.infer<typeof ReckonCompleteGapSchema>;

/** The coverage summary block (shared by verdict and effort record). */
export const ReckonCompleteCoverageSummarySchema = z.object({
  required: z.number().int().min(0),
  satisfied: z.number().int().min(0),
  partial: z.number().int().min(0),
  missing: z.number().int().min(0),
  /** satisfied / required (0 when required is 0). */
  coverageRatio: z.number().min(0).max(1),
  perCapability: z.array(ReckonCompleteCapabilityCoverageSchema),
});
export type ReckonCompleteCoverageSummary = z.infer<typeof ReckonCompleteCoverageSummarySchema>;

/**
 * Conformance verdict — the machine-checkable envelope proving (or
 * refuting) that a manifest satisfies a profile.
 */
export const ReckonCompleteConformanceVerdictSchema = z.object({
  schema: z.literal("reckon.complete.conformance-verdict").default("reckon.complete.conformance-verdict"),
  schemaVersion: z.string().default("0.1.0"),
  verdictId: IdSchema,
  profileId: IdSchema,
  manifestId: IdSchema,
  manifestChecksum: Hex64Schema,
  reckonComplete: z.boolean(),
  coverage: ReckonCompleteCoverageSummarySchema,
  /** Aggregate evidence class achieved across satisfied capabilities (absent when none). */
  evidenceClass: EvidenceClassSchema.optional(),
  evidenceSufficient: z.boolean(),
  gaps: z.array(ReckonCompleteGapSchema).default([]),
  measuredAt: TimestampMsSchema,
});
export type ReckonCompleteConformanceVerdict = z.infer<typeof ReckonCompleteConformanceVerdictSchema>;
export type ReckonCompleteConformanceVerdictInput = z.input<typeof ReckonCompleteConformanceVerdictSchema>;

/**
 * The pure conformance assessment — coverage + gaps + evidence verdict
 * computed from a profile and a manifest (no ids, no clock). Frozen
 * categorization semantics:
 *
 * - required capability absent from the manifest → `missing`, CAPABILITY_GAP;
 * - manifest entry with status `gap`              → `missing`, the declared friction;
 * - manifest entry with status `partial`          → `partial`, the declared friction;
 * - supported but evidence below the required class → OBSERVABILITY_GAP
 *   (an evidence/proof limitation, never a silent pass);
 * - RIGHTS_POLICY_BOUNDARY / HOST_RESPONSIBILITY declared frictions are
 *   surfaced verbatim — the host owns rights/policy authority.
 */
export interface ReckonCompleteConformanceAssessment {
  readonly reckonComplete: boolean;
  readonly coverage: ReckonCompleteCoverageSummary;
  readonly evidenceClass: EvidenceClass | undefined;
  readonly evidenceSufficient: boolean;
  readonly gaps: readonly ReckonCompleteGap[];
}

export function evaluateReckonCompleteConformance(
  profile: ReckonCompleteProfileDeclaration,
  manifest: ReckonCompleteCapabilityManifest,
): ReckonCompleteConformanceAssessment {
  const byCapability = new Map<ReckonCompleteCapability, ReckonCompleteCapabilitySupport>();
  for (const entry of manifest.supportedCapabilities) {
    byCapability.set(entry.capability, entry);
  }

  const perCapability: ReckonCompleteCapabilityCoverage[] = [];
  const gaps: ReckonCompleteGap[] = [];
  const offeredClasses: EvidenceClass[] = [];
  let satisfied = 0;
  let partialCount = 0;
  let missing = 0;
  let evidenceAllSufficient = true;

  for (const required of profile.requiredCapabilities) {
    const capability = required.capability;
    const entry = byCapability.get(capability);
    const requiredClass = required.minimumEvidenceClass ?? profile.requiredEvidenceClass;

    if (entry === undefined) {
      missing += 1;
      perCapability.push({
        capability,
        state: "missing",
        evidenceSufficient: false,
        friction: "CAPABILITY_GAP",
        detail: "required capability not declared in the capability manifest",
      });
      gaps.push({
        capability,
        friction: "CAPABILITY_GAP",
        detail: "required capability not declared in the capability manifest",
      });
      evidenceAllSufficient = false;
      continue;
    }

    if (entry.status === "gap") {
      missing += 1;
      perCapability.push({
        capability,
        state: "missing",
        evidenceSufficient: false,
        friction: entry.friction,
        detail: entry.notes,
      });
      gaps.push({ capability, friction: entry.friction, detail: entry.notes });
      evidenceAllSufficient = false;
      continue;
    }

    // supported | partial
    const evidenceSufficient =
      requiredClass === undefined ? true : evidenceClassSatisfies(entry.evidenceClass, requiredClass);
    if (!evidenceSufficient) evidenceAllSufficient = false;
    offeredClasses.push(entry.evidenceClass);

    if (entry.status === "partial") {
      partialCount += 1;
      perCapability.push({
        capability,
        state: "partial",
        evidenceClass: entry.evidenceClass,
        evidenceSufficient,
        friction: entry.friction,
        detail: entry.notes,
      });
      gaps.push({ capability, friction: entry.friction, detail: entry.notes });
      continue;
    }

    // supported — evidence check applies
    perCapability.push({
      capability,
      state: "satisfied",
      evidenceClass: entry.evidenceClass,
      evidenceSufficient,
      ...(evidenceSufficient
        ? {}
        : {
            friction: "OBSERVABILITY_GAP" as ReckonCompleteFriction,
            detail: `offered evidence class "${entry.evidenceClass}" does not satisfy required "${requiredClass}"`,
          }),
    });
    if (evidenceSufficient) {
      satisfied += 1;
    } else {
      gaps.push({
        capability,
        friction: "OBSERVABILITY_GAP",
        detail: `offered evidence class "${entry.evidenceClass}" does not satisfy required "${requiredClass}"`,
      });
    }
  }

  const required = profile.requiredCapabilities.length;
  const evidenceClass = weakestEvidenceClass(offeredClasses);
  const evidenceSufficient = offeredClasses.length === required && evidenceAllSufficient;
  const reckonComplete = satisfied === required && required > 0 && evidenceSufficient;

  return {
    reckonComplete,
    coverage: {
      required,
      satisfied,
      partial: partialCount,
      missing,
      coverageRatio: required === 0 ? 0 : satisfied / required,
      perCapability,
    },
    evidenceClass,
    evidenceSufficient,
    gaps,
  };
}

/** Assemble the full verdict envelope from a profile + manifest (id + measuredAt caller-supplied). */
export function finalizeReckonCompleteConformanceVerdict(input: {
  verdictId: Id;
  measuredAt: TimestampMs;
  profile: ReckonCompleteProfileDeclaration;
  manifest: ReckonCompleteCapabilityManifest;
}): ReckonCompleteConformanceVerdict {
  const assessment = evaluateReckonCompleteConformance(input.profile, input.manifest);
  return ReckonCompleteConformanceVerdictSchema.parse({
    schema: "reckon.complete.conformance-verdict",
    schemaVersion: "0.1.0",
    verdictId: input.verdictId,
    profileId: input.profile.profileId,
    manifestId: input.manifest.manifestId,
    manifestChecksum: input.manifest.checksum,
    reckonComplete: assessment.reckonComplete,
    coverage: assessment.coverage,
    ...(assessment.evidenceClass !== undefined ? { evidenceClass: assessment.evidenceClass } : {}),
    evidenceSufficient: assessment.evidenceSufficient,
    gaps: assessment.gaps,
    measuredAt: input.measuredAt,
  });
}

// ---------------------------------------------------------------------------
// Integration effort record
// ---------------------------------------------------------------------------

/** Host-side glue measurement (honest, host-declared). */
export const HostGlueMeasurementSchema = z.object({
  functions: z.number().int().min(0),
  loc: z.number().int().min(0),
  customAdapterLoc: z.number().int().min(0),
});
export type HostGlueMeasurement = z.infer<typeof HostGlueMeasurementSchema>;

/**
 * Time/steps to first decision and to full-loop completion (virtual
 * clock). `0` means "not achieved within the run" — an honest sentinel,
 * never a silent pass.
 */
export const IntegrationTimingSchema = z.object({
  firstDecisionMs: z.number().int().min(0),
  firstDecisionSteps: z.number().int().min(0),
  fullLoopMs: z.number().int().min(0),
  fullLoopSteps: z.number().int().min(0),
});
export type IntegrationTiming = z.infer<typeof IntegrationTimingSchema>;

/** Latency percentiles over successful operation calls (virtual clock). */
export const IntegrationLatencySchema = z.object({
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  samples: z.number().int().min(0),
});
export type IntegrationLatency = z.infer<typeof IntegrationLatencySchema>;

/** Failure/retry behavior summary. */
export const IntegrationFailuresSchema = z.object({
  /** Operation calls that failed at least one attempt. */
  count: z.number().int().min(0),
  /** Calls that failed at least one attempt but eventually succeeded. */
  retriedCount: z.number().int().min(0),
  /** Total failed attempts (across all calls). */
  retryCount: z.number().int().min(0),
  /** Calls whose retry budget was exhausted (never succeeded). */
  exhaustedCount: z.number().int().min(0),
});
export type IntegrationFailures = z.infer<typeof IntegrationFailuresSchema>;

/**
 * Replay inputs — everything required to REPLAY a run deterministically:
 * seed + manifest (checksum) + host adapter id, plus the exact run
 * parameters the harness consumed (steps, fault schedule, clock).
 */
export const SimulationReplayInputsSchema = z.object({
  seed: HarnessSeedSchema,
  manifestChecksum: Hex64Schema,
  hostAdapterId: IdSchema,
  harnessVersion: z.string().min(1).max(64),
  steps: z.number().int().min(1),
  faultRate: z.number().min(0).max(1),
  maxRetries: z.number().int().min(0),
  clockStartMs: z.number().int().min(0),
  clockStepMs: z.number().int().min(1),
});
export type SimulationReplayInputs = z.infer<typeof SimulationReplayInputsSchema>;

/**
 * IntegrationEffortRecord — ONE measured harness run of a synthetic
 * host against Reckon's public surface. Every field the ladder's
 * measurement section lists is present:
 * API ops + SDK methods, glue LOC, internal imports (must be 0),
 * time/steps to first decision + full loop, p50/p95 latency,
 * failure/retry behavior, capability coverage, evidence class,
 * per-gap friction category, and the replay gate.
 */
export const IntegrationEffortRecordSchema = z.object({
  schema: z
    .literal("reckon.complete.integration-effort-record")
    .default("reckon.complete.integration-effort-record"),
  schemaVersion: z.string().default("0.1.0"),
  recordId: IdSchema,
  runId: IdSchema,
  harnessVersion: z.string().min(1).max(64),
  seed: HarnessSeedSchema,
  hostAdapterId: IdSchema,
  hostSystem: ReckonCompleteHostSystemSchema,
  profileId: IdSchema,
  ladderLevel: z.number().int().min(1).max(20).optional(),
  manifestId: IdSchema,
  manifestChecksum: Hex64Schema,
  /** Honest evidence class OF THE RUN itself (scripted responder ⇒ fixture). */
  evidenceClass: EvidenceClassSchema,
  /** Sorted unique public API operations the run exercised. */
  apiOperations: z.array(ApiOperationIdSchema).default([]),
  /** Sorted unique SDK methods the run exercised. */
  sdkMethods: z.array(SdkMethodIdSchema).default([]),
  glue: HostGlueMeasurementSchema,
  /** Deep/internal package imports observed in the host path (MUST be 0). */
  internalImports: z.number().int().min(0),
  timing: IntegrationTimingSchema,
  latency: IntegrationLatencySchema,
  failures: IntegrationFailuresSchema,
  capabilityCoverage: ReckonCompleteCoverageSummarySchema,
  gaps: z.array(ReckonCompleteGapSchema).default([]),
  replayInputs: SimulationReplayInputsSchema,
  /** sha256 over the canonical content (excludes recordId + checksum). */
  checksum: Hex64Schema,
  completedAt: TimestampMsSchema,
});
export type IntegrationEffortRecord = z.infer<typeof IntegrationEffortRecordSchema>;

/** Effort-record content — everything the checksum covers. */
export const IntegrationEffortRecordContentSchema = IntegrationEffortRecordSchema.omit({
  recordId: true,
  checksum: true,
});
export type IntegrationEffortRecordContent = z.infer<typeof IntegrationEffortRecordContentSchema>;
export type IntegrationEffortRecordContentInput = z.input<typeof IntegrationEffortRecordContentSchema>;

/** Deterministic effort-record checksum: sha256 over the canonical parsed content. */
export function integrationEffortRecordChecksum(
  content: IntegrationEffortRecordContentInput,
): string {
  const parsed = IntegrationEffortRecordContentSchema.parse(content);
  return contentDigest(parsed);
}

/** Parse a record's content and seal it with its checksum. */
export function finalizeIntegrationEffortRecord(
  content: IntegrationEffortRecordContentInput,
  recordId: Id,
): IntegrationEffortRecord {
  const parsedContent = IntegrationEffortRecordContentSchema.parse(content);
  const checksum = contentDigest(parsedContent);
  return IntegrationEffortRecordSchema.parse({
    ...parsedContent,
    recordId,
    checksum,
  });
}

// ---------------------------------------------------------------------------
// Integration effort scorecard (ladder-wave aggregate)
// ---------------------------------------------------------------------------

/** Reference to one contributing record. */
export const ScorecardRecordRefSchema = z.object({
  recordId: IdSchema,
  runId: IdSchema,
  hostAdapterId: IdSchema,
  ladderLevel: z.number().int().min(1).max(20).optional(),
  recordChecksum: Hex64Schema,
});
export type ScorecardRecordRef = z.infer<typeof ScorecardRecordRefSchema>;

/** Aggregate statistics across runs (medians/p95s computed deterministically). */
export const ScorecardAggregateSchema = z.object({
  runCount: z.number().int().min(1),
  distinctHosts: z.number().int().min(1),
  distinctLevels: z.number().int().min(0),
  medianGlueLoc: z.number().nonnegative(),
  p95GlueLoc: z.number().nonnegative(),
  medianFirstDecisionMs: z.number().nonnegative(),
  p95FirstDecisionMs: z.number().nonnegative(),
  medianFullLoopMs: z.number().nonnegative(),
  p95FullLoopMs: z.number().nonnegative(),
  medianLatencyP50Ms: z.number().nonnegative(),
  p95LatencyP95Ms: z.number().nonnegative(),
  meanCapabilityCoverageRatio: z.number().min(0).max(1),
  totalFailures: z.number().int().min(0),
  totalRetries: z.number().int().min(0),
});
export type ScorecardAggregate = z.infer<typeof ScorecardAggregateSchema>;

/**
 * A recurring gap across domains. The 3-domain law (ladder doc):
 * "When the same gap appears in at least three domains, upgrade the
 * common platform primitive and replay earlier levels."
 */
export const ScorecardRecurringGapSchema = z.object({
  capability: ReckonCompleteCapabilitySchema,
  friction: ReckonCompleteFrictionSchema,
  /** Distinct ladder levels (domains) where this exact gap appeared. */
  ladderLevels: z.array(z.number().int().min(1).max(20)),
  domainCount: z.number().int().min(1),
  runCount: z.number().int().min(1),
  /** True iff domainCount ≥ 3 — the platform-upgrade trigger. */
  platformUpgradeCandidate: z.boolean(),
});
export type ScorecardRecurringGap = z.infer<typeof ScorecardRecurringGapSchema>;

/**
 * IntegrationEffortScorecard — the machine-readable aggregate the ladder
 * waves produce (SIM-007) and TL3 reconciles (SIM-008).
 */
export const IntegrationEffortScorecardSchema = z.object({
  schema: z
    .literal("reckon.complete.integration-effort-scorecard")
    .default("reckon.complete.integration-effort-scorecard"),
  schemaVersion: z.string().default("0.1.0"),
  scorecardId: IdSchema,
  generatedAt: TimestampMsSchema,
  aggregate: ScorecardAggregateSchema,
  recurringGaps: z.array(ScorecardRecurringGapSchema).default([]),
  records: z.array(ScorecardRecordRefSchema).min(1),
  /** sha256 over the canonical content (excludes scorecardId + checksum). */
  checksum: Hex64Schema,
});
export type IntegrationEffortScorecard = z.infer<typeof IntegrationEffortScorecardSchema>;

/** Scorecard content — everything the checksum covers. */
export const IntegrationEffortScorecardContentSchema = IntegrationEffortScorecardSchema.omit({
  scorecardId: true,
  checksum: true,
});
export type IntegrationEffortScorecardContent = z.infer<typeof IntegrationEffortScorecardContentSchema>;
export type IntegrationEffortScorecardContentInput = z.input<
  typeof IntegrationEffortScorecardContentSchema
>;

/** Deterministic scorecard checksum: sha256 over the canonical parsed content. */
export function integrationEffortScorecardChecksum(
  content: IntegrationEffortScorecardContentInput,
): string {
  const parsed = IntegrationEffortScorecardContentSchema.parse(content);
  return contentDigest(parsed);
}

/** Parse a scorecard's content and seal it with its checksum. */
export function finalizeIntegrationEffortScorecard(
  content: IntegrationEffortScorecardContentInput,
  scorecardId: Id,
): IntegrationEffortScorecard {
  const parsedContent = IntegrationEffortScorecardContentSchema.parse(content);
  const checksum = contentDigest(parsedContent);
  return IntegrationEffortScorecardSchema.parse({
    ...parsedContent,
    scorecardId,
    checksum,
  });
}

// ---------------------------------------------------------------------------
// The `reckon.complete.*` discriminator family (exhaustive union)
// ---------------------------------------------------------------------------

/**
 * The frozen family union. Parsing a record that carries its `schema`
 * discriminator selects the member; every member's discriminator value
 * is registered in RECKON_COMPLETE_CONTRACT_IDS.
 */
export const ReckonCompleteEnvelopeSchema = z.discriminatedUnion("schema", [
  ReckonCompleteProfileDeclarationSchema,
  ReckonCompleteCapabilityManifestSchema,
  ReckonCompleteConformanceVerdictSchema,
  IntegrationEffortRecordSchema,
  IntegrationEffortScorecardSchema,
]);
export type ReckonCompleteEnvelope = z.infer<typeof ReckonCompleteEnvelopeSchema>;
