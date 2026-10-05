/**
 * POST /api/dashboard/keys — the studio's server-side proxy for key
 * creation (S3-001). The client cannot call the Reckon API directly
 * (RECKON_DEMO_API_KEY is a server secret), so the create flow posts
 * here; this handler attempts the REAL POST /v1/api-keys through the
 * honest seam and returns the typed outcome:
 *
 *   200 { ok: true, key: { …, secret } }   — only on a real 200
 *   400 { ok: false, … }                   — malformed request body
 *   503 { ok: false, failure }             — unconfigured / unreachable
 *   501 { ok: false, failure }             — not-wired (pending route)
 *   502 { ok: false, failure }             — API error / shape mismatch
 *
 * Never a fake success, never a fabricated secret (Gate Q).
 */
import { fetchCreateApiKey } from "@/lib/developers-surface";

interface CreateKeyRequestBody {
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly mode?: unknown;
}

function parseCreateBody(body: CreateKeyRequestBody): { name: string; kind: "secret" | "publishable"; mode: "live" | "test" } | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 64) {
    return { error: "A key name (1–64 characters) is required." };
  }
  if (body.kind !== "secret" && body.kind !== "publishable") {
    return { error: 'Key kind must be "secret" or "publishable".' };
  }
  if (body.mode !== "live" && body.mode !== "test") {
    return { error: 'Mode must be "live" or "test".' };
  }
  return { name, kind: body.kind, mode: body.mode };
}

export async function POST(request: Request): Promise<Response> {
  let body: CreateKeyRequestBody;
  try {
    body = (await request.json()) as CreateKeyRequestBody;
  } catch {
    return Response.json(
      { ok: false, failure: { outcome: "error", detail: "The request body was not valid JSON.", pendingRoute: "POST /v1/api-keys", httpStatus: null } },
      { status: 400 },
    );
  }

  const parsed = parseCreateBody(body);
  if ("error" in parsed) {
    return Response.json(
      { ok: false, failure: { outcome: "error", detail: parsed.error, pendingRoute: "POST /v1/api-keys", httpStatus: null } },
      { status: 400 },
    );
  }

  const result = await fetchCreateApiKey(parsed);
  if (result.ok) {
    return Response.json({ ok: true, key: result.data });
  }
  const status = result.failure.outcome === "unconfigured" || result.failure.outcome === "unreachable"
    ? 503
    : result.failure.outcome === "not-wired"
      ? 501
      : 502;
  return Response.json({ ok: false, failure: result.failure }, { status });
}
