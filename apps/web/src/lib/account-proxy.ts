/**
 * TL6-003 — shared shapes for the studio's /api/dashboard/account/** and
 * /api/dashboard/keys/** proxies: the failure→HTTP-status map and the
 * response envelopes. PURE (no env, no server-only) so the mapping is
 * unit-testable and identical across every proxy handler.
 *
 * Status map (mirrors the S3-001 proxy conventions):
 *   unauthenticated → 401 (the session is missing/invalid/expired)
 *   unreachable      → 503
 *   not-wired       → 501
 *   error           → 502
 */
import type { AccountSurfaceFailure } from "./account-api.js";

export type ProxyFailureBody = AccountSurfaceFailure;

export function failureResponseStatus(outcome: AccountSurfaceFailure["outcome"]): number {
  switch (outcome) {
    case "unauthenticated":
      return 401;
    case "unreachable":
      return 503;
    case "not-wired":
      return 501;
    case "error":
      return 502;
  }
}

export function proxyFailureResponse(failure: AccountSurfaceFailure): Response {
  return Response.json(
    { ok: false, failure },
    { status: failureResponseStatus(failure.outcome) },
  );
}

/** Parse a JSON request body honestly: malformed JSON is a 400, never a guess. */
export async function parseJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          failure: {
            outcome: "error",
            detail: "The request body was not valid JSON.",
            code: "REQUEST_INVALID",
            param: null,
            pendingRoute: null,
            httpStatus: null,
          },
        },
        { status: 400 },
      ),
    };
  }
}

/** Narrow { kind, mode } for a mint request — anything else is an honest 400. */
export function parseMintKeyBody(
  body: unknown,
): { ok: true; input: { kind: "secret" | "publishable"; mode: "live" | "test" } } | { ok: false; detail: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, detail: "The request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  if (record["kind"] !== "secret" && record["kind"] !== "publishable") {
    return { ok: false, detail: 'Key kind must be "secret" or "publishable".' };
  }
  if (record["mode"] !== "live" && record["mode"] !== "test") {
    return { ok: false, detail: 'Mode must be "live" or "test".' };
  }
  return { ok: true, input: { kind: record["kind"], mode: record["mode"] } };
}
