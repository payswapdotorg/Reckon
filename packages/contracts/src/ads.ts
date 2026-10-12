import { z } from "zod/v4";
import {
  IdSchema,
  type Id,
  type TimestampMs,
  RefSchema,
  TimestampMsSchema,
  TenantScopeSchema,
  ProvenanceSchema,
  MetricPayloadSchema,
} from "./primitives.js";
import {
  CatalogItemSchema,
  RealizationSchema,
  SubjectReferenceSchema,
  ContextReferenceSchema,
  CandidateSetSchema,
} from "./domain.js";
import { OBSERVED_EVIDENCE_CLASSES } from "./outcomes.js";
import { contentDigest } from "./serialization.js";
import type { CandidateReference, CandidateSet } from "./domain.js";
import type { HardConstraint } from "./policy.js";

/**
 * AD-001 — Personal Ad Memory + Ad Query contracts (frozen, additive).
 *
 * Extends the frozen normalized contracts with the advertising memory
 * lane defined by docs/handoff/TL6-FINAL-HANDOFF.md ("Personal Ad
 * Memory / Ad Query product" + "Ad-memory privacy and policy laws"):
 *
 *   Ad → Ad Memory → Retrieval Query → Candidate Resolution →
 *   Decision → Experience → Schedule → Outcome
 *
 * Composition rule: ad candidates map into the EXISTING
 * CandidateSet → DecisionRequest → Experience path (see
 * `adCandidatesToCandidateSet`). There is NO parallel ad-ranking
 * contract in this file — the Reckon decision kernel remains the
 * single ranking authority (AD-004; no second recommendation
 * authority, architecture-lock §"no second model router").
 *
 * Ad-memory privacy laws and their structural enforcement here:
 *
 * - Law 1 (retention requires an explicit basis): `AdRetentionSchema`
 *   is a discriminated union on `state` whose EVERY member carries a
 *   REQUIRED `basis` (`AdRetentionBasisSchema`) — a retention record
 *   without a basis cannot be parsed.
 * - Law 2 (forget means unretrievable): `forgotten` is a terminal
 *   retention state that requires `forgottenAt`; remembered candidates
 *   only embed records in state `active`
 *   (`RetrievableAdMemoryRecordSchema`); `isAdMemoryRetrievable()`
 *   returns false for forgotten records. No transition out of
 *   `forgotten` is defined by these contracts.
 * - Law 3 (expired ≠ currently available): retention expiry suppresses
 *   retrieval (`isAdMemoryRetrievable`) and ad availability windows are
 *   evaluated deterministically (`isAdAvailableAt`,
 *   `isAdCandidateCurrentlyAvailable`) against the caller-supplied
 *   query clock `at`.
 * - Law 4 (encounter is not a license): `AdRightsConstraintsSchema`
 *   defaults `redistributionPermitted` to FALSE; rights are never
 *   inferred from availability (architecture-lock #23).
 * - Law 5 (no silent raw targeting payload): `AdEncounterEvidenceSchema`
 *   references context BY ID only (`ContextReferenceSchema`) — raw
 *   location, attention or sensor values have no field to hide in,
 *   and unknown keys are stripped on parse.
 * - Law 6 (no inferred sensitive attributes): `AdMemoryRecordSchema`
 *   has no inference/audience-attribute field; derived learning state
 *   belongs to `PreferenceDelta` (existing primitive, own provenance
 *   and confidence discipline).
 * - Law 7 (user value vs commercial value): ad candidates carry
 *   `userValue` and `commercialValue` as SEPARATE optional fields with
 *   distinct schemas; no blended ad "value" exists. Commercial value
 *   is a declared input, never a ranking authority (AD-004: an ad is
 *   not shown merely because it has high commercial value).
 * - Law 8 (advertising stays identifiable): every ad candidate carries
 *   `advertising: true` as a literal, and `AdCatalogItemSchema`
 *   narrows `CatalogItem.kind` to `"advertising"` — an ad cannot
 *   masquerade as an ordinary catalog item.
 * - Law 9 (unconfusable provenance): `AdProvenanceSchema` is a
 *   discriminated union (`observed-encounter` | `provider-supplied`);
 *   `AdQueryResult` keeps remembered and available candidates in
 *   SEPARATE arrays that are never merged.
 * - Law 10 (same evidence classes as the rest of Reckon): encounter
 *   evidence accepts only the observed evidence classes
 *   (`OBSERVED_EVIDENCE_CLASSES` from outcomes.ts) —
 *   simulated/counterfactual/fixture encounters are parse errors
 *   (architecture-lock #20).
 *
 * All changes in this file are additive (AD-001 / ADR-005): no
 * existing exported shape changes. New contracts are versioned under
 * the `reckon.ad-*` family.
 */

// ---------------------------------------------------------------------------
// §1 Ad identity lineage
// ---------------------------------------------------------------------------

/**
 * Host-owned ad identity lineage (AD-002: source/advertiser/campaign/
 * creative lineage). Reckon stores these as opaque references — the
 * host ad system remains the identity authority; Reckon never resolves
 * advertiser identity and never enriches it.
 */
export const AdLineageSchema = z.object({
  /** Host ad source system id (opaque; provider vocabulary stays host-side). */
  source: z.string().min(1).max(64),
  /** Host-owned advertiser reference, if known. */
  advertiserRef: RefSchema.optional(),
  /** Host-owned campaign reference, if known. */
  campaignRef: RefSchema.optional(),
  /** Host-owned creative/lineage references, outermost → innermost. */
  creativeRefs: z.array(RefSchema).default([]),
});
export type AdLineage = z.infer<typeof AdLineageSchema>;

// ---------------------------------------------------------------------------
// §2 Ad catalog item (law 8)
// ---------------------------------------------------------------------------

/**
 * A catalog item that IS an advertisement. Narrows the existing
 * `CatalogItem` `kind` to `"advertising"` so an ad can never enter the
 * ad-memory lane disguised as an ordinary item (law 8).
 */
export const AdCatalogItemSchema = CatalogItemSchema.extend({
  kind: z.literal("advertising"),
});
export type AdCatalogItem = z.infer<typeof AdCatalogItemSchema>;

// ---------------------------------------------------------------------------
// §3 Observed encounter evidence (laws 5, 10)
// ---------------------------------------------------------------------------

/**
 * Evidence that the subject actually encountered the ad. Encounter
 * evidence is an OBSERVATION channel: only observed evidence classes
 * are accepted (law 10, architecture-lock #20) — simulated,
 * counterfactual and fixture encounters are parse errors.
 *
 * Law 5: context is referenced BY ID only. Raw location, attention or
 * sensor values have no field here; unknown keys are stripped on
 * parse, so a raw targeting payload cannot persist through this
 * contract.
 *
 * The referenced `outcomeEventId` must be an observed-class
 * `OutcomeEvent` (typically an `impression`) — encounters flow through
 * the same evidence pipeline as the rest of Reckon.
 */
export const AdEncounterEvidenceSchema = z.object({
  /** Observed OutcomeEvent (e.g. impression) that recorded the encounter. */
  outcomeEventId: IdSchema,
  /** Observed classes ONLY — the same enum family as OutcomeEvent. */
  evidenceClass: z.enum(OBSERVED_EVIDENCE_CLASSES),
  /** When the encounter was observed (caller-supplied, contract rule #4). */
  encounteredAt: TimestampMsSchema,
  /** Context by reference — never embedded raw (law 5). */
  context: ContextReferenceSchema.optional(),
  /** Host surface vocabulary where the encounter happened (opaque). */
  surface: z.string().min(1).max(64).optional(),
});
export type AdEncounterEvidence = z.infer<typeof AdEncounterEvidenceSchema>;

// ---------------------------------------------------------------------------
// §4 Provenance: observed encounter vs provider-supplied (law 9)
// ---------------------------------------------------------------------------

/**
 * Provider/host-declared availability of an ad RIGHT NOW. This is a
 * declaration, not an observation: it says the host ad channel is
 * willing to serve the ad, nothing more. Rights are never inferred
 * from it (law 4, architecture-lock #23).
 */
export const AdAvailabilitySchema = z.object({
  /** Host ad system / provider channel that declares availability. */
  suppliedBy: z.string().min(1).max(64),
  availableFrom: TimestampMsSchema.optional(),
  availableUntil: TimestampMsSchema.optional(),
  /** Channel provenance (which host system produced this declaration). */
  channelProvenance: ProvenanceSchema.optional(),
});
export type AdAvailability = z.infer<typeof AdAvailabilitySchema>;

/**
 * Ad provenance — an UNCONFUSABLE discriminated union (law 9):
 *
 * - `observed-encounter` requires `AdEncounterEvidence` (observed
 *   evidence classes only) — it can only be constructed from a real
 *   observation of the subject encountering the ad;
 * - `provider-supplied` carries `AdAvailability` instead — a
 *   declaration by a host/provider channel, never an observation.
 *
 * The two kinds share no fields, so a remembered encounter can never
 * be misrepresented as provider availability or the reverse.
 */
export const AdProvenanceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("observed-encounter"),
    evidence: AdEncounterEvidenceSchema,
  }),
  z.object({
    kind: z.literal("provider-supplied"),
    availability: AdAvailabilitySchema,
  }),
]);
export type AdProvenance = z.infer<typeof AdProvenanceSchema>;

// ---------------------------------------------------------------------------
// §5 Retention: basis, expiry, forget (laws 1, 2, 3)
// ---------------------------------------------------------------------------

/** Retention/permission bases appropriate to the host product (law 1). */
export const AD_RETENTION_BASES = [
  "explicit-user-consent",
  "host-retention-policy",
  "host-contractual-term",
  "legal-obligation",
] as const;

/**
 * The explicit basis under which an ad may be retained in Personal Ad
 * Memory. Required in EVERY retention state (law 1): public
 * observability of an ad is never a retention basis.
 */
export const AdRetentionBasisSchema = z.object({
  kind: z.enum(AD_RETENTION_BASES),
  /** When the basis was established (caller-supplied epoch ms). */
  establishedAt: TimestampMsSchema,
  /** Host reference to the consent/policy/contract record. */
  basisRef: RefSchema.optional(),
  /** What was agreed, for explainability to the user. */
  description: z.string().min(1).max(512).optional(),
});
export type AdRetentionBasis = z.infer<typeof AdRetentionBasisSchema>;

/** Retention state: `active`, lapsed (`expired`) or user-removed (`forgotten`). */
export const ActiveAdRetentionSchema = z.object({
  state: z.literal("active"),
  /** REQUIRED basis — parse fails without it (law 1). */
  basis: AdRetentionBasisSchema,
  /** When the memory write happened. */
  retainedAt: TimestampMsSchema.optional(),
  /** Retention expiry: after this instant the record is suppressed (law 3). */
  expiresAt: TimestampMsSchema.optional(),
});
export type ActiveAdRetention = z.infer<typeof ActiveAdRetentionSchema>;

/** Lapsed retention: the basis's `expiresAt` has passed. Not retrievable. */
export const ExpiredAdRetentionSchema = z.object({
  state: z.literal("expired"),
  basis: AdRetentionBasisSchema,
  retainedAt: TimestampMsSchema.optional(),
  /** REQUIRED for expiry — a record cannot lapse without an expiry. */
  expiresAt: TimestampMsSchema,
  expiredAt: TimestampMsSchema.optional(),
});
export type ExpiredAdRetention = z.infer<typeof ExpiredAdRetentionSchema>;

/**
 * Forgotten retention — TERMINAL (law 2). Requires `forgottenAt` for
 * the audit trail. No transition out of `forgotten` is defined by
 * these contracts; a forgotten ad can never be returned from Personal
 * Ad Memory again.
 */
export const ForgottenAdRetentionSchema = z.object({
  state: z.literal("forgotten"),
  basis: AdRetentionBasisSchema,
  retainedAt: TimestampMsSchema.optional(),
  expiresAt: TimestampMsSchema.optional(),
  /** REQUIRED: when the forget took effect. */
  forgottenAt: TimestampMsSchema,
  forgetReason: z.string().min(1).max(256).optional(),
});
export type ForgottenAdRetention = z.infer<typeof ForgottenAdRetentionSchema>;

/** Retention record — every member requires an explicit basis (law 1). */
export const AdRetentionSchema = z.discriminatedUnion("state", [
  ActiveAdRetentionSchema,
  ExpiredAdRetentionSchema,
  ForgottenAdRetentionSchema,
]);
export type AdRetention = z.infer<typeof AdRetentionSchema>;

// ---------------------------------------------------------------------------
// §6 Permission / consent state with append-only transitions
// ---------------------------------------------------------------------------

export const AD_PERMISSION_CAPABILITIES = ["retain", "present"] as const;
export const AD_PERMISSION_STATES = ["granted", "revoked"] as const;

/**
 * A permission transition. History is append-only (contract rule #8
 * spirit): corrections never overwrite earlier transitions.
 */
export const AdPermissionTransitionSchema = z.object({
  capability: z.enum(AD_PERMISSION_CAPABILITIES),
  from: z.enum(AD_PERMISSION_STATES),
  to: z.enum(AD_PERMISSION_STATES),
  at: TimestampMsSchema,
  /** Host reference to the consent record/authority behind the transition. */
  consentRef: RefSchema.optional(),
  reason: z.string().min(1).max(256).optional(),
});
export type AdPermissionTransition = z.infer<typeof AdPermissionTransitionSchema>;

/**
 * Per-record permission state. Two capabilities:
 * - `retain` — may Personal Ad Memory hold this ad at all;
 * - `present` — may the agent present/re-show this ad to the user.
 *
 * Revoking `retain` requires the store to forget the record (ADR-003:
 * revocation stops future use); revoking `present` keeps the memory
 * but removes the ad from presentation candidates.
 */
export const AdPermissionStateSchema = z.object({
  retain: z.enum(AD_PERMISSION_STATES),
  present: z.enum(AD_PERMISSION_STATES),
  history: z.array(AdPermissionTransitionSchema).default([]),
});
export type AdPermissionState = z.infer<typeof AdPermissionStateSchema>;

/**
 * Apply a permission transition to a state (pure; AD-002 reuse).
 * Throws when `transition.from` does not match the current state —
 * callers cannot rewrite history. The transition is appended, never
 * merged, keeping the audit trail append-only.
 */
export function applyAdPermissionTransition(
  state: AdPermissionState,
  transition: AdPermissionTransition,
): AdPermissionState {
  if (transition.from !== state[transition.capability]) {
    throw new Error(
      `ad permission transition mismatch: capability '${transition.capability}' is '${state[transition.capability]}' but transition claims '${transition.from}'`,
    );
  }
  return {
    retain: transition.capability === "retain" ? transition.to : state.retain,
    present: transition.capability === "present" ? transition.to : state.present,
    history: [...state.history, transition],
  };
}

// ---------------------------------------------------------------------------
// §7 Rights constraints (law 4, architecture-lock #23)
// ---------------------------------------------------------------------------

/**
 * Ad-specific rights constraints. Encountering an ad is NOT a license
 * to redistribute it (law 4): `redistributionPermitted` DEFAULTS TO
 * FALSE and must never be inferred from availability, account
 * connections or catalog presence (architecture-lock #23). All
 * verification remains with host rights gates.
 */
export const AdRightsConstraintsSchema = z.object({
  /** DEFAULT FALSE — an encounter never grants redistribution rights. */
  redistributionPermitted: z.boolean().default(false),
  /** Host rights/policy gate ids that MUST pass before any presentation. */
  gates: z.array(z.string().min(1).max(128)).default([]),
  /** Host-owned rights basis reference; presence implies nothing. */
  rightsRef: RefSchema.optional(),
  /** Host-declared usage restrictions (opaque vocabulary). */
  usageRestrictions: z.array(z.string().min(1).max(128)).default([]),
});
export type AdRightsConstraints = z.infer<typeof AdRightsConstraintsSchema>;

// ---------------------------------------------------------------------------
// §8 Value separation (law 7)
// ---------------------------------------------------------------------------

/**
 * Estimated value TO THE USER of seeing this ad — produced by the
 * host/agent's own assessment. Never merged with commercial value.
 */
export const AdUserValueAssessmentSchema = z.object({
  score: z.number().min(0).max(1),
  method: z.string().min(1).max(64).optional(),
  reasons: z.array(z.string().min(1).max(256)).default([]),
});
export type AdUserValueAssessment = z.infer<typeof AdUserValueAssessmentSchema>;

/**
 * Advertiser/host-declared COMMERCIAL value (opaque metrics such as
 * bid or eCPM hints). A declared input only: it may inform host
 * objectives or constraints but is NEVER a ranking authority in
 * Reckon — an ad is not shown merely because it has high commercial
 * value (AD-004; law 7).
 */
export const AdCommercialValueAssessmentSchema = z.object({
  metrics: MetricPayloadSchema.default({}),
  currency: z.string().length(3).optional(),
  declaredBy: z.string().min(1).max(64).optional(),
});
export type AdCommercialValueAssessment = z.infer<typeof AdCommercialValueAssessmentSchema>;

// ---------------------------------------------------------------------------
// §9 Ad eligibility
// ---------------------------------------------------------------------------

/**
 * Ad-specific eligibility for presentation. DECLARED host-side,
 * evaluated host-side: Reckon never enforces frequency caps, pacing or
 * brand safety (W3-008 host-authority law). Use
 * `adEligibilityToConstraints` to project the portable parts onto the
 * existing `HardConstraint` vocabulary for the decision path.
 */
export const AdEligibilitySchema = z.object({
  /** Flight window (mirrors catalog availability; host-declared). */
  flight: z
    .object({
      fromMs: TimestampMsSchema.optional(),
      untilMs: TimestampMsSchema.optional(),
    })
    .optional(),
  /** Host surfaces this ad may appear on (host vocabulary, opaque). */
  surfaces: z.array(z.string().min(1).max(64)).default([]),
  /** Host eligibility gate ids that must pass. */
  gates: z.array(z.string().min(1).max(128)).default([]),
  /** Host frequency/pacing policy, opaque to the core — never enforced by Reckon. */
  hostFrequencyPolicy: z.record(z.string(), z.unknown()).default({}),
});
export type AdEligibility = z.infer<typeof AdEligibilitySchema>;

/**
 * Project ad eligibility onto the EXISTING hard-constraint vocabulary
 * (no parallel constraint system): flight window → `time-window`,
 * gates → `policy-rights`. Surface and frequency policy stay
 * host-evaluated and intentionally do not project.
 */
export function adEligibilityToConstraints(eligibility: AdEligibility): HardConstraint[] {
  const constraints: HardConstraint[] = [];
  if (eligibility.flight && (eligibility.flight.fromMs !== undefined || eligibility.flight.untilMs !== undefined)) {
    constraints.push({
      kind: "time-window",
      ...(eligibility.flight.fromMs !== undefined ? { fromMs: eligibility.flight.fromMs } : {}),
      ...(eligibility.flight.untilMs !== undefined ? { untilMs: eligibility.flight.untilMs } : {}),
    });
  }
  for (const gateId of eligibility.gates) {
    constraints.push({ kind: "policy-rights", gateId });
  }
  return constraints;
}

// ---------------------------------------------------------------------------
// §10 Canonical Ad Memory record
// ---------------------------------------------------------------------------

/**
 * The canonical Personal Ad Memory record (AD-002 persists these).
 * One record = one retained ad for one subject in one tenant, with:
 * - the ad as a normalized `AdCatalogItem` (+ realizations);
 * - host-owned lineage;
 * - retention with an EXPLICIT basis (law 1) and forget/expiry states
 *   (laws 2–3);
 * - append-only permission state;
 * - unconfusable provenance (law 9);
 * - rights constraints (law 4);
 * - a deterministic content digest and derived record id.
 *
 * Law 6: there is no audience-inference field on this record. Derived
 * learning state belongs to `PreferenceDelta` (separate primitive,
 * own provenance/confidence), keeping raw ad content separate from
 * derived learning state.
 */
export const AdMemoryRecordSchema = z.object({
  schema: z.literal("reckon.ad-memory-record").default("reckon.ad-memory-record"),
  schemaVersion: z.string().default("0.1.0"),
  recordId: IdSchema,
  tenant: TenantScopeSchema,
  /** Opaque subject reference — the host is the subject identity authority. */
  subject: SubjectReferenceSchema,
  /** The ad itself (kind is structurally "advertising" — law 8). */
  ad: AdCatalogItemSchema,
  /** Realizations captured with the memory (formats/surfaces). */
  realizations: z.array(RealizationSchema).default([]),
  /** Host-owned ad identity lineage. */
  lineage: AdLineageSchema,
  /** Retention — basis REQUIRED in every state (law 1). */
  retention: AdRetentionSchema,
  /** Permission/consent state with append-only transitions. */
  permissions: AdPermissionStateSchema,
  /** Provenance — observed encounter vs provider-supplied (law 9). */
  provenance: AdProvenanceSchema,
  /** Rights constraints — redistribution defaults false (law 4). */
  rights: AdRightsConstraintsSchema,
  /** sha256 hex digest over the canonical record content. */
  contentDigest: z.string().regex(/^[0-9a-f]{64}$/),
  /** When the record was written (caller-supplied, contract rule #4). */
  recordedAt: TimestampMsSchema,
  /** Idempotency key for the memory write (AD-002 idempotent writes). */
  idempotencyKey: IdSchema.optional(),
});
export type AdMemoryRecord = z.infer<typeof AdMemoryRecordSchema>;

/**
 * The identity-bearing content of a memory record — everything the
 * digest/id derivation covers (derived and write-channel fields
 * omitted).
 */
export const AdMemoryRecordContentSchema = AdMemoryRecordSchema.omit({
  recordId: true,
  contentDigest: true,
  idempotencyKey: true,
});
export type AdMemoryRecordContent = z.infer<typeof AdMemoryRecordContentSchema>;

/**
 * The INPUT shape of a memory record's content (defaulted fields such
 * as `schema`/`schemaVersion` may be omitted) — what callers naturally
 * construct and what the digest/id/finalize helpers accept.
 */
export type AdMemoryRecordContentInput = z.input<typeof AdMemoryRecordContentSchema>;

/**
 * Deterministic content digest for a memory record: sha256 over the
 * canonical JSON of the parsed content (defaults applied). Same
 * logical content ⇒ same digest ⇒ same record id ⇒ idempotent writes
 * (AD-002). The digest is scoped by tenant + subject + ad + evidence:
 * the same ad encountered by two subjects yields distinct records.
 * Hosts wanting one-record-per-ad dedup can upsert by
 * (subject, itemId) with their own write policy — the contract does
 * not force a cardinality.
 */
export function adMemoryRecordDigest(content: AdMemoryRecordContentInput): string {
  return contentDigest(AdMemoryRecordContentSchema.parse(content));
}

/** Deterministic record id derived from the content digest. */
export function adMemoryRecordId(content: AdMemoryRecordContentInput): string {
  return `admem-${adMemoryRecordDigest(content).slice(0, 24)}`;
}

/**
 * Complete a memory record: parse the content, derive the digest and
 * record id deterministically, and parse the full record. The single
 * construction path that guarantees digest/id consistency (AD-002
 * idempotent writes).
 */
export function finalizeAdMemoryRecord(
  content: AdMemoryRecordContentInput,
  idempotencyKey?: Id,
): AdMemoryRecord {
  const parsed = AdMemoryRecordContentSchema.parse(content);
  const digest = adMemoryRecordDigest(parsed);
  return AdMemoryRecordSchema.parse({
    ...parsed,
    recordId: `admem-${digest.slice(0, 24)}`,
    contentDigest: digest,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
}

/**
 * A memory record that can legally appear as a remembered candidate:
 * retention structurally `active` (laws 2–3 — forgotten and expired
 * records cannot be retrieved from Personal Ad Memory).
 */
export const RetrievableAdMemoryRecordSchema = AdMemoryRecordSchema.extend({
  retention: ActiveAdRetentionSchema,
});
export type RetrievableAdMemoryRecord = z.infer<typeof RetrievableAdMemoryRecordSchema>;

/**
 * Runtime retrieval gate over the temporal parts the schema cannot
 * express (law 2 + law 3): the record must be `active`, unexpired at
 * `at`, and retention permission must still be granted. Pure and
 * deterministic — `at` is caller-supplied.
 */
export function isAdMemoryRetrievable(
  record: Pick<AdMemoryRecord, "retention" | "permissions">,
  at: TimestampMs,
): boolean {
  if (record.retention.state !== "active") return false;
  if (record.retention.expiresAt !== undefined && record.retention.expiresAt <= at) return false;
  if (record.permissions.retain !== "granted") return false;
  return true;
}

/**
 * Deterministic availability check against the ad's own catalog
 * window (law 3: an ad past its availability window cannot be
 * presented as currently available).
 */
export function isAdAvailableAt(
  ad: Pick<AdCatalogItem, "availableFrom" | "availableUntil">,
  at: TimestampMs,
): boolean {
  if (ad.availableFrom !== undefined && ad.availableFrom > at) return false;
  if (ad.availableUntil !== undefined && ad.availableUntil <= at) return false;
  return true;
}

// ---------------------------------------------------------------------------
// §11 Ad Query contracts
// ---------------------------------------------------------------------------

/** Query modes (AD-003): remembered ads, currently available ads, or both. */
export const AD_QUERY_MODES = ["remembered", "available", "both"] as const;

/** Structured query filters (lexical/semantic terms are host/adapter-expanded). */
export const AdQueryFiltersSchema = z.object({
  /** Lexical terms (after any model-assisted expansion — disclosed on the result). */
  terms: z.array(z.string().min(1).max(128)).default([]),
  /** Catalog labels to match. */
  labels: z.array(z.string().min(1).max(128)).default([]),
  /** Lineage filters (host refs). */
  advertiserRefs: z.array(RefSchema).default([]),
  campaignRefs: z.array(RefSchema).default([]),
  /** Host surface filters. */
  surfaces: z.array(z.string().min(1).max(64)).default([]),
  /** Temporal window over encounter time (remembered lane). */
  encounteredFrom: TimestampMsSchema.optional(),
  encounteredUntil: TimestampMsSchema.optional(),
  /** Maximum candidates per provenance lane. */
  limit: z.number().int().positive().max(100).optional(),
});
export type AdQueryFilters = z.infer<typeof AdQueryFiltersSchema>;

/**
 * Ad Query request (AD-003). `at` is REQUIRED and caller-supplied:
 * expiry, availability and temporal relevance are evaluated against
 * it, deterministically, for replay (contract rule #4).
 *
 * Model-assisted query understanding happens BEHIND the model adapter
 * seam (ADR-002) and must be disclosed on the result's
 * `queryUnderstanding` — never a hidden ranker.
 */
export const AdQueryRequestSchema = z.object({
  schema: z.literal("reckon.ad-query-request").default("reckon.ad-query-request"),
  schemaVersion: z.string().default("0.1.0"),
  queryId: IdSchema,
  tenant: TenantScopeSchema,
  subject: SubjectReferenceSchema,
  mode: z.enum(AD_QUERY_MODES).default("both"),
  /** Raw query text, e.g. "Show me the hotel ad I saw last week". */
  text: z.string().min(1).max(1024).optional(),
  filters: AdQueryFiltersSchema.prefault({}),
  /** Context for contextual relevance (by reference — law 5). */
  context: ContextReferenceSchema.optional(),
  /** Evaluation clock — caller-supplied for deterministic replay. */
  at: TimestampMsSchema,
  idempotencyKey: IdSchema.optional(),
});
export type AdQueryRequest = z.infer<typeof AdQueryRequestSchema>;

/** Why a candidate was retrieved — explainability per candidate. */
export const AD_RETRIEVAL_REASON_KINDS = [
  "query-match",
  "semantic-match",
  "label-match",
  "lineage-match",
  "temporal-match",
  "contextual-match",
  "recency",
  "user-requested",
  "provider-supplied",
  "other",
] as const;

export const AdRetrievalReasonSchema = z.object({
  kind: z.enum(AD_RETRIEVAL_REASON_KINDS),
  detail: z.string().min(1).max(256).optional(),
  /**
   * Retrieval score component — a HINT from the retrieval stage,
   * never the decision. Ranking remains the decision kernel's.
   */
  score: z.number().optional(),
});
export type AdRetrievalReason = z.infer<typeof AdRetrievalReasonSchema>;

/**
 * A retained-ad candidate retrieved from Personal Ad Memory.
 * `advertising` is a literal `true` (law 8) and the embedded record is
 * structurally in retention state `active` (laws 2–3) — forgotten or
 * expired records cannot appear here.
 */
export const RememberedAdCandidateSchema = z.object({
  candidateKind: z.literal("remembered"),
  /** Explicit ad identification (law 8) — always true on ad candidates. */
  advertising: z.literal(true),
  /** The memory record this candidate was built from. */
  record: RetrievableAdMemoryRecordSchema,
  eligibility: AdEligibilitySchema.optional(),
  /** Value separation (law 7). */
  userValue: AdUserValueAssessmentSchema.optional(),
  commercialValue: AdCommercialValueAssessmentSchema.optional(),
  whyRetrieved: z.array(AdRetrievalReasonSchema).default([]),
});
export type RememberedAdCandidate = z.infer<typeof RememberedAdCandidateSchema>;

/**
 * A currently-available-ad candidate supplied by a host/provider
 * channel (NOT from memory). Carries its own availability declaration,
 * rights constraints and optional link to a retained memory of the
 * same ad — the availability claim is the provider's, never the
 * memory's (law 9).
 */
export const AvailableAdCandidateSchema = z.object({
  candidateKind: z.literal("available"),
  /** Explicit ad identification (law 8). */
  advertising: z.literal(true),
  /** The ad as declared by the supplying channel. */
  ad: AdCatalogItemSchema,
  realizations: z.array(RealizationSchema).default([]),
  /** Provider/host availability declaration (law 9 — distinct provenance). */
  availability: AdAvailabilitySchema,
  /** Rights constraints on the supplied ad (law 4). */
  rights: AdRightsConstraintsSchema,
  /** Link to a retained memory record of the same ad, if one exists. */
  memoryRecordId: IdSchema.optional(),
  eligibility: AdEligibilitySchema.optional(),
  userValue: AdUserValueAssessmentSchema.optional(),
  commercialValue: AdCommercialValueAssessmentSchema.optional(),
  whyRetrieved: z.array(AdRetrievalReasonSchema).default([]),
});
export type AvailableAdCandidate = z.infer<typeof AvailableAdCandidateSchema>;

/** Any ad candidate — remembered or available (law 9 discriminator). */
export const AdCandidateSchema = z.discriminatedUnion("candidateKind", [
  RememberedAdCandidateSchema,
  AvailableAdCandidateSchema,
]);
export type AdCandidate = z.infer<typeof AdCandidateSchema>;

/**
 * Ad Query result (AD-003). Remembered and available candidates live
 * in SEPARATE arrays and are never merged (law 9) — the user can
 * always tell a remembered ad from newly available supply. Mode
 * consistency is enforced on parse: `remembered` mode cannot return
 * available candidates and vice versa.
 */
export const AdQueryResultSchema = z
  .object({
    schema: z.literal("reckon.ad-query-result").default("reckon.ad-query-result"),
    schemaVersion: z.string().default("0.1.0"),
    queryId: IdSchema,
    tenant: TenantScopeSchema,
    mode: z.enum(AD_QUERY_MODES),
    /** The evaluation clock actually used (echo of the request). */
    at: TimestampMsSchema,
    /** Candidates retrieved from Personal Ad Memory. */
    remembered: z.array(RememberedAdCandidateSchema).default([]),
    /** Candidates supplied by host/provider availability channels. */
    available: z.array(AvailableAdCandidateSchema).default([]),
    /** Disclosed query understanding (incl. model provenance, if any). */
    queryUnderstanding: z
      .object({
        terms: z.array(z.string().min(1).max(128)).default([]),
        modelProvenance: ProvenanceSchema.optional(),
      })
      .optional(),
    /** Honest notes about what was NOT searched or could not be evaluated. */
    notes: z.array(z.string().min(1).max(256)).default([]),
  })
  .superRefine((result, ctx) => {
    if (result.mode === "remembered" && result.available.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "mode 'remembered' must not return available candidates",
        path: ["available"],
      });
    }
    if (result.mode === "available" && result.remembered.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "mode 'available' must not return remembered candidates",
        path: ["remembered"],
      });
    }
  });
export type AdQueryResult = z.infer<typeof AdQueryResultSchema>;

/**
 * Runtime availability gate for available candidates (law 3): the
 * candidate's own availability window AND the ad's catalog window must
 * both be open at `at`.
 */
export function isAdCandidateCurrentlyAvailable(
  candidate: Pick<z.input<typeof AvailableAdCandidateSchema>, "ad" | "availability">,
  at: TimestampMs,
): boolean {
  const { availableFrom, availableUntil } = candidate.availability;
  if (availableFrom !== undefined && availableFrom > at) return false;
  if (availableUntil !== undefined && availableUntil <= at) return false;
  return isAdAvailableAt(candidate.ad, at);
}

// ---------------------------------------------------------------------------
// §12 Forget semantics (law 2)
// ---------------------------------------------------------------------------

/** What to forget: one record, all records for an item, an advertiser, or everything. */
export const AdForgetTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("record"), recordId: IdSchema }),
  z.object({ kind: z.literal("item"), itemId: IdSchema }),
  z.object({ kind: z.literal("advertiser"), advertiserRef: RefSchema }),
  z.object({ kind: z.literal("all") }),
]);
export type AdForgetTarget = z.infer<typeof AdForgetTargetSchema>;

/**
 * Explicit forget request. After it commits, subsequent retrieval
 * CANNOT return the forgotten ads from Personal Ad Memory (law 2) —
 * `forgotten` is a terminal retention state.
 */
export const AdForgetRequestSchema = z.object({
  schema: z.literal("reckon.ad-forget-request").default("reckon.ad-forget-request"),
  schemaVersion: z.string().default("0.1.0"),
  requestId: IdSchema,
  tenant: TenantScopeSchema,
  subject: SubjectReferenceSchema,
  target: AdForgetTargetSchema,
  reason: z.string().min(1).max(256).optional(),
  at: TimestampMsSchema,
  idempotencyKey: IdSchema,
});
export type AdForgetRequest = z.infer<typeof AdForgetRequestSchema>;

/** Forget result — the affected records transitioned to `forgotten`. */
export const AdForgetResultSchema = z.object({
  schema: z.literal("reckon.ad-forget-result").default("reckon.ad-forget-result"),
  schemaVersion: z.string().default("0.1.0"),
  requestId: IdSchema,
  tenant: TenantScopeSchema,
  forgottenCount: z.number().int().nonnegative(),
  forgottenRecordIds: z.array(IdSchema).default([]),
  at: TimestampMsSchema,
});
export type AdForgetResult = z.infer<typeof AdForgetResultSchema>;

// ---------------------------------------------------------------------------
// §13 Candidate resolution into the EXISTING decision path
// ---------------------------------------------------------------------------

/**
 * Candidate sources for the mapping into `CandidateSet` — distinct per
 * provenance lane (law 9) so downstream provenance never blurs.
 */
export const AD_CANDIDATE_SOURCES = {
  remembered: "reckon.ad-memory.remembered",
  available: "reckon.ad-availability.current",
} as const;

function maxRetrievalScore(reasons: AdRetrievalReason[]): number | undefined {
  let max: number | undefined;
  for (const reason of reasons) {
    if (reason.score !== undefined && (max === undefined || reason.score > max)) {
      max = reason.score;
    }
  }
  return max;
}

/**
 * Map ad query candidates into the EXISTING `CandidateSet` consumed by
 * `DecisionRequest` — the NO-PARALLEL-RANKING rule (AD-001/AD-004).
 * Ad candidates never carry their own ranking contract: they become
 * `CandidateReference`s with retrieval hints (`rankHint` is
 * positional, `scoreHint` is the best retrieval score) which are
 * HINTS, never decisions. Ranking authority stays with the decision
 * kernel.
 *
 * Throws when both lanes are empty — a `CandidateSet` requires at
 * least one candidate (mirrors `DecisionRequest`'s rejection of empty
 * sets).
 */
export function adCandidatesToCandidateSet(
  setId: Id,
  result: Pick<AdQueryResult, "remembered" | "available">,
): CandidateSet {
  const candidates: CandidateReference[] = [];
  let rank = 1;
  for (const candidate of result.remembered) {
    candidates.push({
      itemId: candidate.record.ad.itemId,
      realizationIds: candidate.record.realizations.map((r) => r.realizationId),
      source: AD_CANDIDATE_SOURCES.remembered,
      rankHint: rank++,
      ...(maxRetrievalScore(candidate.whyRetrieved) !== undefined
        ? { scoreHint: maxRetrievalScore(candidate.whyRetrieved) }
        : {}),
    });
  }
  for (const candidate of result.available) {
    candidates.push({
      itemId: candidate.ad.itemId,
      realizationIds: candidate.realizations.map((r) => r.realizationId),
      source: AD_CANDIDATE_SOURCES.available,
      rankHint: rank++,
      ...(maxRetrievalScore(candidate.whyRetrieved) !== undefined
        ? { scoreHint: maxRetrievalScore(candidate.whyRetrieved) }
        : {}),
    });
  }
  return CandidateSetSchema.parse({ setId, candidates });
}
