/**
 * ReckonPublicPort — the ONLY seam through which the simulation harness
 * touches Reckon (SIM-001 zero-internal-access law).
 *
 * The interface is typed EXCLUSIVELY over the frozen @reckon/contracts
 * surface (zod input/output types). Implementations:
 *
 * - `createSdkPort(client)` — wraps a REAL @reckon/sdk ReckonClient
 *   (the public SDK; requests/responses validated by the SDK against
 *   the frozen zod contracts before they cross this seam);
 * - conformance fixtures compose it with a scripted FetchLike responder
 *   that itself validates against the same frozen contracts.
 *
 * The harness NEVER imports @reckon/decision, @reckon/context, or any
 * other internal package — a required capability that the public
 * surface cannot express is an API_GAP finding, not a workaround
 * (see docs/simulations/reckon-complete-profile.md).
 */
import type { z } from "zod/v4";
import {
  DecisionRequestSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  CatalogItemSchema,
  RealizationSchema,
  CandidateSetSchema,
} from "@reckon/contracts";
import type {
  CandidateSet,
  CatalogItem,
  DecisionResult,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
} from "@reckon/contracts";

/** Input types derived from the frozen schemas (defaults may be omitted). */
export type DecisionRequestInput = z.input<typeof DecisionRequestSchema>;
export type OutcomeEventInput = z.input<typeof OutcomeEventSchema>;
export type PreferenceDeltaInput = z.input<typeof PreferenceDeltaSchema>;
export type CatalogItemInput = z.input<typeof CatalogItemSchema>;
export type RealizationInput = z.input<typeof RealizationSchema>;
export type CandidateSetInput = z.input<typeof CandidateSetSchema>;

/**
 * The public-surface operations the standard decision loop needs
 * (route-annotated per the SDK's own surface map):
 *
 *   decisions.request      POST /v1/decisions
 *   outcomes.append        POST /v1/outcomes
 *   preferences.appendDelta POST /v1/preferences/events
 *   catalog.upsertItem     POST /v1/catalog/items
 *   catalog.upsertRealization POST /v1/catalog/realizations
 *   candidates.submit      POST /v1/candidates
 */
export interface ReckonPublicPort {
  readonly decisions: {
    request(input: DecisionRequestInput): Promise<DecisionResult>;
  };
  readonly outcomes: {
    append(event: OutcomeEventInput): Promise<OutcomeEvent>;
  };
  readonly preferences: {
    appendDelta(delta: PreferenceDeltaInput): Promise<PreferenceDelta>;
  };
  readonly catalog: {
    upsertItem(item: CatalogItemInput): Promise<CatalogItem>;
    upsertRealization(realization: RealizationInput): Promise<Realization>;
  };
  readonly candidates: {
    submit(set: CandidateSetInput): Promise<CandidateSet>;
  };
}

/** The operation + SDK-method identities a harness run records. */
export const PORT_OPERATIONS = {
  "decisions.request": "POST /v1/decisions",
  "outcomes.append": "POST /v1/outcomes",
  "preferences.appendDelta": "POST /v1/preferences/events",
  "catalog.upsertItem": "POST /v1/catalog/items",
  "catalog.upsertRealization": "POST /v1/catalog/realizations",
  "candidates.submit": "POST /v1/candidates",
} as const satisfies Record<string, string>;
export type PortSdkMethod = keyof typeof PORT_OPERATIONS;
