/**
 * Ads view model (AD-005) — PURE mapping from the FROZEN ad contracts
 * (`packages/contracts/src/ads.ts`, ADR-005) to the Ads section's reading
 * order. The Ad Memory / Ad Query product laws this module makes visible:
 *
 * - LAW 8 (advertising stays explicitly identifiable): every ad row
 *   carries `advertising: true` — the view model never drops it and the
 *   components render the Advertising mark on every ad card, distinct
 *   from ordinary recommendation rows.
 * - LAW 9 (remembered vs provider-supplied provenance): every ad row
 *   carries an origin class — `remembered` (Personal Ad Memory record
 *   with observed-encounter provenance), `retrieved` (memory record
 *   seeded from supply — provider-supplied provenance inside the
 *   remembered lane) or `provider-supplied` (an available-lane
 *   candidate, never in memory). The two query lanes are NEVER merged
 *   into one list in the view models.
 * - LAW 1 (retention basis): retention rows always surface the explicit
 *   basis — never a bare state.
 * - LAW 2 (forget means unretrievable): a record absent from the
 *   remembered lane is "not retrievable" — the view never invents a
 *   reason beyond the honest set (forgotten / expired / revoked / unknown).
 * - LAW 4 (encounter is not a redistribution license): rights rows
 *   always show `redistributionPermitted` (default false) verbatim.
 * - LAW 7 (user value separate from commercial value): the two value
 *   assessments map to SEPARATE rows, never blended.
 *
 * Dependency-free and React-free (root NodeNext typecheck + unit tests).
 * No env access, no `server-only` — the server loader composes this with
 * the SDK seam. HONESTY LAW (Gate Q): absent contract fields surface as
 * explicit "not provided" rows — never computed, never invented.
 */
import type {
  AdQueryRequestInput,
  AdQueryResult,
  AdForgetResult,
  DecisionRequestInput,
  DecisionResult,
  SubjectReference,
  TenantScope,
} from "@reckon/sdk";
import type {
  AdCandidate,
  AdMemoryRecord,
  AdRetention,
  AdRetentionBasis,
  AdRightsConstraints,
  AdUserValueAssessment,
  AdCommercialValueAssessment,
  AdRetrievalReason,
  AvailableAdCandidate,
  RememberedAdCandidate,
  TimestampMs,
} from "@reckon/contracts";
import { formatEpochMs } from "./auth-view.js";

// Contract types re-exported for consumer convenience (types ONLY —
// erased at compile, so this stays a client-safe module).
export type { AdCandidate, AdMemoryRecord } from "@reckon/contracts";

/* ------------------------------------------------------------------ *
 * §1 Law 9 — origin classes
 * ------------------------------------------------------------------ */

/**
 * The three visible origin classes (law 9 + the AD-005 work order's
 * "remembered / retrieved / provider-supplied" triple):
 *
 * - `remembered` — a Personal Ad Memory record whose provenance is an
 *   OBSERVED encounter: the user actually saw this ad.
 * - `retrieved` — a memory record seeded from supply (provenance
 *   `provider-supplied` INSIDE the remembered lane — the host seeded
 *   memory from an availability declaration; retained, but never
 *   encountered).
 * - `provider-supplied` — an available-lane candidate: a host/provider
 *   channel declares it is willing to serve the ad RIGHT NOW. Never an
 *   observation, never in memory.
 */
export type AdOriginClass = "remembered" | "retrieved" | "provider-supplied";

export interface AdOriginBadge {
  readonly origin: AdOriginClass;
  /** Short pill label (always rendered — color/icon are redundant channels). */
  readonly label: string;
  /** Tooltip / explanation line. */
  readonly detail: string;
}

export const AD_ORIGIN_BADGES: Readonly<Record<AdOriginClass, AdOriginBadge>> = {
  remembered: {
    origin: "remembered",
    label: "Remembered",
    detail:
      "Remembered ad — retained in Personal Ad Memory from an observed encounter with this subject.",
  },
  retrieved: {
    origin: "retrieved",
    label: "Retained from supply",
    detail:
      "Retained from supply — held in Personal Ad Memory, but seeded from a provider availability declaration rather than an observed encounter.",
  },
  "provider-supplied": {
    origin: "provider-supplied",
    label: "Provider-supplied",
    detail:
      "Provider-supplied — newly declared available by a host/provider channel. Not in Personal Ad Memory.",
  },
};

/** Origin class of a memory record (the remembered lane's two provenances). */
export function adOriginForRecord(record: AdMemoryRecord): AdOriginClass {
  return record.provenance.kind === "observed-encounter" ? "remembered" : "retrieved";
}

/** Origin class of an ad query candidate (either lane). */
export function adOriginForCandidate(candidate: AdCandidate): AdOriginClass {
  if (candidate.candidateKind === "remembered") {
    return adOriginForRecord(candidate.record);
  }
  return "provider-supplied";
}

/* ------------------------------------------------------------------ *
 * §2 Card rows (both lanes)
 * ------------------------------------------------------------------ */

export interface WhyRetrievedRow {
  readonly kind: string;
  readonly detail: string | null;
  readonly score: number | null;
}

export interface EncounterView {
  /** When the encounter was observed (label + raw epoch ms). */
  readonly atLabel: string;
  readonly atMs: number;
  /** The observed OutcomeEvent that recorded the encounter (law 10). */
  readonly outcomeEventId: string;
  readonly evidenceClass: string;
  /** Host surface where the encounter happened, when declared. */
  readonly surface: string | null;
  /** Context by reference (law 5) — an id, never raw context. */
  readonly contextId: string | null;
}

export interface AvailabilityView {
  readonly suppliedBy: string;
  readonly fromLabel: string | null;
  readonly untilLabel: string | null;
}

export interface RetentionSummaryRow {
  readonly state: string;
  readonly basisKind: string;
  readonly basisDetail: string | null;
  readonly retainedLabel: string | null;
  readonly expiryLabel: string | null;
}

export interface ValueRows {
  readonly userValue: { readonly score: number; readonly reasons: readonly string[] } | null;
  readonly commercialValue: { readonly metricsLabel: string; readonly declaredBy: string | null } | null;
}

export interface RightsRow {
  readonly redistributionPermitted: boolean;
  readonly gates: readonly string[];
  readonly usageRestrictions: readonly string[];
  readonly rightsRef: string | null;
}

/**
 * One ad card — the shape both lanes render. `advertising` is a literal
 * `true` (law 8): the components use it to render the Advertising mark.
 */
export interface AdCardView {
  readonly key: string;
  readonly advertising: true;
  readonly origin: AdOriginClass;
  readonly originBadge: AdOriginBadge;
  readonly recordId: string | null;
  readonly itemId: string;
  readonly title: string;
  readonly labels: readonly string[];
  readonly encounter: EncounterView | null;
  readonly availability: AvailabilityView | null;
  readonly retention: RetentionSummaryRow | null;
  readonly rights: RightsRow;
  readonly whyRetrieved: readonly WhyRetrievedRow[];
  readonly values: ValueRows;
  /** Link to the record detail (remembered lane only — memory records). */
  readonly detailHref: string | null;
}

/** Host-defined title: the ad's own `attributes.title` when a string, else the itemId. */
export function adTitleOf(ad: { itemId: string; attributes: Record<string, unknown> }): string {
  const title = ad.attributes["title"];
  return typeof title === "string" && title.trim().length > 0 ? title.trim() : ad.itemId;
}

function whyRetrievedRows(reasons: readonly AdRetrievalReason[]): WhyRetrievedRow[] {
  return reasons.map((reason) => ({
    kind: reason.kind,
    detail: reason.detail ?? null,
    score: reason.score ?? null,
  }));
}

function rightsRow(rights: AdRightsConstraints): RightsRow {
  return {
    redistributionPermitted: rights.redistributionPermitted,
    gates: [...rights.gates],
    usageRestrictions: [...rights.usageRestrictions],
    rightsRef: rights.rightsRef ?? null,
  };
}

function userValueRow(assessment: AdUserValueAssessment | undefined): ValueRows["userValue"] {
  if (assessment === undefined) return null;
  return { score: assessment.score, reasons: [...assessment.reasons] };
}

function commercialValueRow(
  assessment: AdCommercialValueAssessment | undefined,
): ValueRows["commercialValue"] {
  if (assessment === undefined) return null;
  const metrics = Object.entries(assessment.metrics ?? {}).map(([key, value]) => `${key}=${String(value)}`);
  return {
    metricsLabel: metrics.length > 0 ? metrics.join(" · ") : "no declared metrics",
    declaredBy: assessment.declaredBy ?? null,
  };
}

export function retentionSummary(retention: AdRetention): RetentionSummaryRow {
  return {
    state: retention.state,
    basisKind: retention.basis.kind,
    basisDetail: retention.basis.description ?? null,
    retainedLabel: retention.retainedAt !== undefined ? formatEpochMs(retention.retainedAt) : null,
    expiryLabel: retention.expiresAt !== undefined ? formatEpochMs(retention.expiresAt) : null,
  };
}

/** Map a remembered-lane candidate (law 9: memory record, active retention). */
export function rememberedAdCardView(candidate: RememberedAdCandidate): AdCardView {
  const record = candidate.record;
  const origin = adOriginForRecord(record);
  return {
    key: record.recordId,
    advertising: true,
    origin,
    originBadge: AD_ORIGIN_BADGES[origin],
    recordId: record.recordId,
    itemId: record.ad.itemId,
    title: adTitleOf(record.ad),
    labels: [...record.ad.labels],
    encounter:
      record.provenance.kind === "observed-encounter"
        ? {
            atLabel: formatEpochMs(record.provenance.evidence.encounteredAt),
            atMs: record.provenance.evidence.encounteredAt,
            outcomeEventId: record.provenance.evidence.outcomeEventId,
            evidenceClass: record.provenance.evidence.evidenceClass,
            surface: record.provenance.evidence.surface ?? null,
            contextId: record.provenance.evidence.context?.contextId ?? null,
          }
        : null,
    availability:
      record.provenance.kind === "provider-supplied"
        ? {
            suppliedBy: record.provenance.availability.suppliedBy,
            fromLabel:
              record.provenance.availability.availableFrom !== undefined
                ? formatEpochMs(record.provenance.availability.availableFrom)
                : null,
            untilLabel:
              record.provenance.availability.availableUntil !== undefined
                ? formatEpochMs(record.provenance.availability.availableUntil)
                : null,
          }
        : null,
    retention: retentionSummary(record.retention),
    rights: rightsRow(record.rights),
    whyRetrieved: whyRetrievedRows(candidate.whyRetrieved),
    values: {
      userValue: userValueRow(candidate.userValue),
      commercialValue: commercialValueRow(candidate.commercialValue),
    },
    detailHref: `/ads/records/${encodeURIComponent(record.recordId)}`,
  };
}

/** Map an available-lane candidate (law 9: provider-supplied, never memory). */
export function availableAdCardView(candidate: AvailableAdCandidate): AdCardView {
  return {
    key: `avail-${candidate.ad.itemId}`,
    advertising: true,
    origin: "provider-supplied",
    originBadge: AD_ORIGIN_BADGES["provider-supplied"],
    recordId: candidate.memoryRecordId ?? null,
    itemId: candidate.ad.itemId,
    title: adTitleOf(candidate.ad),
    labels: [...candidate.ad.labels],
    encounter: null,
    availability: {
      suppliedBy: candidate.availability.suppliedBy,
      fromLabel:
        candidate.availability.availableFrom !== undefined
          ? formatEpochMs(candidate.availability.availableFrom)
          : null,
      untilLabel:
        candidate.availability.availableUntil !== undefined
          ? formatEpochMs(candidate.availability.availableUntil)
          : null,
    },
    retention: null,
    rights: rightsRow(candidate.rights),
    whyRetrieved: whyRetrievedRows(candidate.whyRetrieved),
    values: {
      userValue: userValueRow(candidate.userValue),
      commercialValue: commercialValueRow(candidate.commercialValue),
    },
    detailHref:
      candidate.memoryRecordId !== undefined
        ? `/ads/records/${encodeURIComponent(candidate.memoryRecordId)}`
        : null,
  };
}

/** Both lanes' card views — SEPARATE arrays (law 9: never merged in the UI). */
export function adQueryCardViews(result: AdQueryResult): {
  readonly remembered: readonly AdCardView[];
  readonly available: readonly AdCardView[];
} {
  return {
    remembered: result.remembered.map(rememberedAdCardView),
    available: result.available.map(availableAdCardView),
  };
}

/* ------------------------------------------------------------------ *
 * §3 Ad detail rows (evidence trail / encounter context / rights)
 * ------------------------------------------------------------------ */

export interface FactRow {
  readonly label: string;
  readonly value: string;
}

/** The evidence trail: the record's full provenance, field by field (law 9/10). */
export function evidenceTrailRows(record: AdMemoryRecord): readonly FactRow[] {
  if (record.provenance.kind === "observed-encounter") {
    const evidence = record.provenance.evidence;
    return [
      { label: "provenance class", value: "observed-encounter (remembered — law 9)" },
      { label: "outcome event", value: evidence.outcomeEventId },
      { label: "evidence class", value: evidence.evidenceClass },
      { label: "encountered at", value: formatEpochMs(evidence.encounteredAt) },
      { label: "encounter surface", value: evidence.surface ?? "not provided" },
      {
        label: "encounter context",
        value: evidence.context !== undefined ? `by reference: ${evidence.context.contextId}` : "not provided",
      },
    ];
  }
  const availability = record.provenance.availability;
  return [
    { label: "provenance class", value: "provider-supplied (retained from supply — law 9)" },
    { label: "declared by", value: availability.suppliedBy },
    {
      label: "declared from",
      value: availability.availableFrom !== undefined ? formatEpochMs(availability.availableFrom) : "not provided",
    },
    {
      label: "declared until",
      value: availability.availableUntil !== undefined ? formatEpochMs(availability.availableUntil) : "not provided",
    },
  ];
}

/** The record's identity + lineage (host-owned refs, opaque). */
export function lineageRows(record: AdMemoryRecord): readonly FactRow[] {
  return [
    { label: "record id", value: record.recordId },
    { label: "content digest", value: record.contentDigest },
    { label: "recorded at", value: formatEpochMs(record.recordedAt) },
    { label: "ad item", value: record.ad.itemId },
    { label: "lineage source", value: record.lineage.source },
    { label: "advertiser ref", value: record.lineage.advertiserRef ?? "not provided" },
    { label: "campaign ref", value: record.lineage.campaignRef ?? "not provided" },
    {
      label: "creative refs",
      value:
        record.lineage.creativeRefs.length > 0 ? record.lineage.creativeRefs.join(" → ") : "not provided",
    },
    {
      label: "realizations",
      value:
        record.realizations.length > 0
          ? record.realizations.map((r) => `${r.realizationId} (${r.kind})`).join(", ")
          : "none declared",
    },
  ];
}

/** Retention facts — state + the REQUIRED explicit basis (law 1) + expiry. */
export function retentionDetailRows(record: AdMemoryRecord): readonly FactRow[] {
  const rows: FactRow[] = [
    { label: "retention state", value: record.retention.state },
    { label: "retention basis", value: retentionBasisLabel(record.retention.basis) },
  ];
  if (record.retention.retainedAt !== undefined) {
    rows.push({ label: "retained at", value: formatEpochMs(record.retention.retainedAt) });
  }
  if (record.retention.expiresAt !== undefined) {
    rows.push({ label: "expires at", value: formatEpochMs(record.retention.expiresAt) });
  }
  if (record.retention.state === "forgotten") {
    rows.push({ label: "forgotten at", value: formatEpochMs(record.retention.forgottenAt) });
    if (record.retention.forgetReason !== undefined) {
      rows.push({ label: "forget reason", value: record.retention.forgetReason });
    }
  }
  return rows;
}

function retentionBasisLabel(basis: AdRetentionBasis): string {
  const description = basis.description !== undefined ? ` — ${basis.description}` : "";
  return `${basis.kind} (established ${formatEpochMs(basis.establishedAt)})${description}`;
}

/** Rights constraints (law 4 — redistribution defaults false, rights never inferred). */
export function rightsDetailRows(rights: AdRightsConstraints): readonly FactRow[] {
  return [
    {
      label: "redistribution permitted",
      value: rights.redistributionPermitted ? "yes (explicitly granted)" : "no (default — an encounter is not a license)",
    },
    { label: "rights basis ref", value: rights.rightsRef ?? "not provided" },
    { label: "rights gates", value: rights.gates.length > 0 ? rights.gates.join(", ") : "none declared" },
    {
      label: "usage restrictions",
      value: rights.usageRestrictions.length > 0 ? rights.usageRestrictions.join(", ") : "none declared",
    },
  ];
}

/* ------------------------------------------------------------------ *
 * §4 Permission / consent rows
 * ------------------------------------------------------------------ */

export interface PermissionGrantRow {
  readonly capability: "retain" | "present";
  readonly granted: boolean;
  readonly meaning: string;
}

export interface PermissionTransitionRow {
  readonly capability: "retain" | "present";
  readonly from: string;
  readonly to: string;
  readonly atLabel: string;
  readonly reason: string | null;
  readonly consentRef: string | null;
}

export interface PermissionView {
  readonly retain: PermissionGrantRow;
  readonly present: PermissionGrantRow;
  readonly history: readonly PermissionTransitionRow[];
}

const CAPABILITY_MEANINGS: Readonly<Record<"retain" | "present", string>> = {
  retain: "May Personal Ad Memory hold this ad at all.",
  present: "May the agent present/re-show this ad to the user.",
};

/** Permission state + append-only history (the consent surface's data). */
export function permissionView(record: AdMemoryRecord): PermissionView {
  return {
    retain: {
      capability: "retain",
      granted: record.permissions.retain === "granted",
      meaning: CAPABILITY_MEANINGS.retain,
    },
    present: {
      capability: "present",
      granted: record.permissions.present === "granted",
      meaning: CAPABILITY_MEANINGS.present,
    },
    history: record.permissions.history.map((transition) => ({
      capability: transition.capability,
      from: transition.from,
      to: transition.to,
      atLabel: formatEpochMs(transition.at),
      reason: transition.reason ?? null,
      consentRef: transition.consentRef ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * §5 Query param normalization (GET forms → AdQueryRequest plumbing)
 * ------------------------------------------------------------------ */

export type AdQueryMode = "remembered" | "available" | "both";

export interface AdsQueryFormParams {
  readonly text: string | undefined;
  readonly mode: AdQueryMode;
  readonly labels: readonly string[];
  readonly surfaces: readonly string[];
  readonly encounteredFromMs: number | undefined;
  readonly encounteredUntilMs: number | undefined;
  readonly limit: number | undefined;
  /** Deterministic replay clock (epoch ms) — undefined → the server supplies now. */
  readonly atMs: number | undefined;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Comma-separated list → trimmed non-empty entries (max 16, each ≤128 chars). */
function listParam(value: string | string[] | undefined): string[] {
  const raw = firstParam(value);
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().slice(0, 128))
    .filter((entry) => entry.length > 0)
    .slice(0, 16);
}

function epochParam(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function limitParam(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : undefined;
}

/**
 * Normalize the ads GET query params (pure). `text` is bounded to the
 * contract's 1024 chars; `mode` falls back to `both`; unknown values
 * never fabricate contract-invalid input — the API stays the authority.
 */
export function normalizeAdsQueryParams(
  params: Record<string, string | string[] | undefined>,
): AdsQueryFormParams {
  const rawMode = firstParam(params.mode);
  const mode: AdQueryMode =
    rawMode === "remembered" || rawMode === "available" || rawMode === "both" ? rawMode : "both";
  const text = firstParam(params.q)?.slice(0, 1024);
  return {
    text,
    mode,
    labels: listParam(params.labels),
    surfaces: listParam(params.surfaces),
    encounteredFromMs: epochParam(params.from),
    encounteredUntilMs: epochParam(params.until),
    limit: limitParam(params.limit),
    atMs: epochParam(params.at),
  };
}

/** The demo-lane scope the studio queries for (tenant + opaque subject). */
export interface AdsScope {
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
}

/**
 * Compose the SDK `ads.query` request input from normalized form params
 * (the server-side data path's request plumbing). `at` is the REQUIRED
 * caller-supplied evaluation clock (law 3 — the loader supplies `Date.now()`
 * when the URL does not pin a replay clock).
 */
export function adQueryRequestInput(
  params: AdsQueryFormParams,
  scope: AdsScope,
  ids: { readonly queryId: string },
  at: TimestampMs,
): AdQueryRequestInput {
  const filters: NonNullable<AdQueryRequestInput["filters"]> = {};
  if (params.labels.length > 0) filters.labels = [...params.labels];
  if (params.surfaces.length > 0) filters.surfaces = [...params.surfaces];
  if (params.encounteredFromMs !== undefined) filters.encounteredFrom = params.encounteredFromMs;
  if (params.encounteredUntilMs !== undefined) filters.encounteredUntil = params.encounteredUntilMs;
  if (params.limit !== undefined) filters.limit = params.limit;
  return {
    queryId: ids.queryId,
    tenant: scope.tenant,
    subject: scope.subject,
    mode: params.mode,
    ...(params.text !== undefined ? { text: params.text } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    at,
  };
}

/* ------------------------------------------------------------------ *
 * §6 Forget target parsing (the mutation proxy's body law)
 * ------------------------------------------------------------------ */

export type AdForgetTargetLike =
  | { readonly kind: "record"; readonly recordId: string }
  | { readonly kind: "item"; readonly itemId: string }
  | { readonly kind: "advertiser"; readonly advertiserRef: string }
  | { readonly kind: "all" };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Parse the forget proxy's JSON body (pure; the frozen target vocabulary). */
export function parseAdForgetBody(
  body: unknown,
): { readonly ok: true; readonly target: AdForgetTargetLike; readonly reason: string | undefined } | { readonly ok: false; readonly detail: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, detail: "the request body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const kind = record["kind"];
  const reason = typeof record["reason"] === "string" && record["reason"].trim().length > 0
    ? record["reason"].trim().slice(0, 256)
    : undefined;
  if (kind === "all") {
    return { ok: true, target: { kind: "all" }, reason };
  }
  if (kind === "record" || kind === "item" || kind === "advertiser") {
    const key = kind === "record" ? "recordId" : kind === "item" ? "itemId" : "advertiserRef";
    const value = record[key];
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      return { ok: false, detail: `target '${kind}' requires a url-safe '${key}' (1–128 chars)` };
    }
    return { ok: true, target: { kind, [key]: value } as AdForgetTargetLike, reason };
  }
  return { ok: false, detail: "target kind must be one of: record, item, advertiser, all" };
}

/** Stable action id for the mode machine's destructive gate (forget). */
export const FORGET_AD_ACTION_ID = "forget-ad";

/** The destructive-action descriptor for one forget target (mode machine vocabulary). */
export function forgetActionFor(target: AdForgetTargetLike): {
  readonly id: string;
  readonly label: string;
  readonly context: string;
} {
  switch (target.kind) {
    case "record":
      return { id: FORGET_AD_ACTION_ID, label: "Forget this ad", context: `record ${target.recordId}` };
    case "item":
      return { id: FORGET_AD_ACTION_ID, label: "Forget this ad", context: `item ${target.itemId}` };
    case "advertiser":
      return {
        id: FORGET_AD_ACTION_ID,
        label: "Forget all ads from this advertiser",
        context: `advertiser ${target.advertiserRef}`,
      };
    case "all":
      return { id: FORGET_AD_ACTION_ID, label: "Forget every remembered ad", context: "all remembered ads" };
  }
}

/* ------------------------------------------------------------------ *
 * §7 Forget result view
 * ------------------------------------------------------------------ */

export interface ForgetOutcomeView {
  readonly forgottenCount: number;
  readonly forgottenRecordIds: readonly string[];
  readonly atLabel: string;
  readonly title: string;
  readonly detail: string;
}

export function forgetOutcomeView(result: AdForgetResult): ForgetOutcomeView {
  const count = result.forgottenCount;
  return {
    forgottenCount: count,
    forgottenRecordIds: [...result.forgottenRecordIds],
    atLabel: formatEpochMs(result.at),
    title: count === 0 ? "Nothing was forgotten" : `Forgot ${count} ${count === 1 ? "record" : "records"}`,
    detail:
      count === 0
        ? "No matching, not-yet-forgotten records were in Personal Ad Memory — forget is idempotent and already-forgotten records are not re-counted."
        : `Terminal (law 2): these records can never be retrieved from Personal Ad Memory again. Effect took effect at ${formatEpochMs(result.at)}.`,
  };
}

/* ------------------------------------------------------------------ *
 * §9 Re-rank rows — BEFORE (retrieval lanes) / AFTER (kernel order)
 * ------------------------------------------------------------------ */

export interface RerankCandidateRow {
  readonly key: string;
  readonly advertising: boolean;
  readonly itemId: string;
  readonly origin: AdOriginClass | null;
  readonly originLabel: string | null;
  readonly lane: "remembered" | "available";
  readonly rankHint: number | null;
  readonly scoreHint: number | null;
  readonly topReason: string | null;
}

export interface RerankOutcomeRow {
  readonly key: string;
  readonly experienceId: string;
  readonly itemId: string | null;
  readonly advertising: boolean;
  readonly origin: AdOriginClass | null;
  readonly originLabel: string | null;
  readonly selected: boolean;
  readonly action: string | null;
  readonly score: number | null;
  readonly uncertainty: string | null;
  readonly reason: string | null;
  readonly excludedBy: string | null;
}

export interface RerankView {
  readonly before: readonly RerankCandidateRow[];
  readonly selected: RerankOutcomeRow | null;
  readonly after: readonly RerankOutcomeRow[];
  readonly action: string;
  readonly actionMeaning: string;
  readonly reasons: readonly { readonly code: string; readonly message: string }[];
  readonly scheduleDelta: string | null;
}

const ACTION_MEANINGS: Readonly<Record<string, string>> = {
  HOLD: "Do nothing now — the moment is wrong; the ad stays a candidate.",
  CONTINUE: "Keep presenting the current experience.",
  QUEUE: "Defer — queue the ad for a better moment without displacing anything.",
  SUGGEST: "Defer — surface the ad as a suggestion; the host decides whether to show it.",
  SWITCH: "Replace the current experience with the selected candidate.",
  INTERRUPT: "Break the current experience at a permitted boundary.",
  RESUME: "Return to a saved resume checkpoint.",
  END: "Conclude the current experience (no successor selected).",
};

/**
 * The compare view: BEFORE = the retrieval lanes' own order with their
 * hints (law 9 lanes kept separate); AFTER = the decision kernel's order
 * (selected + alternatives VERBATIM — never re-sorted by the UI). Each
 * AFTER row is mapped back to its ad (advertising + origin) through the
 * resolved experiences; a row that maps to no ad candidate renders as an
 * ordinary (non-ad) recommendation row — the law-8 distinction.
 */
export function rerankView(input: {
  readonly queryResult: AdQueryResult;
  readonly decision: DecisionResult;
  /** The resolved ad experiences (the loader's resolve output) — only the id↔item mapping is consumed. */
  readonly experiences: readonly { readonly experienceId: string; readonly itemId: string }[];
}): RerankView {
  const itemByExperienceId = new Map(input.experiences.map((e) => [e.experienceId, e.itemId]));
  const candidateByItemId = new Map<string, AdCandidate>();
  for (const candidate of input.queryResult.remembered) {
    candidateByItemId.set(candidate.record.ad.itemId, candidate);
  }
  for (const candidate of input.queryResult.available) {
    candidateByItemId.set(candidate.ad.itemId, candidate);
  }

  const before: RerankCandidateRow[] = [];
  let rank = 0;
  for (const candidate of input.queryResult.remembered) {
    rank += 1;
    before.push(candidateRow(candidate, "remembered", rank));
  }
  for (const candidate of input.queryResult.available) {
    rank += 1;
    before.push(candidateRow(candidate, "available", rank));
  }

  const outcomeRow = (experienceId: string, selected: boolean): RerankOutcomeRow => {
    const itemId =
      input.decision.selectedExperience?.experienceId === experienceId
        ? input.decision.selectedExperience.itemId
        : itemByExperienceId.get(experienceId) ?? null;
    const candidate = itemId !== null ? candidateByItemId.get(itemId) : undefined;
    const origin = candidate !== undefined ? adOriginForCandidate(candidate) : null;
    const alternative = input.decision.alternatives.find((alt) => alt.experienceId === experienceId);
    return {
      key: experienceId,
      experienceId,
      itemId,
      advertising: candidate !== undefined,
      origin,
      originLabel: origin !== null ? AD_ORIGIN_BADGES[origin].label : null,
      selected,
      action: selected ? input.decision.action : null,
      score: alternative?.score ?? null,
      uncertainty:
        alternative?.uncertainty !== undefined
          ? uncertaintyLabel(alternative.uncertainty)
          : input.decision.selectedExperience?.experienceId === experienceId &&
              input.decision.uncertainty !== undefined
            ? uncertaintyLabel(input.decision.uncertainty)
            : null,
      reason: alternative?.reason ?? null,
      excludedBy: alternative?.excludedBy ?? null,
    };
  };

  const selectedRow =
    input.decision.selectedExperience !== undefined
      ? outcomeRow(input.decision.selectedExperience.experienceId, true)
      : null;

  const after: RerankOutcomeRow[] = input.decision.alternatives.map((alt) =>
    outcomeRow(alt.experienceId, false),
  );

  return {
    before,
    selected: selectedRow,
    after,
    action: input.decision.action,
    actionMeaning: ACTION_MEANINGS[input.decision.action] ?? "the scheduler action, verbatim from the decision result",
    reasons: input.decision.reasons.map((reason) => ({ code: reason.code, message: reason.message })),
    scheduleDelta: scheduleDeltaLabel(input.decision),
  };
}

function candidateRow(candidate: AdCandidate, lane: "remembered" | "available", rank: number): RerankCandidateRow {
  const itemId = candidate.candidateKind === "remembered" ? candidate.record.ad.itemId : candidate.ad.itemId;
  const best = candidate.whyRetrieved.reduce<number | null>(
    (max, reason) => (reason.score !== undefined && (max === null || reason.score > max) ? reason.score : max),
    null,
  );
  const top = candidate.whyRetrieved[0];
  return {
    key: `${lane}-${itemId}`,
    advertising: true,
    itemId,
    origin: adOriginForCandidate(candidate),
    originLabel: AD_ORIGIN_BADGES[adOriginForCandidate(candidate)].label,
    lane,
    rankHint: rank,
    scoreHint: best,
    topReason: top !== undefined ? `${top.kind}${top.detail !== undefined ? ` — ${top.detail}` : ""}` : null,
  };
}

function uncertaintyLabel(uncertainty: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["confidence", "spread", "disagreement", "oodScore"] as const) {
    const value = uncertainty[key];
    if (typeof value === "number") parts.push(`${key} ${value.toFixed(3)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "declared, no numeric fields";
}

function scheduleDeltaLabel(decision: DecisionResult): string | null {
  const delta = decision.scheduleDelta;
  if (delta === undefined) return null;
  const parts: string[] = [delta.action];
  if (delta.enqueue.length > 0) parts.push(`enqueue ${delta.enqueue.length}`);
  if (delta.dequeue.length > 0) parts.push(`dequeue ${delta.dequeue.length}`);
  if (delta.resumeCheckpoint !== undefined) parts.push(`checkpoint ${delta.resumeCheckpoint.experienceId}`);
  return parts.join(" · ");
}
