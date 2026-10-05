/**
 * Analytics-surface seam (S3-002) — the server-only composition of the
 * pure analytics data layer with the studio's server environment,
 * exactly the developers-surface.ts law (S3-001):
 *
 *  - `import "server-only"`: RECKON_DEMO_API_KEY resolves exclusively in
 *    server components / route handlers, so no secret can reach a client
 *    bundle. The pure modules below carry NO env access and no secret.
 *  - The surface functions ATTEMPT the real (pending) API routes with the
 *    configured credentials and return exactly what was observed —
 *    honest degradation (Gate Q): "not-wired" states name the pending
 *    route; nothing is ever fabricated.
 *
 * When the pending routes land, the same attempts start returning "ok"
 * and the analytics views light up with zero UI changes — that is the
 * seam.
 *
 * Env (documented in apps/web/README.md):
 *   RECKON_API_BASE_URL — API origin (default http://127.0.0.1:8080)
 *   RECKON_DEMO_API_KEY — bearer key for the demo tenant (secret)
 */
import "server-only";

import {
  listDecisionTrail,
  listOutcomeTrail,
  type DecisionTrailPage,
  type OutcomeTrailPage,
} from "./analytics-ctr-lift.js";
import { listDriftEvents, type DriftEventsPage } from "./analytics-drift.js";
import {
  listPreferenceDeltaTrail,
  type PreferenceDeltaTrailPage,
} from "./analytics-funnel.js";
import {
  DEFAULT_RECKON_API_BASE_URL,
} from "./reckon-client.js";
import type { SurfaceEndpoint, SurfaceResult } from "./developers-api.js";

/**
 * The trail window the analytics views fetch. Honest by construction: the
 * pending list routes are cursor-paginated (S2-001), so this is the FIRST
 * page depth the views compute over — the views state their n= counts,
 * never a total.
 */
export const ANALYTICS_TRAIL_LIMIT = 100;

function endpointFromEnv(): SurfaceEndpoint {
  const baseUrl = process.env.RECKON_API_BASE_URL?.trim() || DEFAULT_RECKON_API_BASE_URL;
  return { baseUrl, apiKey: process.env.RECKON_DEMO_API_KEY?.trim() ?? "" };
}

/** List the decision trail (GET /v1/decisions — pending, named when not-wired). */
export function fetchDecisionTrail(
  options: { readonly startingAfter?: string; readonly limit?: number } = {},
): Promise<SurfaceResult<DecisionTrailPage>> {
  return listDecisionTrail(endpointFromEnv(), { limit: ANALYTICS_TRAIL_LIMIT, ...options }, fetch);
}

/** List the outcome trail (GET /v1/outcomes — pending, named when not-wired). */
export function fetchOutcomeTrail(
  options: { readonly startingAfter?: string; readonly limit?: number } = {},
): Promise<SurfaceResult<OutcomeTrailPage>> {
  return listOutcomeTrail(endpointFromEnv(), { limit: ANALYTICS_TRAIL_LIMIT, ...options }, fetch);
}

/**
 * List the preference-delta trail (GET /v1/preferences/events — pending,
 * named when not-wired).
 */
export function fetchPreferenceDeltaTrail(
  options: { readonly startingAfter?: string; readonly limit?: number } = {},
): Promise<SurfaceResult<PreferenceDeltaTrailPage>> {
  return listPreferenceDeltaTrail(endpointFromEnv(), { limit: ANALYTICS_TRAIL_LIMIT, ...options }, fetch);
}

/** List the drift events feed (GET /v1/events — pending, named when not-wired). */
export function fetchDriftEvents(
  options: { readonly startingAfter?: string; readonly limit?: number } = {},
): Promise<SurfaceResult<DriftEventsPage>> {
  return listDriftEvents(endpointFromEnv(), { limit: ANALYTICS_TRAIL_LIMIT, ...options }, fetch);
}

// Re-export the trail page types so server components can type against
// them without importing the pure modules separately.
export type { DecisionTrailPage, OutcomeTrailPage };
