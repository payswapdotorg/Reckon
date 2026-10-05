/**
 * In-process test harness for @reckon/sdk (W3-002).
 *
 * EVIDENCE CLASS: controlled-local test infrastructure. This harness is NOT
 * a fake of the API — it runs the REAL fastify application (apps/api
 * buildServer) in-process and routes SDK fetches through light-my-request
 * (app.inject), so the full route pipeline (auth, scope, tenant, zod
 * validation, idempotency replay, typed error envelopes) is exercised for
 * real. Hosts embedding the API in-process may reuse the same adapter.
 */
import type { FastifyInstance } from "fastify";
import type { FetchLike } from "./client.js";

/**
 * Adapt a real fastify instance into the SDK's injectable fetch seam. The
 * URL is decomposed to path+query (the in-process app has no origin).
 */
export function createInjectFetch(app: FastifyInstance): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const headers: Record<string, string> = { ...init.headers };
    const response = await app.inject({
      method: init.method as "GET" | "POST" | "DELETE",
      url: `${parsed.pathname}${parsed.search}`,
      headers,
      payload: init.body,
    });
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) responseHeaders.append(name, item);
      } else if (typeof value === "string") {
        responseHeaders.set(name, value);
      }
    }
    return new Response(response.body, {
      status: response.statusCode,
      headers: responseHeaders,
    });
  };
}
