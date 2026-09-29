/**
 * W2-001 — Candidate normalization.
 *
 * Frozen architecture §6 (candidate/experience separation): the host's
 * candidate retrieval and the decision policy are NOT the same thing.
 * This module normalizes provider-neutral `CandidateReference`s from one
 * or more retrieval sources into `NormalizedCandidate` records that the
 * experience expander (W2-003) and the policy engine (W2-002) consume.
 *
 * Laws enforced here:
 * - HONEST-ABSENCE LAW: an item without a matching realization in the
 *   input is normalized with `available: false` — never invented.
 * - Purity and totality: no environment reads, no async, no exceptions
 *   on valid input; invalid input returns a typed error result.
 * - Determinism: same inputs ⇒ byte-identical outputs (canonical key
 *   construction, dedup, and ordering — digest-testable).
 */
import {
  canonicalJson,
  CatalogItemSchema,
  CandidateSetSchema,
  RealizationSchema,
  TenantScopeSchema,
  type CatalogItem,
  type CandidateSet,
  type Id,
  type Realization,
  type TenantScope,
} from "@reckon/contracts";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";

/** Input to normalization: the raw candidate set plus the host-declared
 *  catalog/realization truth for this request. */
export interface NormalizeInput {
  candidates: CandidateSet;
  items: CatalogItem[];
  realizations: Realization[];
  tenant: TenantScope;
}

/** Why a normalized candidate is not available (honest absence). */
export type UnavailabilityReason = "no-catalog-item" | "no-realization";

export interface CandidateAvailability {
  available: boolean;
  /** Present only when `available` is false — the honest reason. */
  reason?: UnavailabilityReason;
}

/**
 * Provider-neutral normalized candidate record.
 *
 * - `key` — canonical dedup key for the (itemId, source) pair
 *   (canonical JSON of the pair; collision-free and deterministic).
 * - `realizationIds` — the input realizations matched for this item,
 *   sorted and deduplicated (host capability truth only).
 * - `rankHint` / `scoreHint` — host retrieval hints, never decisions.
 * - `labels` — the catalog item's labels, deduplicated and sorted.
 * - `availability` — host capability truth; `available` requires BOTH a
 *   matching catalog item and at least one matching realization.
 */
export interface NormalizedCandidate {
  key: string;
  itemId: Id;
  realizationIds: Id[];
  source: string;
  rankHint?: number;
  scoreHint?: number;
  labels: string[];
  availability: CandidateAvailability;
}

export type NormalizeResult = Result<NormalizedCandidate[]>;

/** The normalization port (W2-001). Pure, total, deterministic. */
export interface CandidateNormalizer {
  normalize(input: NormalizeInput): NormalizeResult;
}

/** Merge rule for numeric hints across duplicate (itemId, source)
 *  candidates: the maximum of the supplied values (strongest host
 *  hint); absent when none supplied. */
function mergeMax(existing: number | undefined, incoming: number | undefined): number | undefined {
  if (existing === undefined) return incoming;
  if (incoming === undefined) return existing;
  return existing >= incoming ? existing : incoming;
}

/** Canonical dedup key for a (itemId, source) pair. */
function candidateKey(itemId: string, source: string): string {
  return canonicalJson([itemId, source]);
}

/**
 * Deterministic output ordering: rankHint descending (absent hints sort
 * last), then itemId ascending, then source ascending — all comparisons
 * by UTF-16 code units (locale-independent, byte-stable).
 */
function compareNormalized(a: NormalizedCandidate, b: NormalizedCandidate): number {
  const rankA = a.rankHint ?? Number.NEGATIVE_INFINITY;
  const rankB = b.rankHint ?? Number.NEGATIVE_INFINITY;
  if (rankA !== rankB) return rankB - rankA;
  if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return 0;
}

function dedupeSorted(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/** Pure, total, deterministic normalization (the W2-001 kernel). */
export function normalizeCandidates(input: NormalizeInput): NormalizeResult {
  if (input === null || typeof input !== "object") {
    return invalidInput("normalize: input must be an object");
  }
  const parsedCandidates = CandidateSetSchema.safeParse(input.candidates);
  if (!parsedCandidates.success) {
    return invalidInput(
      "normalize: invalid candidate set",
      parsedCandidates.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  if (parsedCandidates.data.candidates.length === 0) {
    // Unreachable when the schema is respected (min(1)); kept as an
    // explicit honest guard for the empty-candidates typed error.
    return invalidInput("normalize: empty candidates");
  }
  const parsedItems = CatalogItemSchema.array().safeParse(input.items ?? []);
  if (!parsedItems.success) {
    return invalidInput(
      "normalize: invalid catalog items",
      parsedItems.error.issues.map((i) => ({ path: `items.${i.path.join(".")}`, message: i.message })),
    );
  }
  const parsedRealizations = RealizationSchema.array().safeParse(input.realizations ?? []);
  if (!parsedRealizations.success) {
    return invalidInput(
      "normalize: invalid realizations",
      parsedRealizations.error.issues.map((i) => ({
        path: `realizations.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  }
  const parsedTenant = TenantScopeSchema.safeParse(input.tenant);
  if (!parsedTenant.success) {
    return invalidInput(
      "normalize: invalid tenant scope",
      parsedTenant.error.issues.map((i) => ({ path: `tenant.${i.path.join(".")}`, message: i.message })),
    );
  }

  // Host truth indexes. First occurrence wins on duplicate ids
  // (deterministic regardless of input array order).
  const itemsById = new Map<string, CatalogItem>();
  for (const item of parsedItems.data) {
    if (!itemsById.has(item.itemId)) itemsById.set(item.itemId, item);
  }
  const realizationsById = new Map<string, Realization>();
  for (const realization of parsedRealizations.data) {
    if (!realizationsById.has(realization.realizationId)) {
      realizationsById.set(realization.realizationId, realization);
    }
  }
  const realizationIdsByItem = new Map<string, Set<string>>();
  for (const realization of parsedRealizations.data) {
    let set = realizationIdsByItem.get(realization.itemId);
    if (!set) {
      set = new Set<string>();
      realizationIdsByItem.set(realization.itemId, set);
    }
    set.add(realization.realizationId);
  }

  // Merge candidates by canonical (itemId, source) key.
  const merged = new Map<string, NormalizedCandidate>();
  for (const candidate of parsedCandidates.data.candidates) {
    const key = candidateKey(candidate.itemId, candidate.source);
    const forItem = realizationIdsByItem.get(candidate.itemId) ?? new Set<string>();
    // Realizations matched by THIS candidate: its explicit preferences
    // intersected with host truth, or all host realizations for the item
    // when no preference is expressed (the resolver may expand others).
    const matched =
      candidate.realizationIds.length > 0
        ? candidate.realizationIds.filter((rid) => forItem.has(rid))
        : Array.from(forItem);

    const existing = merged.get(key);
    if (!existing) {
      const mergedIds = dedupeSorted(matched);
      const item = itemsById.get(candidate.itemId);
      const available = item !== undefined && mergedIds.length > 0;
      merged.set(key, {
        key,
        itemId: candidate.itemId,
        realizationIds: mergedIds,
        source: candidate.source,
        rankHint: candidate.rankHint,
        scoreHint: candidate.scoreHint,
        labels: item ? dedupeSorted(item.labels) : [],
        availability: available
          ? { available: true }
          : {
              available: false,
              reason: item === undefined ? "no-catalog-item" : "no-realization",
            },
      });
    } else {
      // Duplicate (itemId, source): union the matched realizations and
      // take the strongest hints. Deterministic (order-independent).
      const union = dedupeSorted([...existing.realizationIds, ...matched]);
      const item = itemsById.get(candidate.itemId);
      const available = item !== undefined && union.length > 0;
      const rankHint = mergeMax(existing.rankHint, candidate.rankHint);
      const scoreHint = mergeMax(existing.scoreHint, candidate.scoreHint);
      const next: NormalizedCandidate = {
        key,
        itemId: existing.itemId,
        realizationIds: union,
        source: existing.source,
        labels: item ? dedupeSorted(item.labels) : [],
        availability: available
          ? { available: true }
          : {
              available: false,
              reason: item === undefined ? "no-catalog-item" : "no-realization",
            },
      };
      if (rankHint !== undefined) next.rankHint = rankHint;
      if (scoreHint !== undefined) next.scoreHint = scoreHint;
      merged.set(key, next);
    }
  }

  const output = Array.from(merged.values()).sort(compareNormalized);
  return { ok: true, value: output };
}

/** Factory for the stateless normalizer port. */
export function createCandidateNormalizer(): CandidateNormalizer {
  return { normalize: normalizeCandidates };
}
