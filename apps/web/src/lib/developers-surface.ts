/**
 * Developers-surface seam (S3-001) — the server-only composition of the
 * pure developer-platform client (`developers-api.ts`) with the studio's
 * server environment.
 *
 * TL6-003: the KEY-management attempts moved to the ACCOUNT lane
 * (lib/account-surface.ts → /v1/account/**, session-authenticated).
 * This seam keeps the request-log and webhook-event surfaces.
 *
 * Laws (same as lib/reckon-client.ts):
 *  - `import "server-only"`: RECKON_DEMO_API_KEY resolves exclusively in
 *    server components / route handlers, so no secret can reach a client
 *    bundle. The pure module below carries NO env access and no secret.
 *  - The surface functions ATTEMPT the real (pending) API routes with the
 *    configured credentials and return exactly what was observed —
 *    honest degradation (Gate Q): "not-wired" states name the pending
 *    route; nothing is ever fabricated.
 *
 * Env (documented in apps/web/README.md):
 *   RECKON_API_BASE_URL — API origin (default http://127.0.0.1:8080)
 *   RECKON_DEMO_API_KEY — bearer key for the demo tenant (secret)
 */
import "server-only";

import {
  listEvents,
  listRequestLogs,
  type EventsPage,
  type SurfaceEndpoint,
  type SurfaceResult,
} from "./developers-api.js";
import { DEFAULT_RECKON_API_BASE_URL } from "./reckon-client.js";

function endpointFromEnv(): SurfaceEndpoint {
  const baseUrl = process.env.RECKON_API_BASE_URL?.trim() || DEFAULT_RECKON_API_BASE_URL;
  return { baseUrl, apiKey: process.env.RECKON_DEMO_API_KEY?.trim() ?? "" };
}

/** List request logs (GET /v1/request-logs), cursor-paginated the S2-001 way. */
export function fetchRequestLogs(
  options: { readonly startingAfter?: string; readonly limit?: number } = {},
): Promise<SurfaceResult<import("./developers-api").RequestLogsPage>> {
  return listRequestLogs(endpointFromEnv(), options, fetch);
}

/** List webhook events (GET /v1/events) — the S2-002 surface. */
export function fetchEvents(
  options: { readonly startingAfter?: string; readonly limit?: number } = {},
): Promise<SurfaceResult<EventsPage>> {
  return listEvents(endpointFromEnv(), options, fetch);
}

// Re-export the outcome vocabulary so server components can type against
// it without importing the pure module separately.
export type {
  EventRecord,
  EventsPage,
  RequestLogRecord,
  RequestLogsPage,
  SurfaceFailure,
  SurfaceResult,
} from "./developers-api.js";
