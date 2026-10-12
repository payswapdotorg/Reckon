/**
 * AD-004 — the ad-encounter MEMORY CAPTURE: observed outcome events for
 * ad experiences flow back into Personal Ad Memory through the AD-002
 * store port (the provenance + memory round-trip).
 *
 * Pipeline position (append-only, after the outcome is durable):
 *
 *   Decision (ad experience selected by the ONE kernel chain)
 *     → host presents → host reports an OutcomeEvent (e.g. impression)
 *     → POST /v1/outcomes (the EXISTING outcome surface — unchanged)
 *     → [this module] the composition captures the encounter:
 *         evidence = the observed outcome event itself (law 10),
 *         context by reference only (law 5),
 *         retention basis = the deployment-declared policy (law 1),
 *         → finalizeAdMemoryRecord → AdMemoryStore.put
 *     → the ad becomes a remembered candidate for later queries
 *       (AD-003) and decisions (AD-004 selection).
 *
 * LAWS (ADR-005 — enforced at every boundary touched here):
 * - LAW 1: the capture policy REQUIRES an explicit retention basis —
 *   the composition refuses to build a record without one (there is no
 *   default; a deployment that wants memory capture declares its basis).
 * - LAW 2: terminal forget is the STORE's (AD-002); nothing here can
 *   resurrect, and re-encounters after a forget are new records.
 * - LAW 5: context rides the event's own ContextReference — no raw
 *   location/attention/sensor value ever enters a memory record here.
 * - LAW 8: only `kind: "advertising"` items are capturable (the frozen
 *   AdCatalogItem narrowing; the resolver port returns ad items).
 * - LAW 9: the capture provenance is ALWAYS `observed-encounter` — the
 *   evidence is the real outcome event, never a provider declaration.
 * - LAW 10: ONLY observed evidence classes are captured — simulated,
 *   counterfactual and fixture events are typed SKIPS (never memory).
 *
 * DETERMINISM: every timestamp is the event's own caller-supplied
 * `occurredAt`; the memory write's idempotency key is the event's own
 * `idempotencyKey` (a replayed event replays the same memory write).
 * No wall-clock read anywhere in this file.
 */
import {
  FORMAT_KINDS,
  OBSERVED_EVIDENCE_CLASSES,
  finalizeAdMemoryRecord,
  type AdCatalogItem,
  type AdLineage,
  type AdMemoryRecord,
  type AdRetentionBasis,
  type AdRightsConstraints,
  type OutcomeEvent,
  type OutcomeEventType,
  type Realization,
} from "@reckon/contracts";
import { experienceIdFor } from "@reckon/experience";
import type { AdMemoryPutResult, AdMemoryStore } from "@reckon/persistence";
import { AdAvailabilitySupplySchema, type AdAvailabilityChannel } from "./ad-retrieval.js";

/* ------------------------------------------------------------------ *
 * Capture policy + resolver ports
 * ------------------------------------------------------------------ */

/**
 * The deployment-declared capture policy (law 1: the retention basis is
 * REQUIRED — never defaulted; a host that wants ad-memory capture
 * declares under which basis encounters are retained).
 */
export interface AdEncounterCapturePolicy {
  /** Which outcome event types count as ad encounters (default: impression). */
  readonly eventTypes?: readonly OutcomeEventType[];
  /** REQUIRED explicit retention basis (law 1). */
  readonly retentionBasis: AdRetentionBasis;
  /** Initial permission state of captured records (default: granted/granted). */
  readonly permissions?: { readonly retain: "granted" | "revoked"; readonly present: "granted" | "revoked" };
}

/** The ad context a resolver returns for an encountered experience. */
export interface AdEncounterContext {
  /** The encountered ad (kind is structurally "advertising" — law 8). */
  readonly ad: AdCatalogItem;
  /** The ad's realizations (the encounter's experience came from one of them). */
  readonly realizations: readonly Realization[];
  /** Host-owned ad lineage (identity stays host-authoritative). */
  readonly lineage: AdLineage;
  /** Rights constraints carried verbatim (law 4 — never inferred here). */
  readonly rights: AdRightsConstraints;
  /** Host surface vocabulary where the encounter happened (optional). */
  readonly surface?: string;
}

/**
 * The encounter-resolver port: maps an observed outcome event to the ad
 * it encountered (by the event's experienceId). Deployments with their
 * own ad registries may substitute any implementation; the default
 * (`createAdEncounterResolver`) resolves from the SAME two ad-lane
 * sources AD-003/AD-004 read (memory + availability channels).
 */
export interface AdEncounterResolver {
  resolveAd(event: OutcomeEvent): Promise<AdEncounterContext | null>;
}

/** The capture outcome (honest — skips are reasons, never silent). */
export interface AdEncounterCaptureResult {
  readonly captured: boolean;
  /** Why the event was skipped (present iff not captured). */
  readonly reason?: string;
  /** The store's put result (present iff captured). */
  readonly put?: AdMemoryPutResult;
  /** The record the capture wrote (present iff captured and not a tombstone duplicate). */
  readonly record?: AdMemoryRecord | null;
}

/* ------------------------------------------------------------------ *
 * The default resolver (memory + availability channels, by experienceId)
 * ------------------------------------------------------------------ */

/**
 * Build the default AdEncounterResolver: current Personal Ad Memory
 * (through the AD-002 store port, at the event's own clock — retention,
 * permissions and expiry stay store-gated) plus the composed
 * availability channels (validated through the frozen surface, the
 * AD-003 discipline). The event's `experienceId` is matched by
 * computing the SAME deterministic experience id the expander emits
 * (`experienceIdFor` — never a second id scheme) over every
 * realization × format-kind of every resolvable ad.
 *
 * AVAILABILITY IS NOT GATED HERE (deliberate): an impression of an ad
 * whose serving window has closed is still a legitimate encounter to
 * remember — memory ≠ availability (law 3 separates them). Channel
 * lineage for provider-supplied ads is the honest channel identity
 * (`availability.suppliedBy`) — the host ad system remains the identity
 * authority.
 */
export function createAdEncounterResolver(options: {
  readonly store: AdMemoryStore;
  readonly channels?: readonly AdAvailabilityChannel[];
}): AdEncounterResolver {
  const channels: readonly AdAvailabilityChannel[] = options.channels ?? [];
  return {
    resolveAd: async (event: OutcomeEvent): Promise<AdEncounterContext | null> => {
      if (event.experienceId === undefined) return null;
      const contextByExperienceId = new Map<string, AdEncounterContext>();

      const index = (ad: AdCatalogItem, realizations: readonly Realization[], context: Omit<AdEncounterContext, "ad" | "realizations">): void => {
        for (const realization of realizations) {
          for (const kind of FORMAT_KINDS_FOR_MATCHING) {
            const experienceId = experienceIdFor(realization.realizationId, { kind, params: {} });
            if (!contextByExperienceId.has(experienceId)) {
              contextByExperienceId.set(experienceId, { ad, realizations, ...context });
            }
          }
        }
      };

      // Remembered lane (store-gated: active, permitted, unexpired at the
      // event clock — the store owns those laws; this adds nothing).
      const remembered = await options.store.listRemembered(event.tenant, event.subject, event.occurredAt);
      for (const record of remembered) {
        index(record.ad, record.realizations, {
          lineage: record.lineage,
          rights: record.rights,
          ...(record.provenance.kind === "observed-encounter" && record.provenance.evidence.surface !== undefined
            ? { surface: record.provenance.evidence.surface }
            : {}),
        });
      }

      // Available lane (channels — declarations, matched by experienceId).
      for (const channel of channels) {
        const supplies = await channel.listSupply(event.tenant, event.subject, event.occurredAt);
        for (const rawSupply of supplies) {
          const parsedSupply = AdAvailabilitySupplySchema.safeParse(rawSupply);
          if (!parsedSupply.success) continue; // resolver is best-effort; the selection source reports channel garbage as typed 500s
          const supply = parsedSupply.data;
          index(supply.ad, supply.realizations, {
            // Channel-supplied encounters carry the channel identity as
            // their lineage source (host ad system stays the authority).
            lineage: { source: supply.availability.suppliedBy, creativeRefs: [] },
            rights: supply.rights,
          });
        }
      }

      return contextByExperienceId.get(event.experienceId) ?? null;
    },
  };
}

/** Every format kind the expander may emit for a realization (the frozen FORMAT_KINDS). */
const FORMAT_KINDS_FOR_MATCHING: readonly (typeof FORMAT_KINDS)[number][] = FORMAT_KINDS;

/* ------------------------------------------------------------------ *
 * The capture
 * ------------------------------------------------------------------ */

/**
 * Build the ad-encounter capture: observed outcome events → Personal
 * Ad Memory writes through the AD-002 store port. The store is the
 * authority for every ad-memory privacy law at its boundary (digest
 * consistency, basis-required retention, terminal forget, upsert
 * supersession) — this module composes it, never re-implements it.
 */
export function createAdEncounterCapture(options: {
  readonly store: AdMemoryStore;
  readonly policy: AdEncounterCapturePolicy;
  readonly resolver: AdEncounterResolver;
}): { capture(event: OutcomeEvent): Promise<AdEncounterCaptureResult> } {
  const eventTypes: readonly OutcomeEventType[] = options.policy.eventTypes ?? ["impression"];
  return {
    capture: async (event: OutcomeEvent): Promise<AdEncounterCaptureResult> => {
      if (!eventTypes.includes(event.eventType)) {
        return { captured: false, reason: `event type '${event.eventType}' is not a capture-policy encounter type` };
      }
      // LAW 10: only observed evidence classes may become memory —
      // simulated/counterfactual/fixture events are typed skips.
      if (!(OBSERVED_EVIDENCE_CLASSES as readonly string[]).includes(event.evidenceClass)) {
        return {
          captured: false,
          reason: `evidence class '${event.evidenceClass}' is not observed — research-class events can never become ad memory`,
        };
      }
      const context = await options.resolver.resolveAd(event);
      if (context === null) {
        return {
          captured: false,
          reason: `no ad context resolvable for experience '${event.experienceId ?? "<none>"}' at the event clock`,
        };
      }
      // The single frozen construction path: digest/id consistency is
      // enforced at the store boundary (AD-002); every timestamp is the
      // event's own caller-supplied occurredAt; the write's idempotency
      // key is the event's own (a replayed event replays the write).
      const record = finalizeAdMemoryRecord(
        {
          tenant: event.tenant,
          subject: event.subject,
          ad: context.ad,
          realizations: [...context.realizations],
          lineage: context.lineage,
          retention: {
            state: "active" as const,
            basis: options.policy.retentionBasis,
            retainedAt: event.occurredAt,
          },
          permissions: {
            retain: options.policy.permissions?.retain ?? ("granted" as const),
            present: options.policy.permissions?.present ?? ("granted" as const),
            history: [],
          },
          provenance: {
            kind: "observed-encounter" as const,
            evidence: {
              outcomeEventId: event.eventId,
              evidenceClass: event.evidenceClass as (typeof OBSERVED_EVIDENCE_CLASSES)[number],
              encounteredAt: event.occurredAt,
              // LAW 5: context by reference only — the event's own
              // ContextReference, verbatim; nothing else exists to persist.
              ...(event.context !== undefined ? { context: event.context } : {}),
              ...(context.surface !== undefined ? { surface: context.surface } : {}),
            },
          },
          rights: context.rights,
          recordedAt: event.occurredAt,
        },
        event.idempotencyKey,
      );
      const put = await options.store.put(record);
      return { captured: true, put, record: put.record };
    },
  };
}
