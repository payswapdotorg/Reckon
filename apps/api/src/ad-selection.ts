/**
 * AD-004 — contextual ad SELECTION composition (the decision-side
 * companion to AD-003's retrieval, `apps/api/src/ad-retrieval.ts`).
 *
 * LAWS this module lives under (architecture lock + ADR-005):
 *
 * - NO SECOND RANKING (lock "no second recommendation authority"):
 *   this module has ZERO scoring logic. It resolves ad-lane catalog
 *   truth (items, realizations, projected eligibility constraints) for
 *   candidates the HOST declared in a DecisionRequest, and the ONE
 *   kernel chain (normalize → expand → policy → scheduler) treats ad
 *   candidates as ordinary candidates carrying provenance (their
 *   `source` is the frozen ad-lane source vocabulary).
 * - LAW 3 (expired ≠ currently available): candidacy truth is gated by
 *   the FROZEN runtime helpers (`isAdAvailableAt`,
 *   `isAdCandidateCurrentlyAvailable`) at the CALLER-supplied request
 *   clock — the same gates AD-003 applies at the query boundary.
 * - LAW 7 (value separation): nothing here reads or derives commercial
 *   value; ranking stays with the policy engine over host-declared
 *   evidence only.
 * - LAW 5 (no raw context persistence): context is only ever the
 *   request's own ContextReference; this module never touches context
 *   content.
 * - DETERMINISM: every temporal evaluation runs against the caller
 *   clock `at`; there is no wall-clock read anywhere in this file.
 *
 * The host-facing PURE helper for building ad-bearing candidate sets
 * from an `AdQueryResult` lives in `@reckon/sdk`
 * (`buildAdBearingCandidates`) — hosts declare ad candidacy in the
 * request's candidate set; THIS module resolves the ad-lane truth those
 * declared candidates need (the remembered lane through the AD-002
 * store port, the available lane through the composed availability
 * channels — the same two sources AD-003 queries).
 */
import {
  AD_CANDIDATE_SOURCES,
  adEligibilityToConstraints,
  isAdAvailableAt,
  isAdCandidateCurrentlyAvailable,
  type AdEligibility,
  type CatalogItem,
  type HardConstraint,
  type Realization,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import type { AdMemoryStore } from "@reckon/persistence";
import { ApiError, ERROR_CODES } from "./errors.js";
import { AdAvailabilitySupplySchema, type AdAvailabilityChannel } from "./ad-retrieval.js";

/* ------------------------------------------------------------------ *
 * Ad-lane candidate sources (frozen vocabulary — law 9 provenance)
 * ------------------------------------------------------------------ */

/**
 * The candidate `source` values that declare AD CANDIDACY in a
 * DecisionRequest — exactly the frozen `AD_CANDIDATE_SOURCES` the
 * contracts' `adCandidatesToCandidateSet` emits (and the SDK's
 * `buildAdBearingCandidates` mirrors). Any other source is an organic
 * candidate and never touches the ad lane.
 */
export const AD_SELECTION_SOURCES: ReadonlySet<string> = new Set<string>([
  AD_CANDIDATE_SOURCES.remembered,
  AD_CANDIDATE_SOURCES.available,
]);

/** Does this candidate source declare ad candidacy (ad-lane provenance)? */
export function isAdCandidateSource(source: string): boolean {
  return AD_SELECTION_SOURCES.has(source);
}

/* ------------------------------------------------------------------ *
 * The ad-selection truth port
 * ------------------------------------------------------------------ */

/**
 * The ad-lane catalog truth resolved for one decision request's declared
 * ad candidates: the ad items + realizations (the same shapes the
 * normalizer/expander consume for organic items — an `AdCatalogItem` IS
 * a `CatalogItem` narrowed to `kind: "advertising"`), plus the per-item
 * hard constraints projected from declared ad eligibility
 * (`adEligibilityToConstraints` — flight window → `time-window`,
 * gates → `policy-rights`; the portable parts only, per ADR-005).
 *
 * Constraint merge semantics (documented): when an item is declared by
 * BOTH lanes, the projected constraint LISTS are unioned — two
 * `time-window` constraints AND together (the honest intersection of
 * the lanes' windows) and gate lists accumulate. Surfaces and host
 * frequency policy stay host-evaluated (W3-008 host-authority law) and
 * intentionally do not project.
 */
export interface AdSelectionTruth {
  /** Ad items resolved for the declared candidates (deduped by itemId, remembered lane first). */
  readonly items: readonly CatalogItem[];
  /** Ad realizations resolved for the declared candidates (deduped by realizationId). */
  readonly realizations: readonly Realization[];
  /** Per-item hard constraints projected from declared ad eligibility. */
  readonly itemConstraints: Readonly<Record<string, readonly HardConstraint[]>>;
  /** Honest disclosures (window-closed exclusions, unresolvable candidates). */
  readonly notes: readonly string[];
}

/** One ad-truth resolution request (every field from the DecisionRequest). */
export interface AdSelectionResolveInput {
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  /** The request's caller-supplied clock (law 3; never invented here). */
  readonly at: TimestampMs;
  /** The itemIds the request declared as ad candidates. */
  readonly itemIds: readonly string[];
}

/**
 * The ad-selection source port (composition seam): resolves ad-lane
 * truth for declared ad candidates. Production wiring is
 * `createAdSelectionSource({ store, channels })`; tests may substitute
 * any implementation.
 */
export interface AdSelectionSource {
  resolve(input: AdSelectionResolveInput): Promise<AdSelectionTruth>;
}

/* ------------------------------------------------------------------ *
 * Deterministic helpers
 * ------------------------------------------------------------------ */

/** Deterministic constraint-list union: dedupes identical constraints, order-preserving (first occurrence first). */
function unionConstraints(
  existing: readonly HardConstraint[],
  incoming: readonly HardConstraint[],
): HardConstraint[] {
  const seen = new Set<string>(existing.map(canonicalConstraintKey));
  const out: HardConstraint[] = [...existing];
  for (const constraint of incoming) {
    const key = canonicalConstraintKey(constraint);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(constraint);
  }
  return out;
}

/** Canonical dedup key for a hard constraint (kind + sorted params). */
function canonicalConstraintKey(constraint: HardConstraint): string {
  const entries = Object.entries(constraint as unknown as Record<string, unknown>)
    .filter(([key]) => key !== "kind")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .sort();
  return [constraint.kind, ...entries].join("|");
}

/* ------------------------------------------------------------------ *
 * The production ad-selection source (memory + availability channels)
 * ------------------------------------------------------------------ */

/**
 * Build the production AdSelectionSource: the remembered lane through
 * the AD-002 store port (`listRemembered` at the caller clock — the
 * store owns every ad-memory privacy law at its boundary and this
 * module never re-implements or weakens them), the available lane
 * through the composed host/provider availability channels (validated
 * through the frozen `AdAvailabilitySupply` surface — a channel
 * supplying garbage is a typed 500 deployment-integrity failure, the
 * same discipline as AD-003).
 *
 * Availability gating (law 3): every resolved ad must pass the frozen
 * window gates at the request clock — `isAdAvailableAt` for remembered
 * records, `isAdCandidateCurrentlyAvailable` for channel supply.
 * Window-closed ads are NOT resolvable as candidacy truth (reported in
 * `notes`, never silently dropped).
 */
export function createAdSelectionSource(options: {
  readonly store: AdMemoryStore;
  readonly channels?: readonly AdAvailabilityChannel[];
}): AdSelectionSource {
  const channels: readonly AdAvailabilityChannel[] = options.channels ?? [];
  return {
    resolve: async (input: AdSelectionResolveInput): Promise<AdSelectionTruth> => {
      const wanted = new Set(input.itemIds);
      const notes: string[] = [];

      const itemsById = new Map<string, CatalogItem>();
      const realizationsById = new Map<string, Realization>();
      const itemConstraints: Record<string, readonly HardConstraint[]> = {};

      const addItem = (item: CatalogItem): void => {
        if (!itemsById.has(item.itemId)) itemsById.set(item.itemId, item);
      };
      const addRealizations = (realizations: readonly Realization[]): void => {
        for (const realization of realizations) {
          if (!realizationsById.has(realization.realizationId)) {
            realizationsById.set(realization.realizationId, realization);
          }
        }
      };
      const addEligibility = (itemId: string, eligibility: AdEligibility | undefined): void => {
        if (eligibility === undefined) return;
        const projected = adEligibilityToConstraints(eligibility);
        if (projected.length === 0) return;
        itemConstraints[itemId] = unionConstraints(
          (itemConstraints[itemId] ?? []) as readonly HardConstraint[],
          projected,
        );
      };

      // ---- remembered lane (Personal Ad Memory through the store port) ----
      // listRemembered is the store's own gated read: structurally-active,
      // permission-passing (retain AND present), unexpired against `at`,
      // current (unsuperseded) — this module adds ONLY the ad-window gate.
      const remembered = await options.store.listRemembered(input.tenant, input.subject, input.at);
      const rememberedResolved = new Set<string>();
      for (const record of remembered) {
        if (!wanted.has(record.ad.itemId)) continue;
        if (!isAdAvailableAt(record.ad, input.at)) {
          notes.push(
            `remembered ad ${record.ad.itemId} excluded: the ad's own catalog window is closed at the request clock (at ${input.at})`,
          );
          continue;
        }
        addItem(record.ad);
        addRealizations(record.realizations);
        rememberedResolved.add(record.ad.itemId);
        // Remembered records carry no eligibility declaration (the frozen
        // AdMemoryRecord has no eligibility field) — nothing projects.
      }

      // ---- available lane (host/provider availability channels) ----
      const availableResolved = new Set<string>();
      for (const channel of channels) {
        const supplies = await channel.listSupply(input.tenant, input.subject, input.at);
        for (const rawSupply of supplies) {
          // Boundary validation through the frozen contract surface (the
          // same discipline as the AD-003 available lane).
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
          if (!wanted.has(supply.ad.itemId)) continue;
          if (!isAdCandidateCurrentlyAvailable(supply, input.at)) {
            notes.push(
              `provider-supplied ad ${supply.ad.itemId} excluded: the availability window was closed at the request clock (at ${input.at})`,
            );
            continue;
          }
          addItem(supply.ad);
          addRealizations(supply.realizations);
          addEligibility(supply.ad.itemId, supply.eligibility);
          availableResolved.add(supply.ad.itemId);
        }
      }

      // ---- honest absence for unresolvable declared candidates ----
      const resolved = new Set<string>([...rememberedResolved, ...availableResolved]);
      const unresolvable = input.itemIds.filter((itemId) => !resolved.has(itemId));
      if (unresolvable.length > 0) {
        notes.push(
          `ad candidate(s) with no resolvable ad-lane truth (not in current memory or channel supply at the request clock): ${unresolvable.join(", ")}`,
        );
      }
      if (channels.length === 0) {
        notes.push("no ad availability channels are configured; the available lane resolves nothing");
      }

      return {
        items: [...itemsById.values()],
        realizations: [...realizationsById.values()],
        itemConstraints,
        notes,
      };
    },
  };
}
