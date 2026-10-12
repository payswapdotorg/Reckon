/**
 * AD-003 — Ad retrieval engine + runtime handler over the FROZEN AD-001
 * contracts (`packages/contracts/src/ads.ts`; ADR-005) and the AD-002
 * store port (`@reckon/persistence` AdMemoryStore).
 *
 * Two retrieval lanes per the frozen AdQuery contract (law 9 — never
 * merged, never confused):
 *
 * - REMEMBERED lane — reads Personal Ad Memory through the AD-002 store
 *   port (`listRemembered` at the CALLER-supplied clock `at`). The store
 *   is the authority for every ad-memory privacy law at its boundary
 *   (retention basis, terminal forget, expiry-vs-clock, retain+present
 *   permission gates, supersession) — this engine does NOT re-implement,
 *   weaken or bypass any of them. Lane order is the store's
 *   deterministic chronological order (recordedAt ASC, recordId ASC)
 *   VERBATIM — the retrieval stage has NO ranking authority (law 7);
 *   `whyRetrieved[].score` values are retrieval HINTS for the decision
 *   kernel, never a sort key here.
 *
 * - AVAILABLE lane — structured query over host/provider-supplied
 *   AVAILABILITY CHANNELS (the AdAvailability surface: a channel
 *   declaration that it is willing to serve an ad, never an observation,
 *   never a rights grant). No persistence is implied or performed: the
 *   lane is evaluated fresh per query against the channels configured at
 *   composition time. Every candidate carries its disclosed provider
 *   provenance (`whyRetrieved` kind `provider-supplied` + the frozen
 *   `availability` declaration).
 *
 * SEMANTIC MATCHING (honest): text matching is DETERMINISTIC LEXICAL
 * matching — terms extracted from the raw query text (disclosed in the
 * result's `queryUnderstanding.terms`) plus `filters.terms` are matched
 * case-insensitively as substrings over each candidate's searchable
 * metadata. NO model is consulted, NO embedding is computed and the
 * `semantic-match` reason kind is NEVER emitted by this deployment —
 * the honest limitation is disclosed per result in `notes` (true
 * semantic retrieval would ride the ADR-002 model seam and must be
 * disclosed via `queryUnderstanding.modelProvenance`; that surface is
 * intentionally unused here). Never faked.
 *
 * CLOCK DISCIPLINE (contract rule #4): every temporal evaluation —
 * retention expiry (in the store), availability windows
 * (`isAdCandidateCurrentlyAvailable`), encounter windows — runs against
 * the REQUIRED caller-supplied `at`. There is not a single wall-clock
 * read (`Date.now()` etc.) in this file.
 *
 * FILTER SEMANTICS (disclosed): the structured AdQueryFilters combine
 * conjunctively across dimensions; within a list dimension a candidate
 * matches when it matches AT LEAST ONE entry. A filter dimension that
 * cannot be evaluated for a candidate (e.g. an encounter-window filter
 * on provider-supplied availability, which carries no encounter)
 * EXCLUDES the candidate — never a silent pass, never an invented
 * match.
 */
import {
  AdQueryResultSchema,
  AvailableAdCandidateSchema,
  isAdCandidateCurrentlyAvailable,
  type AdCatalogItem,
  type AdCommercialValueAssessment,
  type AdEligibility,
  type AdForgetRequest,
  type AdForgetResult,
  type AdMemoryRecord,
  type AdQueryRequest,
  type AdQueryResult,
  type AdRetrievalReason,
  type AdRightsConstraints,
  type AdUserValueAssessment,
  type AdAvailability,
  type Realization,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import type { AdMemoryStore } from "@reckon/persistence";
import { ApiError, ERROR_CODES } from "./errors.js";
import type { AdRetrievalHandler } from "./ports.js";
import type { AuthContext, Parsed } from "./types.js";

/* ------------------------------------------------------------------ *
 * Availability channels — the host/provider supply seam (law 9)
 * ------------------------------------------------------------------ */

/**
 * One provider-supplied availability declaration: the ad as declared by
 * the supplying channel, the channel's `AdAvailability` declaration
 * (law 9 — a declaration, never an observation), the channel-declared
 * rights constraints (law 4 — never inferred), plus optional declared
 * eligibility/value inputs. Composed ONLY from the frozen
 * AvailableAdCandidate contract (`.omit` of the fields the RETRIEVAL
 * engine owns: the candidateKind/advertising literals and the
 * engine-computed whyRetrieved reasons) — no field type is hand-written.
 */
export const AdAvailabilitySupplySchema = AvailableAdCandidateSchema.omit({
  candidateKind: true,
  advertising: true,
  whyRetrieved: true,
});
export type AdAvailabilitySupply = Parsed<typeof AdAvailabilitySupplySchema>;

/**
 * A host/provider availability channel for the AVAILABLE lane. Channels
 * are composed at DEPLOYMENT time (buildProductionServer options /
 * handler wiring) — the lane performs no persistence, no discovery and
 * no rights inference. A channel's listSupply is evaluated fresh per
 * query at the CALLER-supplied clock; deterministic channel output
 * keeps the lane replay-stable.
 */
export interface AdAvailabilityChannel {
  /** Channel identity (host vocabulary) — names the channel in diagnostics. */
  readonly channelId: string;
  /**
   * Supply declarations for one tenant+subject at the caller clock.
   * Implementations MUST NOT persist anything and MUST keep the
   * availability claim their own (never the memory's — law 9).
   */
  listSupply(
    tenant: TenantScope,
    subject: SubjectReference,
    at: TimestampMs,
  ): Promise<readonly AdAvailabilitySupply[]>;
}

/* ------------------------------------------------------------------ *
 * Deterministic lexical term extraction (disclosed, no model)
 * ------------------------------------------------------------------ */

/**
 * Stopwords for raw query-text term extraction (deterministic, frozen
 * for replay stability — a change here changes disclosed terms). The
 * ad-lane noise words ("ad", "ads", …) are included: they carry no
 * discriminative signal over ad metadata.
 */
const AD_QUERY_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "of", "for", "in", "on", "at", "to", "by", "as", "is",
  "was", "were", "are", "be", "been", "am", "do", "does", "did", "have", "has", "had",
  "i", "we", "you", "he", "she", "it", "they", "me", "my", "our", "your", "us", "them",
  "this", "that", "these", "those", "there", "here", "what", "which", "who", "whom",
  "when", "where", "why", "how", "with", "from", "into", "about", "like", "want",
  "wants", "wanted", "need", "needs", "needed", "would", "could", "should", "can",
  "will", "shall", "may", "might", "must", "not", "no", "yes", "some", "any", "all",
  "show", "me", "find", "get", "give", "see", "saw", "seen", "look", "looking",
  "last", "this", "past", "week", "weeks", "month", "months", "year", "years", "day",
  "days", "today", "yesterday", "tomorrow", "ago", "recent", "recently", "please",
  "ad", "ads", "advert", "adverts", "advertisement", "advertisements",
]);

/** Extract deterministic lexical search terms from raw query text (disclosed on the result). */
export function extractAdQueryTerms(text: string | undefined): string[] {
  if (text === undefined || text.length === 0) return [];
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !AD_QUERY_STOPWORDS.has(token));
  return dedupeInOrder(tokens);
}

function dedupeInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Recursively collect string values from an opaque attributes payload (deterministic; keys sorted). */
function collectAttributeStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectAttributeStrings(entry, out);
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      collectAttributeStrings((value as Record<string, unknown>)[key], out);
    }
  }
}

/** The searchable metadata strings of a remembered memory record (lowercased by the matcher). */
function rememberedSearchStrings(record: {
  readonly ad: { readonly itemId: string; readonly labels: readonly string[]; readonly attributes: Record<string, unknown> };
  readonly realizations: readonly { kind: string }[];
  readonly lineage: {
    readonly source: string;
    readonly advertiserRef?: string;
    readonly campaignRef?: string;
    readonly creativeRefs: readonly string[];
  };
  readonly provenance:
    | { readonly kind: "observed-encounter"; readonly evidence: { readonly surface?: string } }
    | { readonly kind: "provider-supplied"; readonly availability: AdAvailability };
}): readonly string[] {
  const out: string[] = [record.ad.itemId, ...record.ad.labels];
  collectAttributeStrings(record.ad.attributes, out);
  for (const realization of record.realizations) out.push(realization.kind);
  out.push(record.lineage.source);
  if (record.lineage.advertiserRef !== undefined) out.push(record.lineage.advertiserRef);
  if (record.lineage.campaignRef !== undefined) out.push(record.lineage.campaignRef);
  out.push(...record.lineage.creativeRefs);
  if (record.provenance.kind === "observed-encounter" && record.provenance.evidence.surface !== undefined) {
    out.push(record.provenance.evidence.surface);
  }
  if (record.provenance.kind === "provider-supplied") out.push(record.provenance.availability.suppliedBy);
  return out;
}

/** The searchable metadata strings of a provider-supplied availability declaration. */
function supplySearchStrings(supply: {
  readonly ad: { readonly itemId: string; readonly labels: readonly string[]; readonly attributes: Record<string, unknown> };
  readonly realizations: readonly { kind: string }[];
  readonly availability: AdAvailability;
}): readonly string[] {
  const out: string[] = [supply.ad.itemId, ...supply.ad.labels];
  collectAttributeStrings(supply.ad.attributes, out);
  for (const realization of supply.realizations) out.push(realization.kind);
  out.push(supply.availability.suppliedBy);
  return out;
}

/** Case-insensitive substring match of every term against the searchable strings. */
function matchTerms(
  terms: readonly string[],
  searchStrings: readonly string[],
): { readonly matched: string[] } {
  const haystacks = searchStrings.map((value) => value.toLowerCase());
  const matched: string[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (haystacks.some((haystack) => haystack.includes(needle))) matched.push(term);
  }
  return { matched };
}

/** Case-insensitive exact membership for list filters (labels, surfaces). */
function matchesAnyInsensitive(filterValues: readonly string[], candidateValues: readonly (string | undefined)[]): string[] {
  const present = candidateValues.filter((value): value is string => value !== undefined);
  const matched: string[] = [];
  for (const filterValue of filterValues) {
    const needle = filterValue.toLowerCase();
    if (present.some((value) => value.toLowerCase() === needle)) matched.push(filterValue);
  }
  return matched;
}

/* ------------------------------------------------------------------ *
 * Filter evaluation (conjunctive across dimensions, any-of within a list)
 * ------------------------------------------------------------------ */

interface RememberedFilterInput {
  readonly record: {
    readonly recordId: string;
    readonly ad: { readonly itemId: string; readonly labels: readonly string[]; readonly attributes: Record<string, unknown> };
    readonly realizations: readonly { kind: string }[];
    readonly lineage: {
      readonly source: string;
      readonly advertiserRef?: string;
      readonly campaignRef?: string;
      readonly creativeRefs: readonly string[];
    };
    readonly provenance:
      | { readonly kind: "observed-encounter"; readonly evidence: { readonly surface?: string; readonly encounteredAt: number } }
      | { readonly kind: "provider-supplied"; readonly availability: AdAvailability };
  };
}

interface FilterOutcome {
  readonly included: boolean;
  readonly reasons: AdRetrievalReason[];
}

/** True when any remembered-lane filter dimension is active (drives store pushdown vs engine filtering). */
function rememberedFiltersActive(filters: AdQueryRequest["filters"]): boolean {
  return (
    filters.terms.length > 0 ||
    filters.labels.length > 0 ||
    filters.advertiserRefs.length > 0 ||
    filters.campaignRefs.length > 0 ||
    filters.surfaces.length > 0 ||
    filters.encounteredFrom !== undefined ||
    filters.encounteredUntil !== undefined
  );
}

/** Evaluate the structured filters against one remembered memory record. */
function evaluateRememberedFilters(
  filters: AdQueryRequest["filters"],
  terms: readonly string[],
  input: RememberedFilterInput,
): FilterOutcome {
  const reasons: AdRetrievalReason[] = [];
  const record = input.record;
  const searchStrings = rememberedSearchStrings(record);

  if (terms.length > 0) {
    const { matched } = matchTerms(terms, searchStrings);
    if (matched.length === 0) return { included: false, reasons: [] };
    reasons.push({
      kind: "query-match",
      detail: `matched terms: ${matched.join(", ")}`,
      score: matched.length / terms.length,
    });
  }
  if (filters.labels.length > 0) {
    const matched = matchesAnyInsensitive(filters.labels, record.ad.labels);
    if (matched.length === 0) return { included: false, reasons: [] };
    reasons.push({ kind: "label-match", detail: `matched labels: ${matched.join(", ")}` });
  }
  if (filters.advertiserRefs.length > 0) {
    if (record.lineage.advertiserRef === undefined) return { included: false, reasons: [] };
    if (!filters.advertiserRefs.includes(record.lineage.advertiserRef)) {
      return { included: false, reasons: [] };
    }
    reasons.push({ kind: "lineage-match", detail: `advertiser: ${record.lineage.advertiserRef}` });
  }
  if (filters.campaignRefs.length > 0) {
    if (record.lineage.campaignRef === undefined) return { included: false, reasons: [] };
    if (!filters.campaignRefs.includes(record.lineage.campaignRef)) {
      return { included: false, reasons: [] };
    }
    reasons.push({ kind: "lineage-match", detail: `campaign: ${record.lineage.campaignRef}` });
  }
  if (filters.surfaces.length > 0) {
    const surfaceCandidates: (string | undefined)[] = record.realizations.map((realization) => realization.kind);
    if (record.provenance.kind === "observed-encounter") {
      surfaceCandidates.push(record.provenance.evidence.surface);
    }
    const matched = matchesAnyInsensitive(filters.surfaces, surfaceCandidates);
    if (matched.length === 0) return { included: false, reasons: [] };
    reasons.push({ kind: "other", detail: `matched surfaces: ${matched.join(", ")}` });
  }
  if (filters.encounteredFrom !== undefined || filters.encounteredUntil !== undefined) {
    // The encounter window needs an observed encounter; host-seeded
    // provider-supplied memory carries none and cannot match.
    if (record.provenance.kind !== "observed-encounter") return { included: false, reasons: [] };
    const encounteredAt = record.provenance.evidence.encounteredAt;
    if (filters.encounteredFrom !== undefined && encounteredAt < filters.encounteredFrom) {
      return { included: false, reasons: [] };
    }
    if (filters.encounteredUntil !== undefined && encounteredAt > filters.encounteredUntil) {
      return { included: false, reasons: [] };
    }
    reasons.push({ kind: "temporal-match", detail: `encountered at ${encounteredAt} within the requested window` });
  }
  return { included: true, reasons };
}

/** Evaluate the structured filters against one provider-supplied availability declaration. */
function evaluateSupplyFilters(
  filters: AdQueryRequest["filters"],
  terms: readonly string[],
  supply: AdAvailabilitySupply,
): FilterOutcome {
  const reasons: AdRetrievalReason[] = [];
  const searchStrings = supplySearchStrings(supply);

  if (terms.length > 0) {
    const { matched } = matchTerms(terms, searchStrings);
    if (matched.length === 0) return { included: false, reasons: [] };
    reasons.push({
      kind: "query-match",
      detail: `matched terms: ${matched.join(", ")}`,
      score: matched.length / terms.length,
    });
  }
  if (filters.labels.length > 0) {
    const matched = matchesAnyInsensitive(filters.labels, supply.ad.labels);
    if (matched.length === 0) return { included: false, reasons: [] };
    reasons.push({ kind: "label-match", detail: `matched labels: ${matched.join(", ")}` });
  }
  if (filters.advertiserRefs.length > 0 || filters.campaignRefs.length > 0) {
    // The frozen AvailableAdCandidate carries NO lineage: an
    // availability declaration cannot satisfy a lineage filter — the
    // dimension excludes the candidate (never an invented match).
    return { included: false, reasons: [] };
  }
  if (filters.surfaces.length > 0) {
    const matched = matchesAnyInsensitive(
      filters.surfaces,
      supply.eligibility !== undefined ? supply.eligibility.surfaces : [],
    );
    if (matched.length === 0) return { included: false, reasons: [] };
    reasons.push({ kind: "other", detail: `matched surfaces: ${matched.join(", ")}` });
  }
  if (filters.encounteredFrom !== undefined || filters.encounteredUntil !== undefined) {
    // Availability declarations carry no encounter time — an
    // encounter-window filter excludes the whole available lane.
    return { included: false, reasons: [] };
  }
  return { included: true, reasons };
}

/* ------------------------------------------------------------------ *
 * Honest notes (what was NOT searched / could not be evaluated)
 * ------------------------------------------------------------------ */

const LEXICAL_MATCH_NOTE =
  "matching is lexical: terms are matched case-insensitively as substrings over ad metadata; no embedding model was consulted and 'semantic-match' reasons are never emitted by this deployment";
const NO_CHANNELS_NOTE =
  "no ad availability channels are configured in this deployment; the available lane is empty";
const ENCOUNTER_FILTER_NOTE =
  "encounteredFrom/Until filters apply to observed encounters (remembered lane); provider-supplied availability carries no encounter time and cannot match an encounter-window filter";
const LINEAGE_FILTER_NOTE =
  "lineage filters (advertiserRefs/campaignRefs) apply to remembered ad lineage; provider-supplied availability carries no lineage and cannot match a lineage filter";
const CONTEXT_NOTE =
  "context was accepted by reference only; no contextual matching was applied by this deployment and 'contextual-match' reasons are never emitted";
const NO_TERMS_NOTE =
  "query text yielded no usable search terms after stopword removal; the text constrained nothing";

/* ------------------------------------------------------------------ *
 * Pre-parse lane drafts (the frozen result schema is the boundary)
 * ------------------------------------------------------------------ */

/**
 * Draft shape of a remembered candidate BEFORE the frozen result
 * parse: the store returns the wide `AdMemoryRecord` (its runtime gates
 * guarantee structurally-active retention); the final
 * `AdQueryResultSchema` parse (which embeds
 * `RetrievableAdMemoryRecordSchema`) is the authoritative narrowing —
 * laws 2/3 stay structurally enforced on the way out.
 */
interface RememberedCandidateDraft {
  readonly candidateKind: "remembered";
  readonly advertising: true;
  readonly record: AdMemoryRecord;
  readonly whyRetrieved: AdRetrievalReason[];
}

/** Draft shape of an available candidate before the frozen result parse. */
interface AvailableCandidateDraft {
  readonly candidateKind: "available";
  readonly advertising: true;
  readonly ad: AdCatalogItem;
  readonly realizations: Realization[];
  readonly availability: AdAvailability;
  readonly rights: AdRightsConstraints;
  readonly memoryRecordId?: string;
  readonly eligibility?: AdEligibility;
  readonly userValue?: AdUserValueAssessment;
  readonly commercialValue?: AdCommercialValueAssessment;
  readonly whyRetrieved: AdRetrievalReason[];
}

/* ------------------------------------------------------------------ *
 * The runtime ad-retrieval handler (composition mounts this)
 * ------------------------------------------------------------------ */

export interface AdRetrievalRuntimeOptions {
  /** The AD-002 Personal Ad Memory store port (production: PgAdMemoryStore). */
  readonly store: AdMemoryStore;
  /** Host/provider availability channels for the available lane (none = honest empty lane + note). */
  readonly channels?: readonly AdAvailabilityChannel[];
}

/**
 * Build the runtime AdRetrievalHandler: remembered lane through the
 * AD-002 store port, available lane through the composed availability
 * channels, both at the caller-supplied clock. No ranking authority in
 * the remembered lane (law 7 — the store's chronological order is kept
 * verbatim); no persistence in the available lane (law 9 — disclosed
 * provider provenance only).
 */
export function createRuntimeAdRetrievalHandler(options: AdRetrievalRuntimeOptions): AdRetrievalHandler {
  const channels: readonly AdAvailabilityChannel[] = options.channels ?? [];
  return {
    query: async (request: AdQueryRequest, _auth: AuthContext): Promise<AdQueryResult> => {
      // The route pipeline validated the request through the frozen
      // AdQueryRequestSchema (including the tenant check); re-parse is
      // the store's own boundary discipline, not duplicated here.
      const wantsRemembered = request.mode === "remembered" || request.mode === "both";
      const wantsAvailable = request.mode === "available" || request.mode === "both";
      const filters = request.filters;
      const textTerms = extractAdQueryTerms(request.text);
      // Effective terms = filters.terms (host/adapter-expanded lexical
      // terms) ∪ extracted raw-text terms — the DISCLOSED set.
      const terms = dedupeInOrder([...filters.terms.map((term) => term.toLowerCase()), ...textTerms]);
      const unconstrained =
        terms.length === 0 &&
        filters.labels.length === 0 &&
        filters.advertiserRefs.length === 0 &&
        filters.campaignRefs.length === 0 &&
        filters.surfaces.length === 0 &&
        filters.encounteredFrom === undefined &&
        filters.encounteredUntil === undefined;

      const notes: string[] = [];
      if (request.text !== undefined && textTerms.length === 0) notes.push(NO_TERMS_NOTE);
      if (terms.length > 0) notes.push(LEXICAL_MATCH_NOTE);
      if (request.context !== undefined) notes.push(CONTEXT_NOTE);
      const encounterFilterActive =
        filters.encounteredFrom !== undefined || filters.encounteredUntil !== undefined;
      const lineageFilterActive =
        filters.advertiserRefs.length > 0 || filters.campaignRefs.length > 0;
      if (wantsAvailable && encounterFilterActive) notes.push(ENCOUNTER_FILTER_NOTE);
      if (wantsAvailable && lineageFilterActive) notes.push(LINEAGE_FILTER_NOTE);

      // ---- remembered lane (Personal Ad Memory through the store port) ----
      const remembered: RememberedCandidateDraft[] = [];
      // itemId → recordId of the CURRENT remembered record (the AD-002
      // (subject, itemId) upsert policy guarantees one current record per
      // ad) — powers the optional available-candidate memory link.
      const rememberedRecordIdByItemId = new Map<string, string>();
      if (wantsRemembered) {
        // Filter pushdown decision: with NO route filters the store's
        // own limit pushdown is exact; with filters active the store
        // cannot pre-filter (AD-003 owns query semantics), so the full
        // current lane is fetched and filtered here, then capped.
        const filtersActive = rememberedFiltersActive(filters) || terms.length > 0;
        const storeOptions =
          !filtersActive && filters.limit !== undefined ? { limit: filters.limit } : {};
        const records = await options.store.listRemembered(
          request.tenant,
          request.subject,
          request.at,
          storeOptions,
        );
        for (const record of records) {
          const outcome = filtersActive
            ? evaluateRememberedFilters(filters, terms, { record })
            : { included: true, reasons: [] as AdRetrievalReason[] };
          if (!outcome.included) continue;
          // Law 7 (no ranking authority in the remembered lane): the
          // store's deterministic chronological order is preserved
          // VERBATIM — candidates are appended in store order and never
          // re-sorted, even when a lexical score hint is attached.
          remembered.push({
            candidateKind: "remembered",
            advertising: true,
            record,
            whyRetrieved:
              outcome.reasons.length > 0
                ? outcome.reasons
                : [
                    {
                      kind: "user-requested",
                      detail: "no query constraints — remembered ads in deterministic chronological order",
                    },
                  ],
          });
          if (!rememberedRecordIdByItemId.has(record.ad.itemId)) {
            rememberedRecordIdByItemId.set(record.ad.itemId, record.recordId);
          }
        }
        if (filters.limit !== undefined) {
          remembered.length = Math.min(remembered.length, filters.limit);
        }
      }
      // ---- available lane (host/provider availability channels) ----
      const available: AvailableCandidateDraft[] = [];
      if (wantsAvailable) {
        if (channels.length === 0) {
          notes.push(NO_CHANNELS_NOTE);
        }
        let windowExcluded = 0;
        for (const channel of channels) {
          const supplies = await channel.listSupply(request.tenant, request.subject, request.at);
          for (const rawSupply of supplies) {
            // Boundary validation through the frozen contract
            // (composition-level failure — a channel that supplies
            // garbage is a deployment integrity failure, never a
            // silent pass).
            const parsedSupply = AdAvailabilitySupplySchema.safeParse(rawSupply);
            if (!parsedSupply.success) {
              throw new ApiError(
                ERROR_CODES.INTERNAL,
                500,
                `ad availability channel '${channel.channelId}' supplied a declaration that failed the frozen AdAvailability surface: ${parsedSupply.error.issues
                  .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
                  .join("; ")}`,
                { channelId: channel.channelId },
              );
            }
            const supply = parsedSupply.data;
            // Law 3: an ad past its availability window (the channel's
            // declaration AND the ad's own catalog window) cannot be
            // presented as currently available — evaluated against the
            // CALLER clock.
            if (!isAdCandidateCurrentlyAvailable(supply, request.at)) {
              windowExcluded += 1;
              continue;
            }
            const outcome = evaluateSupplyFilters(filters, terms, supply);
            if (!outcome.included) continue;
            const reasons: AdRetrievalReason[] = [
              {
                kind: "provider-supplied",
                detail: `supplied by ${supply.availability.suppliedBy}`,
              },
              ...outcome.reasons,
            ];
            if (unconstrained) {
              reasons.push({
                kind: "user-requested",
                detail: "no query constraints — provider-supplied availability in channel declaration order",
              });
            }
            // Optional memory link (mode both only — the remembered
            // lane is the memory truth for this subject): a current
            // remembered record of the SAME ad links by itemId; a
            // channel-supplied link is kept verbatim otherwise.
            const currentMemoryRecordId = rememberedRecordIdByItemId.get(supply.ad.itemId);
            const memoryRecordId = currentMemoryRecordId ?? supply.memoryRecordId;
            available.push({
              candidateKind: "available",
              advertising: true,
              ad: supply.ad,
              realizations: supply.realizations,
              availability: supply.availability,
              rights: supply.rights,
              ...(memoryRecordId !== undefined ? { memoryRecordId } : {}),
              ...(supply.eligibility !== undefined ? { eligibility: supply.eligibility } : {}),
              ...(supply.userValue !== undefined ? { userValue: supply.userValue } : {}),
              ...(supply.commercialValue !== undefined ? { commercialValue: supply.commercialValue } : {}),
              whyRetrieved: reasons,
            });
          }
        }
        if (windowExcluded > 0) {
          notes.push(
            `${windowExcluded} provider-supplied ad${windowExcluded === 1 ? "" : "s"} excluded: the availability window was closed at the query clock (at ${request.at})`,
          );
        }
        // The frozen filter contract caps EACH provenance lane
        // ("Maximum candidates per provenance lane") — cap the available
        // lane in channel declaration order (never re-sorted).
        if (filters.limit !== undefined) {
          available.length = Math.min(available.length, filters.limit);
        }
      }

      // Final boundary parse through the frozen result contract (mode
      // consistency, structural activeness of embedded records — laws
      // 2/3/8/9 re-asserted structurally on the way out).
      const parsed = AdQueryResultSchema.safeParse({
        schema: "reckon.ad-query-result",
        schemaVersion: "0.1.0",
        queryId: request.queryId,
        tenant: request.tenant,
        mode: request.mode,
        at: request.at,
        remembered,
        available,
        queryUnderstanding: { terms },
        notes,
      });
      if (!parsed.success) {
        throw new ApiError(
          ERROR_CODES.INTERNAL,
          500,
          `ad retrieval produced a result that failed the frozen AdQueryResult contract: ${parsed.error.issues
            .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
            .join("; ")}`,
        );
      }
      return parsed.data;
    },

    forget: async (request: AdForgetRequest, _auth: AuthContext): Promise<AdForgetResult> => {
      // The AD-002 store owns forget semantics entirely: terminal
      // `forgotten` retention (basis carried — law 1), row-level
      // idempotency, audit-preserving tombstones (law 2). The route
      // validated the request through the frozen contract; the store
      // re-parses at its own boundary and scopes by tenant+subject.
      return options.store.forget(request);
    },
  };
}
